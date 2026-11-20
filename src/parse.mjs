// Parsers for the server-rendered hangar and buy-back pages.

import * as cheerio from 'cheerio/slim';

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Parses "$5.00 USD" -> { cents: 500, currency: 'USD' }; unknown -> null. */
export function parseMoney(text) {
  const m = clean(text).match(/([\d,]+(?:\.\d+)?)\s*([A-Z]{3})?/);
  if (!m) return null;
  return { cents: Math.round(Number(m[1].replace(/,/g, '')) * 100), currency: m[2] ?? null };
}

const RSI = 'https://robertsspaceindustries.com';

/** https URL or null. Root-relative and protocol-relative URLs resolve against RSI; anything else is dropped. */
function httpsUrl(raw) {
  const u = clean(raw).replace(/^['"]|['"]$/g, '');
  if (!u) return null;
  try {
    const url = new URL(u, RSI);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

/** Best-effort picture of a block: a CSS background-image on an .image element, else an <img src>. */
function imageOf($, scope) {
  const el = scope.find('.image, .thumb, .thumbnail').first();
  const style = el.attr('style') ?? '';
  const m = style.match(/background-image\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/i);
  if (m) return httpsUrl(m[2]);
  const img = (el.is('img') ? el : el.find('img').first());
  return img.length ? httpsUrl(img.attr('src')) : null;
}

// Keeps the stored JSON identical for pages without pictures: no key when there is no image.
const withImage = (image) => (image ? { image } : {});

export function parseHangarPage(html) {
  const $ = cheerio.load(html);
  const pledges = [];
  $('input.js-pledge-id').each((_, el) => {
    const li = $(el).closest('li');
    const val = (cls) => li.find(`input.${cls}`).first().attr('value');
    let upgrade = null;
    const raw = li.find('input.js-upgrade-data').attr('value');
    if (raw) {
      try { upgrade = JSON.parse(raw); } catch { upgrade = { parseError: true }; }
    }
    const items = [];
    li.find('.items .item').each((__, it) => {
      items.push({
        title: clean($(it).find('.title').first().text()),
        kind: clean($(it).find('.kind').first().text()) || null,
        liner: clean($(it).find('.liner').first().text()) || null,
        ...withImage(imageOf($, $(it))),
      });
    });
    pledges.push({
      pledgeId: Number(val('js-pledge-id')),
      name: clean(val('js-pledge-name')),
      value: parseMoney(val('js-pledge-value')),
      configurationValue: parseMoney(val('js-pledge-configuration-value')),
      currency: clean(val('js-pledge-currency')) || null,
      notBuybackable: val('js-pledge-not-buybackable') === '1',
      availability: clean(li.find('.availability').first().text()) || null,
      created: clean(li.find('.date-col').first().text().replace(/Created:/i, '')) || null,
      contains: clean(li.find('.items-col').first().text().replace(/Contains:/i, '')) || null,
      canGift: li.find('.js-gift, .js-gift-v2').length > 0,
      canReclaim: li.find('.js-reclaim').length > 0,
      canApplyUpgrade: li.find('.js-apply-upgrade').length > 0,
      upgrade,
      // The pledge's own picture: the first .image outside the item list.
      ...withImage(imageOf($, li.clone().find('.items').remove().end())),
      items,
    });
  });
  return pledges;
}

export function parseBuybackPage(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('article.pledge').each((_, el) => {
    const a = $(el);
    const dl = {};
    a.find('dl dt').each((__, dt) => { dl[clean($(dt).text())] = clean($(dt).next('dd').text()); });
    const href = a.find('a[href*="/pledge/buyback/"]').attr('href') ?? a.find('a[href*="buyback"]').attr('href') ?? null;
    const idMatch = href?.match(/(\d+)/);
    rows.push({
      buybackPledgeId: idMatch ? Number(idMatch[1]) : null,
      name: clean(a.find('h1').first().text()),
      reclaimDate: dl['Reclaim Date'] ?? null,
      contained: dl['Contained'] ?? null,
      details: dl,
      buyBackLink: href,
      // Note: every row carries a hidden "Not available" block, so availability
      // cannot be read from this page; it must come from the buy-back detail.
      // Upgrade buy-backs open the upgrade tool instead of a /pledge/buyback link.
      upgradeData: a.find('[data-fromshipid], [data-toshipid]').length
        ? { fromShipId: a.find('[data-fromshipid]').attr('data-fromshipid'), toShipId: a.find('[data-toshipid]').attr('data-toshipid') }
        : null,
    });
  });
  return rows;
}
