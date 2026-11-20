#!/usr/bin/env node
// Local release: bump or check the version, build, sign the updater artifacts and write
// release/<version>/ with the files and latest.json. Uploads nothing and commits nothing.
// The signing key stays on the Mac; the Windows installer is built on the PC and signed on the Mac:
//   Mac:     npm run release -- [--version X.Y.Z] [--notes "text" | --notes-file path] [--universal]
//   Windows: npm run release -- --windows --version X.Y.Z        (no key; writes release/<version>/windows/)
//   Mac:     npm run release -- --add-windows <setup.exe> --version X.Y.Z   (signs it, adds windows-x86_64 to latest.json)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertVersion, readVersions, versionsAgree, setTauriConfVersion, setCargoTomlVersion, setCargoLockVersion,
  setPackageJsonVersion, setPackageLockVersion, platformKeys, artifactUrl, buildLatestJson, uploadCommands, windowsInstallerName,
} from './release-lib.mjs';
import { feedFloorAt } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const TAURI = path.join(APP, 'src-tauri');
const files = {
  tauriConf: path.join(TAURI, 'tauri.conf.json'),
  cargoToml: path.join(TAURI, 'Cargo.toml'),
  cargoLock: path.join(TAURI, 'Cargo.lock'),
  appPackage: path.join(APP, 'package.json'),
  appLock: path.join(APP, 'package-lock.json'),
};
const read = (p) => fs.readFileSync(p, 'utf8');
const fail = (message) => { console.error(`release: ${message}`); process.exit(1); };

