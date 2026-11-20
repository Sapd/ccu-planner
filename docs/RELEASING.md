# Releasing the desktop app

Releases are built by GitHub Actions and served from GitHub Releases. Updates reach installed apps
through `https://github.com/Sapd/ccu-planner/releases/latest/download/latest.json`.

## MCP release files

Every release also carries `ccu-planner.mcpb` for Claude Desktop and four standalone executables for Claude Code. The read-only Ubuntu build job compiles all four, validates the bundle, and smoke-tests the Node entry point and Linux executable. The workflow artifact is named `mcp`. On tag runs a separate job attaches its files to the existing draft using the workflow token. Neither step needs a signing key.

To build locally, install Bun 1.4.2, then run `npm ci`, `npm run build:mcp` and `npm run test:mcp-dist` from the repository root. Cross-compilation downloads Bun runtimes on the first build. For a manual release, attach `dist/ccu-planner.mcpb` and all four `dist/ccu-planner-mcp-*` files to the draft.

## The release flow (GitHub)

1. **Bump the version** in all files at once: `npm run version -- 0.2.0` (sets `tauri.conf.json`,
   `Cargo.toml`, `Cargo.lock`, `app/package.json`, `app/package-lock.json`, and moves the data feed's replay
   floor `src/feed-floor.json` to one day ago; `npm run version -- --check` verifies they agree). Do it by hand
   only if you must, and keep all five in step. The workflow refuses a tag whose floor is older than 45 days:
   run `npm run version -- 0.2.0` again to refresh it.
2. **Check locally**: `npm test`, `cd app && npx vite build`, `cd app/src-tauri && cargo test && cargo clippy -- -D warnings`.
3. **Commit** (`Release v0.2.0`), then **tag and push the tag**:
   ```sh
   git tag v0.2.0
   git push origin main v0.2.0
   ```
   The tag must equal the version in the files and the tagged commit must be on `main`, otherwise the
   workflow stops at its first job. Tags `v*` are protected by a repository ruleset (only repository admins
   may create, move or delete them).
4. **Approve and wait for the draft.** `.github/workflows/release.yml` builds macOS (universal) and Windows (NSIS),
   signs the update artifacts with the secret `TAURI_SIGNING_PRIVATE_KEY` (no password) and
   attaches everything to a **draft** release `v0.2.0`. The signing key is a secret of the GitHub
   environment `release`: only `v*` tags may use it, and the build jobs wait until you approve them
   (the run page shows "Review deployments"). It takes roughly 15 to 25 minutes after that. A re-run for the same tag reuses
   its draft. Run it without a tag first (Actions, "Release", "Run workflow" on any branch) as a dry run: it
   builds both platforms without a key and without update artifacts and uploads the bundles as workflow
   artifacts only; no release is created and nothing needs approval.
5. **Check the draft's assets**: `latest.json`; the macOS `.app.tar.gz` and its `.sig`; the `.dmg`;
   the Windows `-setup.exe` and its `.sig`. Also check for the MCP bundle and the Windows x64, macOS arm64, macOS x64 and Linux x64 MCP executables. Open `latest.json`: `version` is right and `platforms` lists
   `darwin-aarch64`, `darwin-x86_64` and `windows-x86_64`. Edit the release notes if you like.
6. **Publish the draft.** This is the point of no return: the moment it is published (and not marked
   pre-release) it is the "latest" release, and every installed app picks it up within hours (10 seconds
   after start and every 6 hours), downloads it, and offers "Restart". There is no staged rollout. To pull a
   bad release, delete it or mark it as a draft again, or publish a fixed higher version; installed apps only
   move to a higher version than their own.

Nothing in this flow publishes by itself: the draft stays invisible until you press the button.

The first real run of this workflow has not happened yet. Expect to fix small things on the first tag
(use the dry run). The macOS build is ad-hoc signed and not notarised, see section 3.

The sections below describe the pieces in detail. Sections 1, 2 and 7 also describe the local fallback
(`npm run release`, section 7) that builds on your own machines and writes the same files to `release/<version>/`.

The app is the Tauri 2 project in `app/` (frontend) and `app/src-tauri/` (Rust shell). CI
(`.github/workflows/ci.yml`, on pushes to `main` and on pull requests) runs the root tests on Linux and Windows, the frontend build, `cargo test` and
`cargo clippy -- -D warnings`. It does not build installers.

## 1. Bump the version

Keep these in step (the version is `0.1.0` today): (`npm run version -- X.Y.Z` does this for you)

| File | Field |
| ---- | ----- |
| `app/src-tauri/tauri.conf.json` | `version` (this is the version Tauri stamps on the bundles) |
| `app/src-tauri/Cargo.toml` | `[package] version` |
| `app/package.json` | `version` |

The script also updates the lock files' version fields. If you edit by hand, refresh them:

