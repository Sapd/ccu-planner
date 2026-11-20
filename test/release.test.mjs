import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertVersion, readVersions, versionsAgree, setTauriConfVersion, setCargoTomlVersion, setCargoLockVersion,
  setPackageLockVersion, platformKeys, artifactUrl, buildLatestJson, uploadCommands, windowsInstallerName,
} from '../scripts/release-lib.mjs';

const conf = '{\n  "productName": "CCU Planner",\n  "version": "0.1.0",\n  "identifier": "eu.sapd.ccuplanner"\n}\n';
const cargo = '[package]\nname = "x"\nversion = "0.1.0"\n\n[dependencies]\nfoo = { version = "1" }\n';

test('versions are read, compared and rewritten without touching other fields', () => {
  assert.throws(() => assertVersion('1.2'));
  assert.equal(assertVersion('0.1.1'), '0.1.1');
  const v = readVersions({ tauriConf: conf, cargoToml: cargo, appPackage: '{"version":"0.1.0"}' });
  assert.equal(versionsAgree(v), '0.1.0');
  assert.equal(versionsAgree({ ...v, npm: '0.2.0' }), null);
  assert.equal(JSON.parse(setTauriConfVersion(conf, '0.1.1')).version, '0.1.1');
  assert.match(setTauriConfVersion(conf, '0.1.1'), /"identifier": "eu.sapd.ccuplanner"/);
  const c = setCargoTomlVersion(cargo, '0.1.1');
  assert.match(c, /^version = "0.1.1"$/m);
  assert.match(c, /foo = \{ version = "1" \}/);
  const lock = '[[package]]\nname = "a"\nversion = "1.0.0"\n\n[[package]]\nname = "ccu-planner-desktop"\nversion = "0.1.0"\n';
  assert.match(setCargoLockVersion(lock, 'ccu-planner-desktop', '0.1.1'), /ccu-planner-desktop"\nversion = "0.1.1"/);
  assert.match(setCargoLockVersion(lock, 'ccu-planner-desktop', '0.1.1'), /name = "a"\nversion = "1.0.0"/);
  const crlf = lock.replace(/\n/g, '\r\n'); // Git on Windows checks Cargo.lock out with CRLF
  assert.match(setCargoLockVersion(crlf, 'ccu-planner-desktop', '0.1.1'), /ccu-planner-desktop"\r\nversion = "0.1.1"\r\n/);
  const pl = JSON.parse(setPackageLockVersion('{"version":"0.1.0","packages":{"":{"version":"0.1.0"},"x":{"version":"9"}}}', '0.1.1'));
  assert.deepEqual([pl.version, pl.packages[''].version, pl.packages.x.version], ['0.1.1', '0.1.1', '9']);
});

test('latest.json follows the Tauri static format and merges platforms of one version', () => {
  assert.deepEqual(platformKeys('universal-apple-darwin'), ['darwin-aarch64', 'darwin-x86_64']);
  assert.deepEqual(platformKeys(undefined, 'arm64'), ['darwin-aarch64']);
  assert.equal(artifactUrl('0.1.1', 'CCU Planner_0.1.1.app.tar.gz'), 'https://github.com/Sapd/ccu-planner/releases/download/v0.1.1/CCU%20Planner_0.1.1.app.tar.gz');
  const a = buildLatestJson({ version: '0.1.1', notes: 'n', pubDate: 'd', platforms: { 'darwin-aarch64': { signature: 's', url: 'u' } } });
  assert.deepEqual(Object.keys(a), ['version', 'notes', 'pub_date', 'platforms']);
  const b = buildLatestJson({ version: '0.1.1', notes: 'n', pubDate: 'd', platforms: { 'windows-x86_64': { signature: 's2', url: 'u2' } }, existing: a });
  assert.deepEqual(Object.keys(b.platforms).sort(), ['darwin-aarch64', 'windows-x86_64']);
  const c = buildLatestJson({ version: '0.2.0', notes: '', pubDate: 'd', platforms: { 'darwin-aarch64': { signature: 'x', url: 'y' } }, existing: a });
  assert.deepEqual(Object.keys(c.platforms), ['darwin-aarch64']);
});

test('the Windows installer gets the windows-x86_64 key and a URL-safe name, and only for its own version', () => {
  assert.deepEqual(platformKeys('x86_64-pc-windows-msvc'), ['windows-x86_64']);
  assert.equal(windowsInstallerName('CCU Planner_0.1.1_x64-setup.exe', '0.1.1'), 'CCU-Planner_0.1.1_x64-setup.exe');
  assert.throws(() => windowsInstallerName('CCU Planner_0.1.0_x64-setup.exe', '0.1.1'));
});

test('upload hint creates a draft release that includes latest.json', () => {
  const lines = uploadCommands('0.1.1');
  const create = lines.find((l) => l.startsWith('gh release create'));
  assert.ok(create.includes('v0.1.1') && create.includes('--draft') && create.includes('release/0.1.1/*'));
});
