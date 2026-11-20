import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { moveDataDir, hasPlannerData, bothNote, migrateDefault, MIGRATING, WARNED } from '../src/data-migrate.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-mig-'));
const seed = (dir) => {
  fs.mkdirSync(path.join(dir, 'data/images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/hangar.json'), '{"rev":3}');
  fs.writeFileSync(path.join(dir, 'data/images/1.png'), 'png');
};

test('moves when the new folder is missing, empty or holds only foreign files', () => {
  for (const pre of [0, 1, 2]) {
    const t = tmp(), oldDir = path.join(t, 'old'), newDir = path.join(t, 'new');
    seed(oldDir);
    if (pre === 1) fs.mkdirSync(newDir);
    if (pre === 2) { fs.mkdirSync(path.join(newDir, 'data'), { recursive: true }); fs.writeFileSync(path.join(newDir, 'EBWebView'), 'x'); fs.writeFileSync(path.join(newDir, 'data/.DS_Store'), 'x'); }
    assert.equal(moveDataDir(oldDir, newDir), 'moved');
    assert.ok(!fs.existsSync(oldDir));
    assert.ok(!fs.existsSync(path.join(newDir, MIGRATING)));
    assert.equal(fs.readFileSync(path.join(newDir, 'data/hangar.json'), 'utf8'), '{"rev":3}');
    assert.equal(fs.readFileSync(path.join(newDir, 'data/images/1.png'), 'utf8'), 'png');
    if (pre === 2) assert.ok(fs.existsSync(path.join(newDir, 'EBWebView')));
  }
});

test('both folders with planner data: nothing moves, one warning naming both paths, only once', () => {
  const t = tmp(), oldDir = path.join(t, 'com.ccuplanner.desktop'), newDir = path.join(t, 'eu.sapd.ccuplanner');
  seed(oldDir);
  fs.mkdirSync(path.join(newDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(newDir, 'data/plans.json'), 'mine');
  assert.equal(moveDataDir(oldDir, newDir), 'both');
  const logs = [];
  assert.equal(migrateDefault(newDir, (m) => logs.push(m)), 'both');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(oldDir) && logs[0].includes(newDir));
  assert.ok(fs.existsSync(path.join(newDir, WARNED)));
  migrateDefault(newDir, (m) => logs.push(m));
  assert.equal(logs.length, 1);
  assert.equal(fs.readFileSync(path.join(newDir, 'data/plans.json'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(oldDir, 'data/hangar.json')));
  assert.ok(bothNote(oldDir, newDir).includes(newDir));
});

test('old folder without planner data is ignored and creates nothing', () => {
  const t = tmp(), oldDir = path.join(t, 'old'), newDir = path.join(t, 'new');
  fs.mkdirSync(path.join(oldDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'data/.DS_Store'), 'x');
  assert.equal(moveDataDir(oldDir, newDir), 'noold');
  assert.ok(!fs.existsSync(newDir));
  assert.equal(hasPlannerData(oldDir), false);
});

test('an interrupted move is finished by the next call', () => {
  const t = tmp(), oldDir = path.join(t, 'old'), newDir = path.join(t, 'new');
  seed(oldDir);
  fs.writeFileSync(path.join(oldDir, 'data/plans.json'), 'p');
  fs.mkdirSync(path.join(newDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(newDir, MIGRATING), '');
  fs.renameSync(path.join(oldDir, 'data/plans.json'), path.join(newDir, 'data/plans.json'));
  assert.equal(moveDataDir(oldDir, newDir), 'moved');
  assert.ok(fs.existsSync(path.join(newDir, 'data/hangar.json')) && fs.existsSync(path.join(newDir, 'data/plans.json')));
  assert.ok(!fs.existsSync(oldDir));
});

test('default folder: migrated before the first write; an explicit CCU_DATA is never touched', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const run = (env) => {
    const home = tmp();
    const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : process.platform === 'win32' ? path.join(home, 'AppData', 'Roaming') : path.join(home, '.local', 'share');
    const oldDir = path.join(base, 'com.ccuplanner.desktop');
    seed(oldDir);
    const code = `import(${JSON.stringify(pathToFileURL(path.join(root, 'src/data.mjs')).href)}).then((d) => { d.saveOverrides({ rev: 0, ships: {} }); });`;
    const r = spawnSync(process.execPath, ['-e', code], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, ...env(home) }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return { oldDir, newDir: path.join(base, 'eu.sapd.ccuplanner'), home };
  };
  const a = run(() => ({}));
  assert.ok(fs.existsSync(path.join(a.newDir, 'data/hangar.json')), 'old data moved before the write');
  assert.ok(fs.existsSync(path.join(a.newDir, 'data/price-overrides.json')));
  assert.ok(!fs.existsSync(a.oldDir));
  const b = run((home) => ({ CCU_DATA: path.join(home, 'explicit') }));
  assert.ok(fs.existsSync(path.join(b.oldDir, 'data/hangar.json')), 'old folder untouched');
  assert.ok(!fs.existsSync(b.newDir), 'new folder not created');
  assert.ok(fs.existsSync(path.join(b.home, 'explicit/price-overrides.json')));
});
