// Pure helpers for scripts/release.mjs (kept separate so tests can import them).
// Local fallback only: the GitHub workflow (tauri-action) writes its own latest.json. Same host and
// layout as the updater endpoint in tauri.conf.json (GitHub Releases).
export const REPO_URL = 'https://github.com/Sapd/ccu-planner';
const SEMVER = /^\d+\.\d+\.\d+$/;

export function assertVersion(v) {
  if (!SEMVER.test(v)) throw new Error(`Version must look like 1.2.3, got "${v}"`);
  return v;
}

export function readVersions({ tauriConf, cargoToml, appPackage }) {
  return {
    tauri: JSON.parse(tauriConf).version,
    cargo: /^version\s*=\s*"([^"]+)"/m.exec(cargoToml.slice(cargoToml.indexOf('[package]')))?.[1],
    npm: JSON.parse(appPackage).version,
  };
}

export function versionsAgree(v) {
  return v.tauri === v.cargo && v.cargo === v.npm ? v.tauri : null;
}

// Text edits that keep the files' own formatting.
export function setTauriConfVersion(text, version) {
  const next = text.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
  if (next === text && JSON.parse(text).version !== version) throw new Error('tauri.conf.json: version not found');
  return next;
}
export function setCargoTomlVersion(text, version) {
  const i = text.indexOf('[package]');
  const head = text.slice(0, i), rest = text.slice(i);
  return head + rest.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
}
// Cargo.lock may be checked out with CRLF line ends (Git on Windows); the edit keeps them.
export function setCargoLockVersion(text, crate, version) {
  const re = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = ")[^"]+(")`);
  if (!re.test(text)) throw new Error(`Cargo.lock: ${crate} not found`);
  return text.replace(re, `$1${version}$2`);
}
export function setPackageJsonVersion(text, version) {
  const json = JSON.parse(text);
  json.version = version;
  return JSON.stringify(json, null, 2) + '\n';
}
export function setPackageLockVersion(text, version) {
  const json = JSON.parse(text);
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
  return JSON.stringify(json, null, 2) + '\n';
}

// Updater platform keys for a build target.
export function platformKeys(target, hostArch = process.arch) {
  if (target === 'universal-apple-darwin') return ['darwin-aarch64', 'darwin-x86_64'];
  if (target === 'aarch64-apple-darwin' || (!target && hostArch === 'arm64')) return ['darwin-aarch64'];
  if (target === 'x86_64-apple-darwin' || (!target && hostArch === 'x64')) return ['darwin-x86_64'];
  if (target === 'x86_64-pc-windows-msvc') return ['windows-x86_64'];
  throw new Error(`Unsupported target ${target ?? hostArch}`);
}

// "CCU Planner_0.1.1_x64-setup.exe" -> "CCU-Planner_0.1.1_x64-setup.exe"; refuses an installer of another version.
export function windowsInstallerName(file, version) {
  if (!file.includes(`_${version}_`)) throw new Error(`${file} does not look like version ${version}`);
  return file.replace(/\s+/g, '-');
}

export const artifactUrl = (version, file) => `${REPO_URL}/releases/download/v${version}/${encodeURIComponent(file)}`;

// Tauri static-JSON format. `existing` (same version) lets another machine add its platforms.
export function buildLatestJson({ version, notes, pubDate, platforms, existing }) {
  const merged = existing && existing.version === version ? { ...existing.platforms } : {};
  for (const [key, value] of Object.entries(platforms)) merged[key] = value;
  return { version, notes, pub_date: pubDate, platforms: merged };
}

export function uploadCommands(version, dir = `release/${version}`) {
  return [
    `# Fallback to the GitHub workflow: create a DRAFT release with the files, check it, publish it by hand.`,
    `# latest.json must be among the assets (the app reads releases/latest/download/latest.json).`,
    `gh release create v${version} --draft --title "v${version}" --notes "See the commits" ${dir}/*`,
    `# then review the draft on GitHub and publish it (publishing makes it the update for every installed app)`,
  ];
}