function parseArgs(argv) {
  const out = { universal: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`); return v; };
    if (a === '--version') out.version = value();
    else if (a === '--notes') out.notes = value();
    else if (a === '--notes-file') out.notesFile = value();
    else if (a === '--universal') out.universal = true;
    else if (a === '--host-only') out.universal = false;
    else if (a === '--windows') out.windows = true;
    else if (a === '--add-windows') out.addWindows = value();
    else fail(`unknown argument ${a}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.windows && args.addWindows) fail('--windows and --add-windows are separate steps (build on the PC, then sign on the Mac).');
if (args.windows && process.platform !== 'win32') fail('--windows builds the Windows installer; run it on the Windows PC.');
if (!args.windows && !args.addWindows && process.platform !== 'darwin') fail('this script builds the macOS release; run it on the Mac (or with --windows on the PC).');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const spawnOpts = process.platform === 'win32' ? { shell: true } : {};
// The Tauri CLI reads the key file itself; only its path travels, never its content.
const resolveKeyPath = () => {
  const keyPath = process.env.CCU_SIGNING_KEY_FILE || path.join(os.homedir(), '.tauri', 'ccuplanner.key');
  if (!fs.existsSync(keyPath)) fail(`signing key not found at ${keyPath} (override with CCU_SIGNING_KEY_FILE).`);
  return keyPath;
};

// 1. Version: bump all files together, or check they already agree.
const current = readVersions({ tauriConf: read(files.tauriConf), cargoToml: read(files.cargoToml), appPackage: read(files.appPackage) });
let version = args.version ? assertVersion(args.version) : versionsAgree(current);
if (!version) fail(`versions disagree (tauri ${current.tauri}, cargo ${current.cargo}, npm ${current.npm}); pass --version X.Y.Z.`);
if (args.addWindows) {
  if (version !== versionsAgree(current)) console.warn(`Note: the repository files say ${versionsAgree(current) ?? 'different versions'}, signing for ${version} as asked.`);
} else if (version !== versionsAgree(current)) {
  fs.writeFileSync(files.tauriConf, setTauriConfVersion(read(files.tauriConf), version));
  fs.writeFileSync(files.cargoToml, setCargoTomlVersion(read(files.cargoToml), version));
  fs.writeFileSync(files.cargoLock, setCargoLockVersion(read(files.cargoLock), 'ccu-planner-desktop', version));
  fs.writeFileSync(files.appPackage, setPackageJsonVersion(read(files.appPackage), version));
  fs.writeFileSync(files.appLock, setPackageLockVersion(read(files.appLock), version));
  fs.writeFileSync(path.join(ROOT, 'src', 'feed-floor.json'), `${JSON.stringify({ minGeneratedAt: feedFloorAt() }, null, 2)}\n`);
  console.log(`Version set to ${version} in tauri.conf.json, Cargo.toml, Cargo.lock, app/package.json, app/package-lock.json and src/feed-floor.json (not committed).`);
} else {
  console.log(`Version ${version} already consistent.`);
}

// 2. Notes.
let notes = args.notes ?? '';
if (!notes && args.notesFile) notes = read(path.resolve(args.notesFile));
if (!notes) {
  const auto = path.join(ROOT, 'release-notes', `${version}.md`);
  if (fs.existsSync(auto)) notes = read(auto);
}
notes = notes.trim();
if (!notes) console.warn('Warning: no release notes (--notes, --notes-file or release-notes/<version>.md).');

// Windows build (on the PC): no signing key is needed or read here. The updater artifact is signed
// afterwards on the Mac with --add-windows, so the private key never leaves the Mac.
if (args.windows) {
  const bundleWin = path.join(TAURI, 'target', 'release', 'bundle', 'nsis');
  for (const f of fs.existsSync(bundleWin) ? fs.readdirSync(bundleWin).filter((x) => x.endsWith('-setup.exe')) : []) fs.rmSync(path.join(bundleWin, f), { force: true });
  // Without the key the build must not try to sign: a config file turns the updater artifacts off for this build.
  const noSign = path.join(os.tmpdir(), `ccu-no-updater-${process.pid}.json`);
  fs.writeFileSync(noSign, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
  const buildWin = spawnSync(npx, ['tauri', 'build', '--bundles', 'nsis', '--config', `"${noSign}"`], { cwd: APP, stdio: 'inherit', ...spawnOpts });
  fs.rmSync(noSign, { force: true });
  if (buildWin.status !== 0) fail(`tauri build failed (exit ${buildWin.status}).`);
  const setups = fs.existsSync(bundleWin) ? fs.readdirSync(bundleWin).filter((f) => f.endsWith('-setup.exe') && f.includes(`_${version}_`)) : [];
  if (setups.length !== 1) fail(`expected exactly one setup.exe for ${version} in ${bundleWin}, found ${setups.length}.`);
  const outWin = path.join(ROOT, 'release', version, 'windows');
  fs.mkdirSync(outWin, { recursive: true });
  const exeName = windowsInstallerName(setups[0], version);
  fs.copyFileSync(path.join(bundleWin, setups[0]), path.join(outWin, exeName));
  console.log(`\nWindows installer: release/${version}/windows/${exeName}`);
  console.log('Copy it to the Mac and run there:');
  console.log(`  npm run release -- --add-windows <path>/${exeName} --version ${version}`);
  process.exit(0);
}

// Windows installer from the PC (--add-windows): sign it here, where the key lives, and add the
// windows-x86_64 entry to this version's latest.json.
if (args.addWindows) {
  const src = path.resolve(args.addWindows);
  if (!fs.existsSync(src) || !src.toLowerCase().endsWith('.exe')) fail(`${src} is not an existing .exe (the installer built with --windows).`);
  const outDir = path.join(ROOT, 'release', version);
  fs.mkdirSync(outDir, { recursive: true });
  const exeName = windowsInstallerName(path.basename(src), version);
  const exe = path.join(outDir, exeName);
  fs.copyFileSync(src, exe);
  fs.rmSync(`${exe}.sig`, { force: true });
  const sign = spawnSync(npx, ['tauri', 'signer', 'sign', '-f', resolveKeyPath(), exe], {
    cwd: APP, stdio: 'inherit', ...spawnOpts,
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' },
  });
  if (sign.status !== 0 || !fs.existsSync(`${exe}.sig`)) fail('signing the Windows installer failed.');
  const latestPath = path.join(outDir, 'latest.json');
  const existing = fs.existsSync(latestPath) ? JSON.parse(read(latestPath)) : null;
  const latest = buildLatestJson({
    version, notes: notes || (existing?.version === version ? existing.notes : ''), pubDate: new Date().toISOString(),
    platforms: { 'windows-x86_64': { signature: read(`${exe}.sig`).trim(), url: artifactUrl(version, exeName) } }, existing,
  });
  fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');
  console.log(`\nWindows installer signed and added to release/${version}/latest.json (platforms: ${Object.keys(latest.platforms).join(', ')}).`);
  console.log('To publish, copy it to the update server:\n');
  for (const line of uploadCommands(version)) console.log(line);
  process.exit(0);
}

// 3. Signing key: only its path goes into the build's environment (the Tauri CLI reads the file
//    itself); the script never reads or prints the key.
const keyPath = resolveKeyPath();
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: keyPath, // for `tauri build` this may be a file path (see `tauri build --help`)
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
};
delete env.CCU_SIGNING_KEY_FILE;

// 4. Target: universal when both Rust targets are installed, else the host architecture.
const installed = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' }).stdout ?? '';
const both = installed.includes('aarch64-apple-darwin') && installed.includes('x86_64-apple-darwin');
const universal = args.universal ?? both;
if (universal && !both) fail('--universal needs both aarch64-apple-darwin and x86_64-apple-darwin (rustup target add ...).');
const target = universal ? 'universal-apple-darwin' : undefined;
// The machine's real architecture (process.arch would say x64 under Rosetta).
const hostArch = (spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout ?? '').trim() === 'arm64' ? 'arm64' : 'x64';
const keys = platformKeys(target, hostArch);
console.log(universal ? 'Building a universal macOS app (arm64 + x86_64).'
  : `Building for this Mac only (${hostArch === 'arm64' ? 'arm64' : 'x86_64'}); the other architecture's Rust target is not installed.`);

// 5. Build. Old artifacts of earlier builds would be picked up below, so clear them first.
const bundleDir = path.join(TAURI, 'target', ...(target ? [target] : []), 'release', 'bundle');
for (const [sub, test] of [['macos', (f) => /\.app\.tar\.gz(\.sig)?$/.test(f)], ['dmg', (f) => f.endsWith('.dmg')]]) {
  const dir = path.join(bundleDir, sub);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(test) : []) fs.rmSync(path.join(dir, f), { force: true });
}
const tauriArgs = ['tauri', 'build', '--bundles', 'app,dmg', ...(target ? ['--target', target] : [])];
const build = spawnSync('npx', tauriArgs, { cwd: APP, env, stdio: 'inherit' });
if (build.status !== 0) fail(`tauri build failed (exit ${build.status}).`);

