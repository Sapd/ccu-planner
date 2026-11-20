// The "Try with sample data" data set: the small test fixture plus one goal. Made-up ships, nothing of a real account.
import { newState } from './chains.mjs';
import { addChain } from './goals.mjs';

/** RawData of the sample: `fixture` is test/fixtures/raw-small.json. Pure. */
export function buildSample(fixture) {
  const plans = newState();
  addChain(plans, { name: 'Sample goal', base: 1, target: 3, priority: 'normal', mode: 'watch' });
  // The same file every time, so a test can tell when the bundled copy is stale.
  for (const c of Object.values(plans.chains)) c.createdAt = fixture.catalog.fetchedAt;
  const catalog = { ...fixture.catalog, app: { pricing: { currencyCode: 'USD', currencySymbol: '$', exponent: 2, taxRate: 0 } } };
  // The sample's chain: the Alpha → Beta CCU in the hangar is the owned link, and the Warbond into Gamma from Beta ($15, cheaper than
  // $20 straight from Alpha) is the missing one. The fixture itself stays as it is (other tests use it).
  const upgrades = [...fixture.upgrades, { fetchedAt: fixture.catalog.fetchedAt, fromId: 2, fromName: 'Beta', pricing: {}, targets: [{ toId: 3, toName: 'Gamma', skus: [{ id: 5002, available: true, upgradeUsdCents: 1500 }] }] }];
  return { ...fixture, catalog, upgrades, plans, overrides: null, saleEvents: null, images: null, saleHistory: null, planSnapshots: null };
}