```sh
cd app && npm install --package-lock-only      # app/package-lock.json (two places hold the version)
cd src-tauri && cargo update -p ccu-planner-desktop --offline   # Cargo.lock; or just run cargo check
```

The root `package.json` has no version and is private. Commit as `Release vX.Y.Z`, tag `vX.Y.Z`.

The root `package.json` needs Node 22 or newer (the tests use a glob); CI uses Node 26.

Before tagging: `npm test` at the root, `cd app && npx vite build`, `cd app/src-tauri && cargo test && cargo clippy -- -D warnings`.

## 2. Build per platform

Tauri builds installers only for the OS it runs on. Use one runner (or one machine) per platform.
All builds start with a clean install and run from `app/`:

```sh
cd app
npm ci
npx tauri build            # runs `npm run build` first (beforeBuildCommand), then cargo build --release
```

On Windows `npm test` needs Node 22 or newer (it uses a glob); a first `tauri build` there took about 2 minutes of Rust compiling and produced a 4.3 MB NSIS installer.
Bundle targets are set in `app/src-tauri/tauri.conf.json`: `app`, `dmg`, `nsis`, `appimage`, `deb` (no `msi`).
Tauri builds only the targets that exist on the current OS (dmg/app on macOS, nsis on Windows,
appimage/deb on Linux). Output is in `app/src-tauri/target/release/bundle/`.

The macOS and Windows (NSIS) bundles have been built; the Windows one was started on a Windows 11 PC and showed the welcome screen. Linux has not. Do a first build on each platform and install
it on a clean user account before the first public release.

## 3. macOS: signing and notarisation

Needs an Apple Developer Program membership (paid) and a "Developer ID Application" certificate.
`signingIdentity` in `tauri.conf.json` is deliberately `null`: signing is supplied through
environment variables so no identity is committed. Tauri 2 reads:

| Variable | Meaning |
| -------- | ------- |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_CERTIFICATE` | base64 of the exported `.p12` (CI only; Tauri imports it into a temporary keychain) |
| `APPLE_CERTIFICATE_PASSWORD` | password of that `.p12` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarisation with an Apple ID and an app-specific password |
| or `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH` | notarisation with an App Store Connect API key (preferred for CI) |

With the signing variables and one set of notarisation variables present, `npx tauri build`
signs the app, submits it to Apple, waits, and staples the ticket. Without notarisation the dmg
opens only after a Gatekeeper override. Check the result with
`spctl -a -vv -t exec "App.app"` and `xcrun stapler validate "App.dmg"`.
`minimumSystemVersion` is 11.0. Build both `aarch64-apple-darwin` and `x86_64-apple-darwin`
(`--target`) or `universal-apple-darwin` if Intel Macs should be supported.

Check the current variable names against the Tauri 2 distribution docs before the first release;
they are listed from memory of those docs and were not exercised here.

## 4. Windows

The NSIS installer installs per user (`installMode: currentUser`), so it needs no admin rights.
Two options:

- **Sign it.** Buy a code-signing certificate (an EV certificate gets SmartScreen reputation at
  once; a standard OV certificate builds it over time) and configure `bundle.windows.certificateThumbprint`
  or a `signCommand` (for a cloud/HSM signer) through a CI-only config override
  (`tauri build --config <file>`), so no thumbprint is committed.
- **Accept SmartScreen.** An unsigned installer shows "Windows protected your PC"; users click
  "More info" then "Run anyway". Fine for friends, poor for a public release.

WebView2 is installed by the NSIS bootstrapper if missing (Tauri default).

## 5. Linux

Build on Ubuntu 22.04 or 24.04 (the AppImage links against the build machine's glibc, so build on
the oldest distribution you want to support). Packages are the Tauri 2 prerequisites, the same list
CI installs: `build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev
libayatana-appindicator3-dev librsvg2-dev`. Outputs: `.AppImage` and `.deb`. There is no
signing step; publish checksums (`sha256sum`) next to the files.

## 6. Publishing

The workflow (see the top) attaches the dmg, the NSIS `.exe`, the updater files and `latest.json` to the
draft release. Linux is not built by it. The licence is GPL-3.0-only (`LICENSE`); the release notes should say where the source is
(the repository itself, as the release is on it).

## 7. Updates (signed, from GitHub Releases) and the local fallback

The app checks for a new signed version 10 seconds after start and every 6 hours, downloads it in
the background and shows "Update X ready · Restart" in the top bar. It never restarts by itself.
Help has "Check for updates" and the current version. The updater endpoint in `tauri.conf.json` is exactly
`https://github.com/Sapd/ccu-planner/releases/latest/download/latest.json`; it resolves to the newest
published, non-draft, non-pre-release release. Draft releases are invisible to it.

### The signing key (BACK IT UP)

