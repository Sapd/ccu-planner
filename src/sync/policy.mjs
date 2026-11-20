import { QUERIES } from './queries.mjs';
import { CATALOG_PATH, isCatalogBody } from './catalog-query.mjs';
export function validateRequest(method, path, body) {
  if (typeof path !== 'string' || /[\\#\s]|\.\.|%/i.test(path)) throw new Error('path not allowlisted');
  if (method === 'GET' && /^\/en\/account\/(pledges|buy-back-pledges)\?/.test(path) && body == null) return;
  if (method === 'POST' && path === '/api/ship-upgrades/setContextToken'
      && body && Object.keys(body).length === 4 && ['fromShipId', 'toShipId', 'toSkuId', 'pledgeId'].every((key) => body[key] === null)) return;
  if (method === 'POST' && path === '/pledge-store/api/upgrade/v2/graphql' && Array.isArray(body) && body.length && body.length <= 5 // RSI's own per-request limit
      && body.every((op) => Object.hasOwn(QUERIES, op.operationName) && op.query === QUERIES[op.operationName] && !/mutation/i.test(JSON.stringify(op)))) return;
  // The public store catalog: one pinned read-only browse query, no session (src/catalog-sync.mjs).
  if (method === 'POST' && path === CATALOG_PATH && isCatalogBody(body)) return;
  throw new Error('RSI request not allowlisted');
}
