// The one public, read-only request the store catalog sync sends: RSI's own browse query for the store pages.
// POST https://robertsspaceindustries.com/graphql. The anonymous catalog sync sends no cookies; the signed-in one sends the
// session's, through the same RsiClient / Rust transport as the upgrade queries. The text is pinned here and checked
// byte for byte by validateRequest (src/sync/policy.mjs); nothing else may be sent to /graphql.

import spec from './catalog-query.json' with { type: 'json' };

export const CATALOG_PATH = '/graphql';
export const CATALOG_OPERATION = 'GetBrowseSkusByFilter';
// The query text, the product ids and the tag facets it may be sent with live in catalog-query.json, which the desktop app's Rust allowlist includes too.
export const CATALOG_QUERY = spec.query;
export const CATALOG_PRODUCTS = spec.products;
export const CATALOG_FACETS = spec.facets;

export const CATALOG_PAGE_SIZE = 100;
const MAX_PAGE = 100;

const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (o, keys) => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

/** The variables of one page: product ids, optionally narrowed by one tag facet. */
export function catalogVariables(products, page, tagFilter = null) {
  return {
    query: {
      limit: CATALOG_PAGE_SIZE, page,
      skus: { products, ...(tagFilter ? { filtersFromTags: { facetIdentifiers: [tagFilter.facet], tagIdentifiers: [tagFilter.tag] } } : {}) },
      sort: { direction: 'desc', field: 'weight' },
    },
  };
}

/** The request body for one page. */
export const catalogBody = (products, page, tagFilter = null) => ({ operationName: CATALOG_OPERATION, query: CATALOG_QUERY, variables: catalogVariables(products, page, tagFilter) });

/** True only for the exact body shape catalogBody builds: the pinned query, a page of at most 100, product ids, one optional tag facet, the fixed sort. */
export function isCatalogBody(body) {
  if (!plainObject(body) || !sameKeys(body, ['operationName', 'query', 'variables'])) return false;
  if (body.operationName !== CATALOG_OPERATION || body.query !== CATALOG_QUERY || /mutation/i.test(JSON.stringify(body))) return false;
  const v = body.variables;
  if (!plainObject(v) || !sameKeys(v, ['query']) || !plainObject(v.query) || !sameKeys(v.query, ['limit', 'page', 'skus', 'sort'])) return false;
  const { limit, page, skus, sort } = v.query;
  if (limit !== CATALOG_PAGE_SIZE || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) return false;
  if (!plainObject(sort) || !sameKeys(sort, ['direction', 'field']) || sort.direction !== 'desc' || sort.field !== 'weight') return false;
  if (!plainObject(skus) || !Object.keys(skus).every((k) => k === 'products' || k === 'filtersFromTags') || !Array.isArray(skus.products)) return false;
  if (!skus.products.length || skus.products.length > 8 || !skus.products.every((p) => Number.isInteger(p) && p > 0 && CATALOG_PRODUCTS.includes(p))) return false;
  if (Object.hasOwn(skus, 'filtersFromTags')) {
    const f = skus.filtersFromTags;
    if (!plainObject(f) || !sameKeys(f, ['facetIdentifiers', 'tagIdentifiers'])) return false;
    if (![f.facetIdentifiers, f.tagIdentifiers].every((a) => Array.isArray(a) && a.length === 1 && typeof a[0] === 'string')) return false;
    if (!Object.hasOwn(CATALOG_FACETS, f.facetIdentifiers[0]) || !CATALOG_FACETS[f.facetIdentifiers[0]].includes(f.tagIdentifiers[0])) return false;
  }
  return true;
}