- Private key: `~/.tauri/ccuplanner.key`. Public key: `~/.tauri/ccuplanner.key.pub`, committed in
  `tauri.conf.json` under `plugins.updater.pubkey`. On GitHub it is the secret `TAURI_SIGNING_PRIVATE_KEY` of the
  environment `release` (set with `gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/ccuplanner.key`;
  there is no repository-level copy). The data feed's key is `FEED_SIGNING_KEY` of the environment `feed`
  (`~/.config/ccuplanner/feed-signing.pem` locally; deployments only from `main`).
- **Back the private key up now** (password manager, offline copy). If it is lost, installed apps
  can never be updated again: they only accept updates signed by it, and the only way out is a new
  install by hand. If it leaks, anyone can push "updates" to every installed app. Never commit it,
  paste it into chat or logs.
- The key currently has **no password**. Before the first public release you may generate a new
  pair with a password (`cd app && npx tauri signer generate -w ~/.tauri/ccuplanner.key`); then the
  public key changes: put the new one into `tauri.conf.json` and set
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when releasing. Apps built with the old public key cannot
  take updates signed by the new key, so do this before anyone has an install.
- `scripts/release.mjs` passes only the key's **path** (default above; override: `CCU_SIGNING_KEY_FILE`) to
  `tauri build` through `TAURI_SIGNING_PRIVATE_KEY` (the Tauri CLI accepts a file path there). The script never reads
  or prints the key, but the path is in the environment of the whole build, so the build reads the file itself.
- `signer generate -w <path>` on an existing key file asks before overwriting; copy the old key somewhere safe first.

### Rotating a key (what happens to installed apps)

Both keys are single embedded keys: an app trusts exactly the one public key it was built with, and there is no second key and no
revocation list. A key that leaks therefore needs a new app release before anything else changes.

- **Updater key** (`plugins.updater.pubkey` in `tauri.conf.json`). Apps only install updates signed by the key they carry. After a
  rotation, **no installed app can update to a build signed with the new key**: they reject it as a bad signature. Installed users have to
  download and install the new version by hand once (the release notes must say so); from that build on updates work again.
  If the old key leaked, anyone holding it can push "updates" to the old apps until they reinstall, so withdraw (delete) the old
  releases and publish the new build at once. Steps: `cd app && npx tauri signer generate -w ~/.tauri/ccuplanner.key` (after moving the old one
  away), put the new public key into `tauri.conf.json`, replace the environment secret
  (`gh secret set TAURI_SIGNING_PRIVATE_KEY --env release ...`), `npm run version -- X.Y.Z`, tag.
- **Feed key** (`src/feed-public-key.json`, embedded by the Node and the Rust client). After a rotation, apps still carrying the old key reject
  every new feed (signature mismatch) and **keep their last saved copy**: they stop getting sale events and catalog updates, and after
  30 days show the feed as out of date, until the user updates the app to a build with the new public key (the normal update path works, the
  updater key is a different one). Steps: new pair, replace the environment secret `FEED_SIGNING_KEY` (`--env feed`), replace
  `src/feed-public-key.json`, bump the version and release; publish the new feed only after
  the release is out, so most apps move to it together. If the feed key leaked, publish the release first and stop the feed workflow
  (disable it) until then, because the old key can sign anything the old apps accept.
- Neither key may be reused for the other purpose. Never print a key in a log; set secrets only from stdin (`gh secret set NAME --env ENV < file`).

### The feed address is fixed in the app

The app asks exactly `https://sapd.github.io/ccu-planner/feed/` and follows no redirects. If the feed ever moves (a custom domain, a
renamed repository or user), the old address must keep serving the files, or every installed app reports the feed as unreachable
without saying why: a move needs an app release that carries the new address, and the old site must stay up until that release is
widely installed.

### Fallback: releasing from your own machines (macOS, local)

Only if GitHub Actions is unavailable. `release.mjs` writes the same files to `release/<version>/` and prints a
`gh release create --draft` command that uploads them (including `latest.json`); publish the draft by hand as above.
Its file names use hyphens (`CCU-Planner_...`), GitHub's own builds use dots; the URLs in the `latest.json` it writes match its own names.


```sh
npm run release -- --version 0.2.0 --notes "What changed, in plain words"
# or --notes-file notes.md, or put the text in release-notes/0.2.0.md
```

The script:

1. Sets the version in `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `app/package.json` and
   `app/package-lock.json` (or, without `--version`, checks they already agree). It does not commit:
   review the diff and commit `Release vX.Y.Z` yourself.
2. Runs `tauri build --bundles app,dmg`, signing the updater artifact. It builds a universal app when
   both Rust targets (`aarch64-apple-darwin`, `x86_64-apple-darwin`) are installed, otherwise for this
   Mac's architecture only, and says which. (`--universal` / `--host-only` force it.)
3. Writes `release/<version>/` (git-ignored): `CCU-Planner_<version>_<arch>.app.tar.gz`, its `.sig`,
   the `.dmg` and `latest.json` (Tauri static format: `version`, `notes`, `pub_date`,
   `platforms.<target>.{signature,url}`; the URLs point at `https://github.com/Sapd/ccu-planner/releases/download/v<version>/<file>`).
