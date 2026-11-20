// "Check an offer": what a CCU offer (from the CCU Game Discord post, a store page) means for your goals. Pure.
//
//   checkOffer(app, { from, to, kind, cash })   owned copies, goals that use the pair, the effect of buying one, a verdict
//   parseOfferText(text, ships)                 offers pulled out of pasted text
import { sessionFor } from './session.mjs';
import { whatIf, assertBuyable } from './whatif.mjs';
import { goalNamer, norm } from './ships.mjs';
import { usd } from './format.mjs';


/**
 * @param {{ from: number, to: number, kind?: 'warbond'|'standard', cash: number }} offer  cash in cents
 * @returns {{
 *   offer: object, store: Array<{ kind, cash }> (what the store sells this pair for today, any kind),
 *   copies: Array<{ copyId: string, paid: number|null, giftable: boolean, usedBy: { goalId: string, goalName: string }|null }>,
 *   onRoutes: Array<{ goalId: string, goalName: string, kind: string }>,
 *   effect: object, saving: number, verdict: string,
 * }}
 * copies = the owned CCUs of that exact pair and the goal whose route uses each (null: unused). onRoutes = goals whose route has
 * this pair as a step, owned or bought. effect = whatIf for buying one copy at `cash`; saving = how much less you pay overall
 * with it (the goals' savings minus its price, never below 0 here; 0 means it helps nobody).
 */
export function checkOffer(app, { from, to, kind = 'warbond', cash, before = null }) {
  const session = sessionFor(app);
  assertBuyable(from, to, session.data);
  if (!['warbond', 'standard'].includes(kind)) throw new Error('kind must be warbond or standard');
  if (!Number.isInteger(cash) || cash < 0) throw new Error('the price must be a whole number of cents');
  const namer = goalNamer(session.plans, session.data?.ships ?? null);
  const shipName = (id) => session.data?.ships?.get(id)?.name ?? 'unknown ship';

  const edges = session.graph.edges.get(from) ?? [];
  const ownedEdge = edges.find((e) => e.kind === 'owned' && e.to === to);
  const holder = new Map(); // copyId -> goal id (shared plan)
  const onRoutes = [];
  for (const [id, entry] of session.shared) {
    for (const s of entry.route?.steps ?? []) {
      if (s.from === from && s.to === to) onRoutes.push({ goalId: id, goalName: namer(id), kind: s.kind });
      if (s.copyId) holder.set(s.copyId, id);
    }
  }
  const copies = (ownedEdge?.copies ?? []).map((c) => ({
    copyId: c.copyId, paid: c.paid?.cents ?? null, giftable: !!c.giftable,
    usedBy: holder.has(c.copyId) ? { goalId: holder.get(c.copyId), goalName: namer(holder.get(c.copyId)) } : null,
  }));
  const store = edges.filter((e) => e.kind !== 'owned' && e.to === to).map((e) => ({ kind: e.kind, cash: e.cash }));

  const effect = whatIf(app, { buy: { from, to, kind, cash, copies: 1 } }, { before });
  const saving = Math.max(0, 0 - effect.net);
  const helped = effect.deltas.filter((d) => d.delta != null && d.delta < 0);
  const n = copies.length;

  let verdict;
  if (saving > 0) {
    const gets = helped.length === 1 ? `${helped[0].name} gets ${usd(saving)} cheaper` : `${helped.length || 'Your'} goals get cheaper, ${usd(saving)} in total`;
    verdict = n ? `You own ${n}; another still helps: ${gets}` : gets;
  } else if (n) {
    verdict = `You own ${n}; no goal needs another`;
  } else if (onRoutes.length) {
    verdict = `${onRoutes.map((r) => r.goalName).join(', ')} already ${onRoutes.length > 1 ? 'use' : 'uses'} ${shipName(from)} → ${shipName(to)}; at ${usd(cash)} nothing gets cheaper`;
  } else {
    verdict = 'Would not make any goal cheaper';
  }
  return { offer: { from, to, kind, cash }, store, copies, onRoutes, effect, saving, verdict: `${verdict}.` };
}

