// The German translation is complete: every text marked for translation (t, tn, N_) and every text builder (loc) has a
// German entry, placeholders match, and switching the locale changes what the planner says. English stays the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  t, tn, setLocale, getLocale, withLocale, localeOf, listBuilders, listTwins, listTexts, hasText, addTranslations,
} from '../src/logic/i18n.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = [path.join(root, 'src'), path.join(root, 'app/src')];
const SKIP = new Set(['node_modules', 'i18n', 'dist']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js|svelte)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The top-level arguments of the call whose '(' is at `open`, as raw source slices. */
function callArgs(src, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      // skip the string (template literals may nest ${...} with strings; good enough for the texts here)
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === '\\') j++;
        else if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          let d = 1; j += 2;
          for (; j < src.length && d; j++) { if (src[j] === '{') d++; else if (src[j] === '}') d--; }
          j--;
        }
      }
      i = j;
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(src.slice(start, i)); return args; }
    } else if (c === ',' && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
  }
  return args;
}

/** The string value of a plain literal ('x', "x", `x` without ${}), or undefined. */
function literal(raw) {
  const s = raw.trim();
  const m = /^(['"`])([\s\S]*)\1$/.exec(s);
  if (!m) return undefined;
  if (m[1] === '`' && m[2].includes('${')) return null; // a built string: not allowed as a key
  // eslint-disable-next-line no-new-func
  return Function(`return ${s}`)();
}

/** Every marked text in the sources: { text, file }; and the calls whose key is built with ${} (errors). */
function markedTexts() {
  const found = [];
  const built = [];
  const re = /(?<![\w.$])(t|tn|N_)\(/g;
  for (const file of SOURCES.flatMap((d) => walk(d))) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/\b(t|tn|N_)\b/.test(src)) continue;
    // Only files that import the helpers (a local function called t elsewhere is not a text).
    if (!/i18n(\.svelte)?\.(m?js)['"]/.test(src) && !file.endsWith('i18n.mjs')) continue;
    if (file.endsWith(path.join('logic', 'i18n.mjs'))) continue;
    for (const m of src.matchAll(re)) {
      const args = callArgs(src, m.index + m[0].length - 1);
      const keys = m[1] === 'tn' ? args.slice(1, 3) : args.slice(0, 1);
      for (const raw of keys) {
        const v = literal(raw);
        const rel = path.relative(root, file);
        if (v === null) built.push(`${rel}: ${raw.trim().slice(0, 80)}`);
        else if (typeof v === 'string') found.push({ text: v, file: rel });
      }
    }
  }
  return { found, built };
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Load every German table, and every module that defines builders (the app's view modules included).
await import('../app/src/lib/i18n/de/index.js');
const logicDir = path.join(root, 'src/logic');
for (const f of fs.readdirSync(logicDir).filter((n) => n.endsWith('.mjs'))) await import(path.join(logicDir, f));
const viewDir = path.join(root, 'app/src/lib/view');
for (const f of fs.readdirSync(viewDir).filter((n) => n.endsWith('.mjs'))) await import(path.join(viewDir, f));

test('English is the default and t() returns the English text with its placeholders filled', () => {
  assert.equal(getLocale(), 'en');
  assert.equal(t('Show {n} more', { n: 3 }), 'Show 3 more');
  assert.equal(tn(1, '{n} step', '{n} steps'), '1 step');
  assert.equal(tn(2, '{n} step', '{n} steps'), '2 steps');
});

test('language tags map to a supported locale or none', () => {
  assert.equal(localeOf('de-DE'), 'de');
  assert.equal(localeOf('de_AT'), 'de');
  assert.equal(localeOf('en-US'), 'en');
  assert.equal(localeOf('fr'), null);
  assert.equal(localeOf(undefined), null);
  assert.equal(setLocale('fr'), 'en');
});

test('every text marked for translation has a German entry', () => {
  const { found, built } = markedTexts();
  assert.deepEqual(built, [], 'a text key must be a plain literal, not built with ${}');
  assert.ok(found.length > 100, `found only ${found.length} marked texts`);
  const missing = [...new Set(found.filter((f) => !hasText('de', f.text)).map((f) => `${f.file}: ${f.text}`))];
  assert.deepEqual(missing, []);
});

test('German texts keep the placeholders of their English text', () => {
  const bad = [];
  withLocale('de', () => {
    for (const en of listTexts('de')) {
      const want = placeholders(en);
      if (!want.length) continue;
      const params = Object.fromEntries(want.map((k) => [k, `«${k}»`]));
      const out = t(en, params);
      for (const k of want) if (!out.includes(`«${k}»`)) bad.push(`${en} -> ${out} (lost {${k}})`);
      if (/\{\w+\}/.test(out)) bad.push(`${en} -> ${out} (unknown placeholder left)`);
    }
  });
  assert.deepEqual(bad, []);
});

test('every text builder has a German twin, and no twin is left without its builder', () => {
  const keys = new Set(listBuilders());
  const twins = new Set(listTwins('de'));
  assert.ok(keys.size > 20, `found only ${keys.size} builders`);
  assert.deepEqual([...keys].filter((k) => !twins.has(k)), [], 'builders without German twin');
  assert.deepEqual([...twins].filter((k) => !keys.has(k)), [], 'German twins without builder');
});

test('two tables cannot give one English text different translations', () => {
  assert.throws(() => addTranslations('de', { texts: { 'Loading…': 'Something else' } }), /Two translations/);
});

test('switching the locale changes the text, and switching back restores English', () => {
  assert.equal(t('Loading…'), 'Loading…');
  assert.equal(withLocale('de', () => t('Loading…')), 'Wird geladen…');
  assert.equal(getLocale(), 'en');
});
