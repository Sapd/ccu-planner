// Virtual CCUs (plans.profile.virtualCcus): the list on the Hangar's Upgrades view and the add/edit form. Pure.
import { virtualExpired } from '../../../../src/logic/planner.mjs';
import { localToday } from '../../../../src/logic/availability.mjs';
import { t } from '../../../../src/logic/i18n.mjs';

/** Characters a note may have. */
export const NOTE_MAX = 100;

/** The catalog price difference of an upgrade (cents), or null when a ship has no price. */
export function msrpDelta(ships, from, to) {
  const a = ships?.get(from)?.msrp;
  const b = ships?.get(to)?.msrp;
  return a != null && b != null ? b - a : null;
}

/** Dollars typed in a field ("12", "12.5", "$12.50") as whole cents, or null when it is not a price. */
export function dollarsToCents(text) {
  const t = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Cents as the text of a dollar field: 1250 -> "12.50", 1200 -> "12". */
export const centsToDollars = (c) => (c == null ? '' : c % 100 ? (c / 100).toFixed(2) : String(c / 100));

/** The day `days` after `today` ('YYYY-MM-DD'), for the "in 30 days" button. */
export function dayAfter(today, days) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The list: one row per virtual CCU, newest last, with ship names, the saving against the catalog difference,
 * whether it has expired and which goals' best routes use it.
 * `routes`: Map goalId -> { name, route } (the goals' current routes).
 */
export function virtualRows(plans, ships, routes = new Map(), today = localToday()) {
  const usedBy = new Map();
  for (const [goalId, { name, route }] of routes) {
    for (const s of route?.steps ?? []) {
      if (!s.virtual) continue;
      const list = usedBy.get(s.virtualId) ?? [];
      if (!list.some((g) => g.goalId === goalId)) list.push({ goalId, name });
      usedBy.set(s.virtualId, list);
    }
  }
  return (plans?.profile?.virtualCcus ?? []).map((v) => {
    const delta = msrpDelta(ships, v.from, v.to);
    return {
      ...v,
      fromName: ships?.get(v.from)?.name ?? t('unknown ship'),
      toName: ships?.get(v.to)?.name ?? t('unknown ship'),
      savings: delta == null ? null : delta - v.cents,
      expired: virtualExpired(v, today),
      usedBy: usedBy.get(v.id) ?? [],
    };
  });
}

/** An empty form, or the form of an existing virtual CCU. Price and savings are dollar texts. */
export function virtualForm(v = null, ships = null) {
  if (!v) return { id: null, from: null, to: null, price: '', savings: '', copies: 1, expires: '', note: '' };
  const delta = msrpDelta(ships, v.from, v.to);
  return { id: v.id, from: v.from, to: v.to, price: centsToDollars(v.cents), savings: delta == null ? '' : centsToDollars(delta - v.cents), copies: v.copies ?? 1, expires: v.expires ?? '', note: v.note ?? '' };
}

/**
 * Keeps price and savings in step: the field you typed in wins and the other follows from the catalog difference.
 * `edited`: 'price' or 'savings'.
 */
export function syncPrice(form, ships, edited) {
  const delta = msrpDelta(ships, form.from, form.to);
  if (delta == null) return form;
  if (edited === 'price') {
    const c = dollarsToCents(form.price);
    return { ...form, savings: c == null ? '' : centsToDollars(delta - c) };
  }
  const s = dollarsToCents(form.savings);
  return { ...form, price: s == null || s > delta ? '' : centsToDollars(delta - s) };
}

/** What is wrong with the form, or null. */
export function formProblem(form) {
  if (form.from == null || form.to == null) return t('Pick the source and the target ship.');
  if (form.from === form.to) return t('Source and target must be different ships.');
  if (dollarsToCents(form.price) == null) return t('Enter what the CCU costs, in dollars.');
  if (!Number.isInteger(Number(form.copies)) || Number(form.copies) < 1 || Number(form.copies) > 99) return t('Copies must be between 1 and 99.');
  if (String(form.note ?? '').trim().length > NOTE_MAX) return t('The note can have at most {max} characters.', { max: NOTE_MAX });
  return null;
}

/** The setVirtualCcu action of a valid form. */
export const virtualAction = (form) => ({
  type: 'setVirtualCcu',
  ccu: {
    ...(form.id ? { id: form.id } : {}),
    from: form.from, to: form.to, cents: dollarsToCents(form.price), copies: Number(form.copies),
    expires: form.expires || null, note: String(form.note ?? '').trim(),
  },
});
