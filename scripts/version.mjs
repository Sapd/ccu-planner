#!/usr/bin/env node
// Keep the app version in one step across all files that carry it.
//   npm run version -- 0.2.0                 bump tauri.conf.json, Cargo.toml, Cargo.lock, app/package.json, app/package-lock.json
//                                            and move the data feed's replay floor (src/feed-floor.json) to one day ago
//   npm run version -- --check [v0.2.0]      fail unless all files agree (and, if given, equal the tag/version and the floor is current)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertVersion, readVersions, versionsAgree, setTauriConfVersion, setCargoTomlVersion, setCargoLockVersion,
  setPackageJsonVersion, setPackageLockVersion,
} from './release-lib.mjs';

export function versionFiles(root) {
  const tauri = path.join(root, 'app', 'src-tauri');
  return {
    tauriConf: path.join(tauri, 'tauri.conf.json'),
    cargoToml: path.join(tauri, 'Cargo.toml'),
    cargoLock: path.join(tauri, 'Cargo.lock'),
    appPackage: path.join(root, 'app', 'package.json'),
    appLock: path.join(root, 'app', 'package-lock.json'),
    feedFloor: path.join(root, 'src', 'feed-floor.json'),
  };
}

const read = (p) => fs.readFileSync(p, 'utf8');

// Returns the version all three primary files carry, or null when they disagree.
export function currentVersion(root) {
  const f = versionFiles(root);
  return versionsAgree(readVersions({ tauriConf: read(f.tauriConf), cargoToml: read(f.cargoToml), appPackage: read(f.appPackage) }));
}

/** The oldest feed the release accepts: one day before the bump, to the second (the feed is rebuilt hourly, so the live one is always newer). */
export const feedFloorAt = (now = Date.now()) => new Date(Math.floor((now - 24 * 3600e3) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const FLOOR_MAX_AGE_MS = 45 * 24 * 3600e3;

export function bumpVersion(root, version, now = Date.now()) {
  assertVersion(version);
  const f = versionFiles(root);
  fs.writeFileSync(f.tauriConf, setTauriConfVersion(read(f.tauriConf), version));
  fs.writeFileSync(f.cargoToml, setCargoTomlVersion(read(f.cargoToml), version));
  fs.writeFileSync(f.cargoLock, setCargoLockVersion(read(f.cargoLock), 'ccu-planner-desktop', version));
  fs.writeFileSync(f.appPackage, setPackageJsonVersion(read(f.appPackage), version));
  fs.writeFileSync(f.appLock, setPackageLockVersion(read(f.appLock), version));
  fs.writeFileSync(f.feedFloor, `${JSON.stringify({ minGeneratedAt: feedFloorAt(now) }, null, 2)}\n`);
}

// expected may be "0.2.0" or a tag "v0.2.0". Throws with a readable message on any mismatch.
export function checkVersion(root, expected, now = Date.now()) {
  const f = versionFiles(root);
  const v = readVersions({ tauriConf: read(f.tauriConf), cargoToml: read(f.cargoToml), appPackage: read(f.appPackage) });
  const agreed = versionsAgree(v);
  if (!agreed) throw new Error(`versions disagree: tauri.conf.json ${v.tauri}, Cargo.toml ${v.cargo}, app/package.json ${v.npm}`);
  const lockCrate = new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "ccu-planner-desktop"\\r?\\nversion = "${agreed.replace(/\./g, '\\.')}"`);
  if (!lockCrate.test(read(f.cargoLock))) throw new Error(`Cargo.lock does not carry ${agreed} for ccu-planner-desktop`);
  const lock = JSON.parse(read(f.appLock));
  if (lock.version !== agreed || (lock.packages?.[''] && lock.packages[''].version !== agreed)) throw new Error(`app/package-lock.json does not carry ${agreed}`);
  if (expected !== undefined) {
    const want = assertVersion(expected.replace(/^v/, ''));
    if (want !== agreed) throw new Error(`tag/version ${want} does not match the files (${agreed})`);
    // A release must carry a recent replay floor; `npm run version -- X.Y.Z` sets it (running it again for the same version refreshes it).
    const floor = Date.parse(JSON.parse(read(f.feedFloor)).minGeneratedAt);
    if (!Number.isFinite(floor) || floor > now || now - floor > FLOOR_MAX_AGE_MS) throw new Error('src/feed-floor.json is missing, in the future or older than 45 days: run npm run version -- ' + agreed);
  }
  return agreed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [a, b] = process.argv.slice(2);
  try {
    if (a === '--check') console.log(`Version ${checkVersion(root, b)} is consistent.`);
    else if (a && !a.startsWith('--')) {
      bumpVersion(root, a);
      console.log(`Version set to ${a} in tauri.conf.json, Cargo.toml, Cargo.lock, app/package.json, app/package-lock.json and src/feed-floor.json (not committed).`);
    } else throw new Error('usage: npm run version -- X.Y.Z   |   npm run version -- --check [vX.Y.Z]');
  } catch (e) { console.error(`version: ${e.message}`); process.exit(1); }
}
