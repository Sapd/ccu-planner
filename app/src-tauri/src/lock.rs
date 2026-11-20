//! File locks in the data folder, the same files with the same rules as the Node side
//! (src/sync/lock.mjs for `sync.lock`, src/sync/write-lock.mjs for `.write.lock`).
//! Both hold `{"pid":N,"startedAt":"<ISO 8601 UTC>"}`, created with `create_new`.
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const SYNC_LOCK: &str = "sync.lock";
pub const WRITE_LOCK: &str = ".write.lock";
pub const SYNC_STALE_MS: i64 = 2 * 60 * 60 * 1000;
pub const WRITE_STALE_MS: i64 = 30_000;
pub const WRITE_WAIT_MS: u64 = 2_000;
pub const DATA_BUSY: &str =
    "Data folder busy: another planner process is saving. Try again in a moment.";

/// Clock, process id and liveness check, replaceable in tests.
pub struct Env<'a> {
    pub now: &'a dyn Fn() -> i64,
    pub pid: u32,
    pub alive: &'a dyn Fn(u32) -> bool,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only checks that the process exists.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

// If tasklist cannot be run the answer is "alive" (unwrap_or(true)): the sync lock then is never taken over for a dead pid, only
// reported after 2 h with the delete-path message; the write lock still clears itself through its 30 s age rule.
#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW; tasklist prints the pid as a whole word when the process exists.
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .creation_flags(0x0800_0000)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")))
        .unwrap_or(true)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `2026-11-19T10:00:00.000Z`, what JavaScript's toISOString writes.
pub fn iso(ms: i64) -> String {
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Parses `YYYY-MM-DDTHH:MM:SS[.fff]Z`; anything else is "no valid time".
pub fn parse_iso(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    let num = |a: usize, z: usize| -> Option<i64> {
        let part = text.get(a..z)?;
        part.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| part.parse().ok())?
    };
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let (y, mo, d, h, mi, s) = (
        num(0, 4)?,
        num(5, 7)?,
        num(8, 10)?,
        num(11, 13)?,
        num(14, 16)?,
        num(17, 19)?,
    );
    let (millis, end) = if b[19] == b'.' {
        let digits = text[20..].bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        let frac = format!("{:0<3}", &text[20..20 + digits.min(3)]);
        (frac.parse::<i64>().ok()?, 20 + digits)
    } else {
        (0, 19)
    };
    if &text[end..] != "Z"
        || !(1..=12).contains(&mo)
        || !(1..=31).contains(&d)
        || h > 23
        || mi > 59
        || s > 59
    {
        return None;
    }
    Some(days_from_civil(y, mo, d) * 86_400_000 + h * 3_600_000 + mi * 60_000 + s * 1000 + millis)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Info {
    pub pid: u32,
    pub started_at: String,
    pub started_ms: i64,
}

/// The lock's text and what it says (None when empty or unreadable).
pub struct Lock {
    pub raw: String,
    pub info: Option<Info>,
}

pub fn read_lock(file: &Path) -> Result<Option<Lock>, String> {
    let raw = match fs::read(file) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let info = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| {
            let pid = u32::try_from(v.get("pid")?.as_u64()?).ok()?;
            let started_at = v.get("startedAt")?.as_str()?.to_string();
            let started_ms = parse_iso(&started_at)?;
            Some(Info {
                pid,
                started_at,
                started_ms,
            })
        });
    Ok(Some(Lock { raw, info }))
}

fn unique() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!(
        "{:08x}",
        nanos ^ (NEXT.fetch_add(1, Ordering::Relaxed) as u32).wrapping_mul(0x9E37_79B1)
    )
}

/// Takes a stale lock away without ever leaving two holders: rename it to a unique name (only one taker gets it), check it is
/// still what was judged stale, delete it. If it changed in between, put it back when the name is free and give up.
/// Returns true when the stale lock is gone and the caller may create its own.
pub fn take_over(file: &Path, judged_raw: &str, pid: u32) -> Result<bool, String> {
    let mut name = file.as_os_str().to_owned();
    name.push(format!(".stale.{pid}.{}", unique()));
    let mine = PathBuf::from(name);
    match fs::rename(file, &mine) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(true),
        Err(e) => return Err(e.to_string()),
    }
    let now = fs::read(&mine)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned());
    if now.as_deref() == Some(judged_raw) {
        fs::remove_file(&mine).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    let _ = fs::hard_link(&mine, file); // a newer lock already there: that one wins
    let _ = fs::remove_file(&mine);
    Ok(false)
}

fn create_exclusive(file: &Path, text: &str) -> std::io::Result<()> {
    let mut f = OpenOptions::new().write(true).create_new(true).open(file)?;
    if let Err(e) = f.write_all(text.as_bytes()) {
        drop(f);
        let _ = fs::remove_file(file);
        return Err(e);
    }
    Ok(())
}

