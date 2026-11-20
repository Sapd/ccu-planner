import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A data folder written from test/fixtures/raw-small.json (ships Alpha, Beta, ...), never from real data.
export const fixtureCopy = () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../fixtures/raw-small.json', import.meta.url), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-mcp-'));
  const put = (name, value) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  // The server refuses a catalog that names no currency, so the copy names USD.
  put('catalog.json', { ...raw.catalog, app: { ...raw.catalog.app, pricing: { currencyCode: 'USD', currencySymbol: '$', exponent: 2 } } });
  put('ship-details.json', raw.details);
  raw.upgrades.forEach((u, i) => put(`upgrades/u${i}.json`, u));
  put('hangar.json', raw.hangar);
  put('buyback.json', raw.buyback);
  put('offer-history.jsonl', raw.history);
  return dir;
};