4. Prints the `gh release create --draft` command to upload; it uploads nothing itself.

Before running it, do the checks from section 1 (`npm test`, `vite build`, `cargo test`).

### Releasing the Windows installer (built on the PC, signed on the Mac)

The private key never leaves the Mac. The PC builds an unsigned NSIS installer; the Mac signs it and
adds it to the same `latest.json`. One version = both steps (do the macOS release first or after, in any order;
`--add-windows` merges into an existing `release/<version>/latest.json`).

1. On the PC (needs Node, Rust MSVC and Visual Studio C++ tools; `npm ci` at the root and in `app/` once):

   ```
   npm run release -- --windows --version 0.1.1
   ```

   It sets the version like the Mac run does, builds `tauri build --bundles nsis` with the updater
   artifacts switched off (so it needs no key) and copies the installer to
   `release/<version>/windows/CCU-Planner_<version>_x64-setup.exe`. Keep the PC's checkout on the same commit as the Mac's.
2. Copy that file to the Mac (`scp windows:.../CCU-Planner_<version>_x64-setup.exe .`).
3. On the Mac:

   ```
   npm run release -- --add-windows ./CCU-Planner_0.1.1_x64-setup.exe --version 0.1.1 [--notes "..."]
   ```

   It copies the installer into `release/<version>/`, signs it with `tauri signer sign -f <key path>`
   (writes `<installer>.sig`), and adds `platforms["windows-x86_64"]` (signature and URL of the `.exe`) to
   `release/<version>/latest.json`. Tauri's updater uses the NSIS `-setup.exe` itself as the update artifact.
   Without `--notes` the notes already in that `latest.json` are kept.

The `.exe` is the first-install file as well. It is not Authenticode-signed (section 4), so SmartScreen warns.
Tested end to end on 2026-11-20 with a throw-away 0.1.1 (built on Windows 11, signed on the Mac, output deleted again).

### Rollback and trust

To pull a bad release, delete it or turn it back into a draft; "latest" then points at the previous
published release. Installed apps only move to a version higher than their own, so a bad version that
was already installed needs a fixed higher version. Only the artifacts are signed, not `latest.json`
itself; the HTTPS download from github.com is what protects the pointer, and the signature protects the files.

### Not done yet

- **Windows Authenticode signing**: the installer is built and update-signed (see above) but not code-signed.
- **macOS signing**: without an Apple Developer ID, builds are ad-hoc signed and not notarised, so
  Gatekeeper warns on the first open of a downloaded copy (right-click, Open). Updates installed by the
  app itself are not affected by that quarantine. Set up a Developer ID and notarisation (section 3)
  to remove the warning.
- Each ad-hoc signed update has a new code identity, so macOS may ask once more for keychain access to the
  saved RSI session after an update. The tour/"explainer seen" flag lives in the old web-view storage and is not
  migrated, so it shows once after the identifier change.

## Open items before a public release

- **Public name and identifier.** Decided 2026-11-20: name "CCU Planner", identifier
  `eu.sapd.ccuplanner` (it was `com.ccuplanner.desktop`; the app moves the old data folder and
  keychain entry on first start). Changing it again would move the data folder
  (`~/Library/Application Support/<identifier>`, `%APPDATA%\<identifier>`, `~/.local/share/<identifier>`).
  `publisher` and `copyright` in `tauri.conf.json` are "Denis Arnst" and "© 2026 Denis Arnst".
  Check CIG's fan-site rules for the name and for the ship pictures (they are downloaded per user,
  never bundled; keep it that way).
- **RSI user-agent and terms.** The CLI sync client rewrites `HeadlessChrome` to `Chrome` in the
  user agent (`src/session.mjs`) and automates a logged-in account on undocumented endpoints. The
  decision was deferred: read RSI's terms on automated access, then either send an honest client
  name or document the risk.
- **EUR/VAT.** Not verified on a live account (the developer's account is USD). Do not tell
  euro-paying users the prices are right until someone with an EUR account has tested it.
- **Sync without Node (roadmap phase 5).** The desktop app cannot sync by itself: syncing is the
  Node CLI (`npm run sync`, Playwright for the login). A public build needs an in-app login and a
  Rust or in-app sync, or the release must say that Node and a checkout are required.
- **Signing accounts.** Apple Developer ID, a Windows certificate (or accept SmartScreen), the
  updater key pair.
- **First real run of the bundles** on macOS, Windows and Linux, and of the Rust store with real
  data (it has only been run by tests).
