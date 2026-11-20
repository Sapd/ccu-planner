// RSI page URLs the app opens in the user's own browser. Pure: no Node or browser APIs.
// The app never adds to cart, buys or calls an RSI endpoint; it only opens pages.
// A changed RSI URL is fixed here and nowhere else.
export const RSI_ORIGIN = 'https://robertsspaceindustries.com';

// Query parameter names for preselection, or null while unverified.
// upgradePreselect: { from, to } names the parameters for the from/to ship ids.
// hangarSearch: the parameter name for a hangar search text.
export const LINKS = { upgradePreselect: null, hangarSearch: null };

const withQuery = (base, pairs) => {
  const q = pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return q.length ? `${base}${base.includes('?') ? '&' : '?'}${q.join('&')}` : base;
};

export function upgradeToolUrl({ from, to } = {}) {
  const base = `${RSI_ORIGIN}/en/pledge/ship-upgrade-ccu`;
  const p = LINKS.upgradePreselect;
  return p ? withQuery(base, [[p.from, from], [p.to, to]]) : base;
}

export function hangarUrl({ type = 'upgrade', search } = {}) {
  const base = withQuery(`${RSI_ORIGIN}/en/account/pledges`, [['product-type', type]]);
  return LINKS.hangarSearch ? withQuery(base, [[LINKS.hangarSearch, search]]) : base;
}

export function buybackUrl(buybackPledgeId) {
  return buybackPledgeId == null || buybackPledgeId === ''
    ? `${RSI_ORIGIN}/en/account/buy-back-pledges`
    : `${RSI_ORIGIN}/en/pledge/buyback/${encodeURIComponent(buybackPledgeId)}`;
}

export function isRsiUrl(url) {
  return typeof url === 'string' && url.startsWith(`${RSI_ORIGIN}/`);
}