fn lock_text(pid: u32, now: i64) -> String {
    format!("{{\"pid\":{pid},\"startedAt\":\"{}\"}}", iso(now))
}

/// A fresh lock text for this process, for tests of other modules.
#[cfg(test)]
pub fn lock_text_for_tests(pid: u32) -> String {
    lock_text(pid, now_ms())
}

fn mtime_ms(file: &Path) -> Option<i64> {
    let t = fs::metadata(file).ok()?.modified().ok()?;
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn busy_message(info: Option<&Info>) -> String {
    format!(
        "Another sync is running (started {}{}).",
        info.map_or("at an unknown time", |i| i.started_at.as_str()),
        info.map_or(String::new(), |i| format!(", pid {}", i.pid))
    )
}

/// Holds `<data>/sync.lock`; dropping it (also on panic or an early return) removes the file when it is still ours.
#[derive(Debug)]
pub struct SyncGuard {
    file: PathBuf,
    pid: u32,
}
impl Drop for SyncGuard {
    fn drop(&mut self) {
        release(&self.file, self.pid);
    }
}

fn release(file: &Path, pid: u32) {
    if let Ok(Some(Lock { info: Some(i), .. })) = read_lock(file) {
        if i.pid == pid {
            let _ = fs::remove_file(file);
        }
    }
}

/// Same rules as acquireSyncLock in src/sync/lock.mjs: a dead pid is taken over; a live pid over two hours is refused with
/// the delete-path message; an empty or corrupt lock is stale after 60 s; `after_judge` is a test hook.
pub fn acquire_sync_lock_with(
    dir: &Path,
    env: &Env,
    stale_ms: i64,
    after_judge: Option<&dyn Fn()>,
) -> Result<SyncGuard, String> {
    let file = dir.join(SYNC_LOCK);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mine = lock_text(env.pid, (env.now)());
    for _ in 0..5 {
        match create_exclusive(&file, &mine) {
            Ok(()) => return Ok(SyncGuard { file, pid: env.pid }),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
        let Some(lock) = read_lock(&file)? else {
            continue;
        };
        match &lock.info {
            Some(info) => {
                if (env.alive)(info.pid) {
                    if (env.now)() - info.started_ms >= stale_ms {
                        return Err(format!(
                            "A sync has been running for over 2 h (started {}, pid {}); if it is stuck, delete {}.",
                            info.started_at,
                            info.pid,
                            file.display()
                        ));
                    }
                    return Err(busy_message(Some(info)));
                }
            }
            None => {
                // Empty or corrupt: a writer may be creating it right now, so only one older than a minute is stale.
                let Some(m) = mtime_ms(&file) else { continue };
                if (env.now)() - m <= 60_000 {
                    return Err(busy_message(None));
                }
            }
        }
        if let Some(hook) = after_judge {
            hook();
        }
        if !take_over(&file, &lock.raw, env.pid)? {
            return Err(busy_message(
                read_lock(&file)?.and_then(|l| l.info).as_ref(),
            ));
        }
    }
    Err(busy_message(
        read_lock(&file)?.and_then(|l| l.info).as_ref(),
    ))
}

pub fn acquire_sync_lock(dir: &Path) -> Result<SyncGuard, String> {
    acquire_sync_lock_with(
        dir,
        &Env {
            now: &now_ms,
            pid: std::process::id(),
            alive: &pid_alive,
        },
        SYNC_STALE_MS,
        None,
    )
}

/// Runs `work` while holding `<data>/.write.lock` (stale after 30 s or when its process is gone; waits up to `wait` for it).
/// Removes `.write.lock` when it is still ours (same text), also while unwinding from a panic.
struct WriteGuard {
    file: PathBuf,
    text: String,
}
impl Drop for WriteGuard {
    fn drop(&mut self) {
        if matches!(read_lock(&self.file), Ok(Some(l)) if l.raw == self.text) {
            let _ = fs::remove_file(&self.file);
        }
    }
}

pub fn with_write_lock_using<T>(
    dir: &Path,
    env: &Env,
    wait: Duration,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let file = dir.join(WRITE_LOCK);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mine = lock_text(env.pid, (env.now)());
    let deadline = Instant::now() + wait;
    loop {
        match create_exclusive(&file, &mine) {
            Ok(()) => {
                // Dropped on return and on panic in `work`.
                let _held = WriteGuard {
                    file: file.clone(),
                    text: mine.clone(),
                };
                return work();
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
        let Some(lock) = read_lock(&file)? else {
            continue;
        };
        let stale = match &lock.info {
            Some(i) => !(env.alive)(i.pid) || (env.now)() - i.started_ms >= WRITE_STALE_MS,
            None => mtime_ms(&file).is_some_and(|m| (env.now)() - m > WRITE_STALE_MS),
        };
        if stale && take_over(&file, &lock.raw, env.pid)? {
            continue;
        }
        if Instant::now() >= deadline {
            return Err(DATA_BUSY.into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn with_write_lock<T>(
    dir: &Path,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    with_write_lock_using(
        dir,
        &Env {
            now: &now_ms,
            pid: std::process::id(),
            alive: &pid_alive,
        },
        Duration::from_millis(WRITE_WAIT_MS),
        work,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const AT: i64 = 1_784_455_200_000; // an arbitrary instant: only differences matter
    fn env<'a>(now: &'a dyn Fn() -> i64, pid: u32, alive: &'a dyn Fn(u32) -> bool) -> Env<'a> {
        Env { now, pid, alive }
    }
    fn lock_path(dir: &Path) -> PathBuf {
        dir.join(SYNC_LOCK)
    }
    fn text(pid: u32, ms: i64) -> String {
        lock_text(pid, ms)
    }
    fn acquire(dir: &Path, now: i64, pid: u32, alive: bool) -> Result<SyncGuard, String> {
        acquire_sync_lock_with(dir, &env(&|| now, pid, &|_| alive), SYNC_STALE_MS, None)
    }

    #[test]
    fn iso_matches_javascript_and_round_trips() {
        assert_eq!(
            iso(parse_iso("2026-11-19T10:00:00.000Z").unwrap()),
            "2026-11-19T10:00:00.000Z"
        );
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_iso("2024-02-29T23:59:59.999Z"),
            Some(1_709_251_199_999)
        );
        assert_eq!(iso(1_709_251_199_999), "2024-02-29T23:59:59.999Z");
        for bad in [
            "",
            "garbage",
            "2026-13-01T00:00:00Z",
            "2026-11-19 10:00:00Z",
            "2026-11-19T10:00:00+01:00",
        ] {
            assert_eq!(parse_iso(bad), None, "{bad}");
        }
        assert_eq!(parse_iso(&iso(AT)), Some(AT));
    }

    #[test]
    fn exclusive_names_the_start_and_is_released_on_drop() {
        let dir = tempfile::tempdir().unwrap();
        let guard = acquire(dir.path(), AT, 4242, true).unwrap();
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(lock_path(dir.path())).unwrap()).unwrap();
        assert_eq!(doc["pid"], 4242);
        assert_eq!(doc["startedAt"], iso(AT));
        let err = acquire(dir.path(), AT + 300_000, 7, true).unwrap_err();
        assert!(
            err.starts_with(&format!("Another sync is running (started {}", iso(AT))),
            "{err}"
        );
        drop(guard);
        assert!(!lock_path(dir.path()).exists());
        drop(acquire(dir.path(), AT, 4242, true).unwrap());
    }

    #[test]
    fn the_guard_releases_on_panic_and_early_return() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let caught = std::panic::catch_unwind(|| {
            let _guard = acquire(&path, AT, 4242, true).unwrap();
            panic!("sync blew up");
        });
        assert!(caught.is_err());
        assert!(!lock_path(dir.path()).exists());
        let early = |p: &Path| -> Result<(), String> {
            let _guard = acquire(p, AT, 4242, true)?;
            Err("early".into())
        };
        assert!(early(dir.path()).is_err());
        assert!(!lock_path(dir.path()).exists());
    }

    #[test]
    fn dead_pid_is_taken_over_live_and_fresh_corrupt_are_respected() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(lock_path(dir.path()), text(999_999, AT - 1000)).unwrap();
        drop(acquire(dir.path(), AT, 1, false).unwrap());
        fs::write(lock_path(dir.path()), text(1, AT - 1000)).unwrap();
        assert!(acquire(dir.path(), AT, 2, true)
            .unwrap_err()
            .starts_with("Another sync is running"));
        fs::write(lock_path(dir.path()), "garbage").unwrap();
        assert!(acquire(dir.path(), now_ms(), 2, true)
            .unwrap_err()
            .starts_with("Another sync is running (started at an unknown time"));
    }

    #[test]
    fn release_removes_only_our_own_lock() {
        let dir = tempfile::tempdir().unwrap();
        let guard = acquire(dir.path(), AT, 111, true).unwrap();
        fs::write(lock_path(dir.path()), text(222, AT)).unwrap();
        drop(guard);
        assert!(fs::read_to_string(lock_path(dir.path()))
            .unwrap()
            .contains("\"pid\":222"));
    }

    #[test]
    fn two_takers_of_one_stale_lock_never_both_hold_it() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(lock_path(dir.path()), text(999, AT - 5000)).unwrap();
        let alive = |p: u32| p == 111 || p == 222;
        let first: Cell<Option<SyncGuard>> = Cell::new(None);
        let hook = || {
            first.set(Some(
                acquire_sync_lock_with(dir.path(), &env(&|| AT, 111, &alive), SYNC_STALE_MS, None)
                    .unwrap(),
            ));
        };
        let result = acquire_sync_lock_with(
            dir.path(),
            &env(&|| AT, 222, &alive),
            SYNC_STALE_MS,
            Some(&hook),
        );
        assert!(result.is_err());
        assert!(fs::read_to_string(lock_path(dir.path()))
            .unwrap()
            .contains("\"pid\":111"));
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(
            names,
            vec![SYNC_LOCK.to_string()],
            "no stale file is left behind"
        );
        drop(first.take());
    }

    #[test]
    fn a_live_holder_over_two_hours_is_reported_with_the_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(lock_path(dir.path()), text(1, AT - SYNC_STALE_MS - 1)).unwrap();
        let err = acquire(dir.path(), AT, 2, true).unwrap_err();
        assert!(
            err.contains("over 2 h")
                && err.contains("if it is stuck, delete ")
                && err.ends_with("sync.lock."),
            "{err}"
        );
        assert!(lock_path(dir.path()).exists());
    }

    #[test]
    fn empty_or_corrupt_is_stale_after_a_minute_not_before() {
        let dir = tempfile::tempdir().unwrap();
        for body in ["", "{\"pid\":\"x\"}"] {
            fs::write(lock_path(dir.path()), body).unwrap();
            let m = mtime_ms(&lock_path(dir.path())).unwrap();
            assert!(acquire(dir.path(), m + 1000, 2, true).is_err());
            drop(acquire(dir.path(), m + 61_000, 2, true).unwrap());
            assert!(!lock_path(dir.path()).exists());
        }
    }

    fn write_env<'a>(now: &'a dyn Fn() -> i64, alive: &'a dyn Fn(u32) -> bool) -> Env<'a> {
        env(now, 4242, alive)
    }

    #[test]
    fn write_lock_is_released_when_the_work_panics() {
        let dir = tempfile::tempdir().unwrap();
        let alive = |_: u32| true;
        let now = || AT;
        let path = dir.path().to_path_buf();
        let caught = std::panic::catch_unwind(|| {
            let _: Result<(), String> = with_write_lock_using(
                &path,
                &write_env(&now, &alive),
                Duration::from_millis(60),
                || panic!("work blew up"),
            );
        });
        assert!(caught.is_err());
        assert!(!dir.path().join(WRITE_LOCK).exists());
    }

    #[test]
    fn write_lock_is_exclusive_released_and_stale_rules_hold() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(WRITE_LOCK);
        let alive = |_: u32| true;
        let now = || AT;
        let inner = with_write_lock_using(
            dir.path(),
            &write_env(&now, &alive),
            Duration::from_millis(500),
            || {
                assert!(file.exists());
                let nested = with_write_lock_using(
                    dir.path(),
                    &write_env(&now, &alive),
                    Duration::from_millis(60),
                    || Ok(()),
                );
                assert_eq!(nested.unwrap_err(), DATA_BUSY);
                Ok(7)
            },
        );
        assert_eq!(inner.unwrap(), 7);
        assert!(!file.exists());
        let failed: Result<(), String> = with_write_lock_using(
            dir.path(),
            &write_env(&now, &alive),
            Duration::from_millis(60),
            || Err("boom".into()),
        );
        assert_eq!(failed.unwrap_err(), "boom");
        assert!(!file.exists());
        // dead pid, and a live one older than 30 s, are taken over; a fresh live one is waited for
        fs::write(&file, text(1, AT - 1000)).unwrap();
        let dead = |_: u32| false;
        assert_eq!(
            with_write_lock_using(
                dir.path(),
                &write_env(&now, &dead),
                Duration::from_millis(60),
                || Ok(1)
            )
            .unwrap(),
            1
        );
        fs::write(&file, text(1, AT - WRITE_STALE_MS - 1)).unwrap();
        assert_eq!(
            with_write_lock_using(
                dir.path(),
                &write_env(&now, &alive),
                Duration::from_millis(60),
                || Ok(2)
            )
            .unwrap(),
            2
        );
        fs::write(&file, text(1, AT - 1000)).unwrap();
        assert_eq!(
            with_write_lock_using(
                dir.path(),
                &write_env(&now, &alive),
                Duration::from_millis(60),
                || Ok(3)
            )
            .unwrap_err(),
            DATA_BUSY
        );
        assert!(file.exists());
    }
}