// ---- Pasted text ----

const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)/;
const cents = (m) => Math.round(Number(m.replace(/,/g, '')) * 100);

const NOISE = new Set(['the', 'a', 'an', 'ship', 'upgrade', 'ccu', 'from', 'to', 'for', 'at', 'wb', 'warbond', 'warbonds', 'std', 'standard', 'standards', 'edition', 'only', 'now']);

// The catalog ship named by `text`. { id } for an exact name, or for the longest ship name inside the text when the words left over
// are noise ("the", "ship", "WB"...). { id: null, reason, suggestion } otherwise: a name with extra words is not a match
// ("Carrack Expedition" is not the Carrack), and when the longest name is ambiguous there is no fall back to a shorter one.
function matchShip(index, text) {
  const q = norm(text);
  if (!q) return { id: null, reason: 'no ship name' };
  const exact = index.byName.get(q);
  if (exact != null) return exact === 'ambiguous' ? { id: null, reason: `"${text.trim()}" matches several catalog ships` } : { id: exact };
  // "Aegis Avenger Titan": a known manufacturer name (or its first words) in front of an exact ship name
  for (const maker of index.makers) {
    if (!q.startsWith(`${maker} `)) continue;
    const rest = index.byName.get(q.slice(maker.length + 1));
    if (rest != null && rest !== 'ambiguous') return { id: rest };
  }
  const hay = ` ${q} `;
  let best = null;
  let tie = false;
  for (const [name, id] of index.byName) {
    if (!hay.includes(` ${name} `)) continue;
    if (!best || name.length > best.name.length) { best = { name, id }; tie = false; }
    else if (name.length === best.name.length && name !== best.name) tie = true;
  }
  if (!best) return { id: null, reason: `"${text.trim()}" is not a catalog ship` };
  const shown = index.display.get(best.name);
  if (tie || best.id === 'ambiguous') return { id: null, reason: `"${text.trim()}" matches several catalog ships` };
  const left = q.replace(best.name, ' ').split(' ').filter((w) => w && !NOISE.has(w));
  if (left.length) return { id: null, reason: `"${text.trim()}" is not a catalog ship (did you mean ${shown}?)`, suggestion: shown };
  return { id: best.id };
}

const PRICE = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const KIND_WORD = /\b(wb|warbonds?|std|standards?)\b/i;
// The kind the text names; both kinds named ("(WB) (Standard)") counts as not stated.
const kindOf = (line) => {
  const wb = /\b(wb|warbonds?)\b/i.test(line);
  const std = /\b(std|standards?)\b/i.test(line);
  return wb === std ? null : wb ? 'warbond' : 'standard';
};

/**
 * Offers in pasted text (one per line), e.g. "Guardian ($250 MSRP, $235 WB): $5 from the Scorpius Antares",
 * "Pulse → Orion $150" or "Pulse to Orion for $150". Ship names are matched case-insensitively against the catalog.
 * The kind is Warbond when the line says WB or Warbond, Standard when it says Standard (a bracket that holds prices is ignored, one that only names the kind counts); otherwise it is assumed to be a
 * Warbond (`kindAssumed: true`), as daily deals are. A name with extra words ("Carrack Expedition") is not matched to the shorter ship: the line
 * is reported unmatched with a "did you mean".
 * @param {Map<number, { id: number, name: string }>} ships
 * @returns {{ offers: Array<{ from: number, to: number, cash: number, kind: 'warbond'|'standard', kindAssumed: boolean, line: string }>, unmatched: Array<{ line: string, reason: string }> }}
 * `unmatched` lists the lines that look like an offer (a price, an arrow or "from") but could not be read, with the reason.
 */
