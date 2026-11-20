// Rebuilds app/src/lib/sample-data.json (the app's "Try with sample data") from test/fixtures/raw-small.json.
// Run: node scripts/build-sample.mjs. test/onboarding.test.mjs fails when the committed file is out of date.
import fs from 'node:fs';
import { buildSample } from '../src/logic/sampleData.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../test/fixtures/raw-small.json', import.meta.url), 'utf8'));
fs.writeFileSync(new URL('../app/src/lib/sample-data.json', import.meta.url), `${JSON.stringify(buildSample(fixture), null, 2)}\n`);
console.log('wrote app/src/lib/sample-data.json');