// 6. Collect artifacts.
const tarballs = fs.existsSync(path.join(bundleDir, 'macos')) ? fs.readdirSync(path.join(bundleDir, 'macos')).filter((f) => f.endsWith('.app.tar.gz')) : [];
if (tarballs.length > 1) fail(`more than one .app.tar.gz in ${path.join(bundleDir, 'macos')}: ${tarballs.join(', ')}`);
const tarball = tarballs[0];
if (!tarball) fail(`no .app.tar.gz in ${path.join(bundleDir, 'macos')} (is createUpdaterArtifacts on?).`);
const sigFile = path.join(bundleDir, 'macos', `${tarball}.sig`);
if (!fs.existsSync(sigFile)) fail('the build produced no .sig file; check the signing key.');
const arch = universal ? 'universal' : hostArch === 'arm64' ? 'aarch64' : 'x64';
const safe = (name) => name.replace(/\s+/g, '-');
const outDir = path.join(ROOT, 'release', version);
fs.mkdirSync(outDir, { recursive: true });
const tarName = safe(tarball.replace(/\.app\.tar\.gz$/, `_${version}_${arch}.app.tar.gz`));
fs.copyFileSync(path.join(bundleDir, 'macos', tarball), path.join(outDir, tarName));
fs.copyFileSync(sigFile, path.join(outDir, `${tarName}.sig`));
const dmgDir = path.join(bundleDir, 'dmg');
// Only this version's disk image (the folder was cleared before the build; the name check is a second guard).
const dmgs = (fs.existsSync(dmgDir) ? fs.readdirSync(dmgDir) : []).filter((f) => f.endsWith('.dmg') && f.includes(`_${version}_`));
if (dmgs.length !== 1) fail(`expected exactly one .dmg for ${version} in ${dmgDir}, found ${dmgs.length}.`);
fs.copyFileSync(path.join(dmgDir, dmgs[0]), path.join(outDir, safe(dmgs[0])));

// 7. latest.json (merges platforms already written for this version).
const signature = read(sigFile).trim();
const latestPath = path.join(outDir, 'latest.json');
const existing = fs.existsSync(latestPath) ? JSON.parse(read(latestPath)) : null;
const entry = { signature, url: artifactUrl(version, tarName) };
const latest = buildLatestJson({
  version, notes, pubDate: new Date().toISOString(),
  platforms: Object.fromEntries(keys.map((k) => [k, entry])), existing,
});
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');

console.log(`\nRelease ${version} is in release/${version}/ (nothing was uploaded or committed).`);
console.log('To publish, copy it to the update server:\n');
for (const line of uploadCommands(version)) console.log(line);
console.log('\nReplace <vm> and <webroot> with your server and its web root. See docs/RELEASING.md.');