export function parseOfferText(text, ships) {
  const byName = new Map();
  const display = new Map();
  for (const s of ships.values()) {
    const k = norm(s.name);
    if (k) { byName.set(k, byName.has(k) ? 'ambiguous' : s.id); display.set(k, s.name); }
  }
  // Manufacturer names as people write them: the full name and its leading words ("Aegis Dynamics", "Aegis").
  const makers = new Set();
  for (const s of ships.values()) {
    const m = norm(typeof s.manufacturer === 'string' ? s.manufacturer : s.manufacturer?.name);
    const words = m ? m.split(' ') : [];
    for (let n = 1; n <= words.length; n++) makers.add(words.slice(0, n).join(' '));
  }
  const index = { byName, display, makers };
  const offers = [];
  const unmatched = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*>+/, ' ').replace(/[*_`#|]+/g, ' ').replace(/\s+/g, ' ').trim(); // (a quote marker ">" goes, the ">" of "->" stays)
    if (!line) continue;
    // A bracket made only of kind words ("(WB)", "(Standard)", "(WB, $235)") gives the kind; any other bracket ("(limited)", "(new!)",
    // "(Aurora MR)", "($250 MSRP)") is a note and is dropped.
    const unbracketed = line.replace(/\(([^)]*)\)/g, (m, inner) => {
      const bare = inner.replace(PRICE, ' ');
      const words = bare.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !NOISE.has(w));
      return words.length === 0 && KIND_WORD.test(bare) ? ` ${bare} ` : ' ';
    }).replace(/\s+/g, ' ').trim();
    // A leading price: "$25 - Pulse to Orion"
    const lead = /^(\$\s?\d[\d,]*(?:\.\d+)?)\s*(?:[-–—:]\s*)?(.+)$/.exec(unbracketed);
    const plain = lead ? lead[2] : unbracketed;
    const leadPrice = lead ? lead[1] : null;
    const arrow = /^(.*?)\s*(?:→|->|=>|➜|➔|\bto\b)\s*(.+)$/i.exec(plain);
    const fromWord = /^(.*?)\s*[:\-–—]\s*(?:only\s+)?(\$\s?\d[\d,]*(?:\.\d+)?)?\s*(?:upgrade\s+)?from\s+(?:the\s+)?(.+?)\s*(?:[.,;!]|$)/i.exec(plain)
      ?? /^(.*?)\s*[:\-–—]\s*(?:only\s+)?(\$\s?\d[\d,]*(?:\.\d+)?)?\s*(?:upgrade\s+)?from\s+(?:the\s+)?(.+)$/i.exec(plain);
    let fromText = null;
    let toText = null;
    let price = null;
    if (fromWord) {
      toText = fromWord[1];
      fromText = fromWord[3];
      price = fromWord[2] ?? leadPrice;
    } else if (arrow) {
      fromText = arrow[1];
      toText = arrow[2].replace(/\s*(?:for|at|@|=|:|-|–|—)?\s*\$\s?\d.*$/i, '');
      price = MONEY.exec(arrow[2])?.[0] ?? leadPrice;
    }
    const looksLikeOffer = MONEY.test(line) || /→|->|=>|\bfrom\b/i.test(line);
    if (fromText == null) { if (looksLikeOffer) unmatched.push({ line, reason: 'no "X to Y" or "from X" pair found' }); continue; }
    const a = matchShip(index, fromText);
    const b = matchShip(index, toText);
    if (a.id == null || b.id == null || a.id === b.id) {
      unmatched.push({ line, reason: a.id != null && a.id === b.id ? 'both sides are the same ship' : (a.id == null ? a : b).reason });
      continue;
    }
    const from = a.id;
    const to = b.id;
    const m = price ? MONEY.exec(price) : MONEY.exec(plain);
    if (!m) { unmatched.push({ line, reason: 'no price found' }); continue; }
    // Two different prices in one line ("$25 - A to B $30") are not guessed at.
    const seen = new Set([...(leadPrice ? [leadPrice] : []), ...(plain.match(PRICE) ?? [])].map((x) => cents(MONEY.exec(x)[1])));
    if (seen.size > 1) { unmatched.push({ line, reason: `two different prices (${[...seen].map((c) => usd(c)).join(' and ')})` }); continue; }
    const k = kindOf(plain); // a bracket that holds prices was skipped; one that only names the kind counts
    offers.push({ from, to, cash: cents(m[1]), kind: k ?? 'warbond', kindAssumed: k == null, line });
  }
  return { offers, unmatched };
}
