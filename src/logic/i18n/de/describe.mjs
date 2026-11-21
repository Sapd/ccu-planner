// German texts for the shared logic modules (see src/logic/i18n.mjs). Pure.
import { t } from '../../i18n.mjs';
import { usd } from '../../format.mjs';
import { shortDay } from '../../availability.mjs';
import {
  STATE_LABEL, LOCK_LABEL, MODE_CHOICE, LOCK_CHOICE, PRIORITY_CHOICE, NEW_CASH_LABEL,
  waitingCostText, acceptedStatusText, changeCauseText, changesDeltaText, meltTipText, noTokenReason, blockerItemText,
  blockerText, signedUsd, stepNumber,
} from '../../describe.mjs';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayKey = (d) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
const joinList = (parts) => (parts.length < 3 ? parts.join(' und ') : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`);

function ageWhen(iso, now) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return `heute, ${hm(d)}`;
  if (dayKey(d) === dayKey(yesterday)) return `gestern, ${hm(d)}`;
  return `${d.getDate()}. ${MON[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}, ${hm(d)}`;
}

const STATE_HELP = {
  own: 'Im Besitz: Du hast dieses Upgrade schon im Hangar. Hier gibt es nichts zu kaufen.',
  now: 'Jetzt kaufen: Kauf es heute. Das Angebot kann bald enden, und Warten könnte mehr kosten.',
  wait: 'Warten: Noch nicht kaufen. Ein Warbond in dieser Preisklasse würde diesen Schritt günstiger machen; die gibt es meist während Sales.',
  norush: 'Im Angebot: Beim letzten Sync im Angebot, ohne Hinweis auf ein baldiges Ende.',
  optional: 'Optional: eine Wette. Jetzt zu kaufen kann später Geld sparen, du kannst aber auch warten.',
  reserved: 'Reserviert: Wird von der reservierten Kette dieses Ziels gehalten, andere Ziele können es daher nicht nutzen.',
};
const LOCK_HELP = 'Jetzt kaufen, um den Preis zu sichern: Wenn du dieses Standard-Upgrade heute kaufst, steht sein Preis fest, bevor er steigt, auch wenn du es noch nicht brauchst.';
const FILLER_HELP = 'In diese Preislücke passt kein Warbond. Solange das Schiff im Store ist, kannst du das Standard-Upgrade mit Store-Guthaben kaufen.';
const NO_PLEDGE_HELP = 'Das Startschiff, das du für dieses Ziel gewählt hast, ist nicht verfügbar: Es ist nicht mehr in deinem Hangar, zählt nicht mehr als Startschiff oder ein anderes Ziel hält es. Wähle ein anderes Startschiff.';
const COUNTED = {
  msrp: (n) => `${n} Schiffspreise haben sich geändert`,
  'step-gone': (n) => `${n} Schritte werden nicht mehr angeboten`,
  'step-repriced': (n) => `${n} Schritte haben den Preis geändert`,
  'in-store': (n) => `${n} Schiffe sind wieder im Store und ermöglichen heute weitere Routen`,
  'new-warbond': (n) => `nutzt jetzt ${n} neue Warbonds`,
  'copy-gone': (n) => `${n} deiner CCUs haben deinen Hangar verlassen`,
  'copy-new': (n) => `nutzt jetzt ${n} neue CCUs von dir`,
};
const LIST_AT_MOST = 2;
const tokenLabel = (name, paidCents) => `${name} · LTI${paidCents == null ? '' : ` · bezahlt ${usd(paidCents)}`}`;
const pairOf = (name, from, to, arrow = '→') => `${name(from)} ${arrow} ${name(to)}`;
const savesIn = (s) => { const m = /\((.+)\)/.exec(s); return m ? ` (spart ${m[1]})` : ''; };

function meltPlanBuild(p, { lockLine, finishText, locksOnly }) {
  const out = [];
  for (const l of p.locks) out.push(lockLine(l));
  out.push(`${p.finishChains.length ? finishText(p.finishChains) : locksOnly}: Warbond ${usd(p.warbond)} (immer neues Geld) + Standard ${usd(p.standard)} - Guthaben-Pool ${usd(p.pool)} = ${usd(p.newMoneyBefore)} neues Geld`);
  if (!p.melt.length) out.push('Nichts einzuschmelzen: Der Guthaben-Pool deckt die Standard-Käufe bereits ab.');
  else out.push(`${plural(p.melt.length, 'CCU', 'CCUs')} einschmelzen für ${usd(p.meltCredit)} Guthaben -> neues Geld ${usd(p.newMoneyAfter)}${p.creditLeftAfter ? `, ${usd(p.creditLeftAfter)} Guthaben übrig` : ''}:`);
  return out;
}

const blockerSub = (b, opts) => {
  const texts = b.items.map((i) => blockerItemText(i, opts));
  const shown = texts.length > 3 ? [...texts.slice(0, 3), `${texts.length - 3} weitere`] : texts;
  return `${b.goalName} ${joinList(shown)} nutzt`;
};

/** English text -> German text (string with the same {placeholders}, or (params) => string). */
export const texts = {
  'No goal is in finish mode or locks a target with a Standard step, so nothing needs to be melted now.': 'Kein Ziel ist im Fertigstellen-Modus oder sichert den Preis eines Ziels mit einem Standard-Schritt, daher muss jetzt nichts eingeschmolzen werden.',
  'Melting is done by you on RSI; it gives up the option that these targets get more expensive.': 'Das Einschmelzen machst du selbst bei RSI; du verzichtest damit auf die Absicherung gegen steigende Preise dieser Ziele.',
  'current best plan (differs from your reserved chain)': 'aktuell bester Plan (weicht von deiner reservierten Kette ab)',
  'This is the current best plan. It differs from your reserved chain.': 'Das ist der aktuell beste Plan. Er weicht von deiner reservierten Kette ab.',
  'Owned': 'Im Besitz',
  'Buy now': 'Jetzt kaufen',
  'Wait': 'Warten',
  'On sale': 'Im Angebot',
  'Optional': 'Optional',
  'Reserved': 'Reserviert',
  'Buy now · locks the price': 'Jetzt kaufen · sichert den Preis',
  'Filler': 'Füller',
  'New cash still needed': 'Noch benötigtes neues Geld',
  'Direct upgrade at list value': 'Direktes Upgrade zum Listenwert',
  'New cash if the sales come back': 'Neues Geld, wenn die Sales zurückkommen',
  "For comparison only: the price difference between your starting ship and the goal ship if you bought one direct upgrade at today's list prices. It is not money you saved or spent.": 'Nur zum Vergleich: der Preisunterschied zwischen deinem Startschiff und dem Zielschiff, wenn du ein direktes Upgrade zu heutigen Listenpreisen kaufen würdest. Das ist kein Geld, das du gespart oder ausgegeben hast.',
  "The money you still have to pay at today's store prices for the upgrades you do not own yet, after the upgrades you own and any store credit. Steps marked \"Wait\" are included but are not meant to be bought today.": 'Das Geld, das du zu heutigen Store-Preisen noch für die Upgrades zahlen musst, die du noch nicht besitzt, nach Abzug deiner vorhandenen Upgrades und jedes Store-Guthabens. Mit „Warten“ markierte Schritte sind enthalten, sollen aber nicht heute gekauft werden.',
  'The new cash still needed if each waiting step gets the lowest sale price seen so far. Not guaranteed.': 'Das neue Geld, das noch nötig ist, wenn jeder wartende Schritt den bisher niedrigsten gesehenen Sale-Preis bekommt. Nicht garantiert.',
  'Sale prices not seen yet; keep syncing during sales': 'Noch keine Sale-Preise gesehen; synchronisiere weiter während Sales',
  'You own these upgrades. Apply them in the order shown to build the ship.': 'Diese Upgrades gehören dir. Wende sie in der gezeigten Reihenfolge an, um das Schiff zu bauen.',
  'Wait for sales when it saves money': 'Auf Sales warten, wenn es Geld spart',
  'Get it as soon as possible': 'So schnell wie möglich holen',
  'auto': 'auto',
  'always': 'immer',
  'never': 'nie',
  'Count only new money': 'Nur neues Geld zählen',
  'Count what you already paid too': 'Auch bereits Bezahltes zählen',
  'High': 'Hoch',
  'Normal': 'Normal',
  'Low': 'Niedrig',
  'High priority': 'Hohe Priorität',
  'Normal priority': 'Normale Priorität',
  'Low priority': 'Niedrige Priorität',
  'Reserved: these hold their CCUs before any other goal is planned.': 'Reserviert: Diese halten ihre CCUs, bevor ein anderes Ziel geplant wird.',
  'Planned first: these goals get first pick of your CCUs, starting ships and credit.': 'Zuerst geplant: Diese Ziele haben die erste Wahl bei deinen CCUs, Startschiffen und deinem Guthaben.',
  'Planned second: these goals get what the high priority goals leave.': 'Als Zweites geplant: Diese Ziele bekommen, was die Ziele mit hoher Priorität übrig lassen.',
  'Planned last: these goals only get what everything above leaves.': 'Zuletzt geplant: Diese Ziele bekommen nur, was alles darüber übrig lässt.',
  'For a CCU you want to keep, melt or gift: no goal will use this copy, and plans find another way. Excluding it releases a reserved chain that holds it.': 'Für ein CCU, das du behalten, einschmelzen oder verschenken willst: Kein Ziel nutzt diese Kopie, und Pläne suchen einen anderen Weg. Wenn du sie ausschließt, wird eine reservierte Kette freigegeben, die sie hält.',
  'Optional, and nothing is bought. Reserving keeps this exact chain: it holds the CCUs, starting ship and store credit it uses so other goals cannot take them, and the planner stops switching it to a cheaper route (it tells you if a price changes). Leave it off to always get the cheapest plan. You can release it any time.': 'Optional, und es wird nichts gekauft. Mit dem Reservieren bleibt genau diese Kette erhalten: Sie hält die CCUs, das Startschiff und das Store-Guthaben, die sie nutzt, damit andere Ziele sie nicht nehmen können, und der Planer wechselt sie nicht mehr auf eine günstigere Route (er sagt dir Bescheid, wenn sich ein Preis ändert). Lass es aus, um immer den günstigsten Plan zu bekommen. Du kannst sie jederzeit freigeben.',
  'These offers may end soon, or you want the goal as soon as possible.': 'Diese Angebote enden vielleicht bald, oder du willst das Ziel so schnell wie möglich.',
  'On offer at the last sync, with no sign that it ends soon.': 'Beim letzten Sync im Angebot, ohne Hinweis auf ein baldiges Ende.',
  'Bets, not deadlines: you can also wait.': 'Wetten, keine Fristen: Du kannst auch warten.',
  'Warbond upgrades require new cash and are usually discounted, but they mostly appear during sales and can vanish.': 'Warbond-Upgrades brauchen neues Geld und sind meist rabattiert, erscheinen aber hauptsächlich während Sales und können wieder verschwinden.',
  'Standard upgrades use the regular price and can use store credit when offered.': 'Standard-Upgrades nutzen den regulären Preis und können, wenn angeboten, mit Store-Guthaben bezahlt werden.',
  'A virtual CCU you added: an upgrade you expect to get outside the RSI store (from a friend, a trade or a coming sale). Plans count its price as new cash; store credit cannot pay it.': 'Ein virtuelles CCU, das du hinzugefügt hast: ein Upgrade, das du außerhalb des RSI-Stores erwartest (von einem Freund, durch einen Tausch oder einen kommenden Sale). Pläne zählen seinen Preis als neues Geld; Store-Guthaben kann es nicht bezahlen.',
  'Plans for this goal only use routes that pass through this ship, for example a ship you want to fly on the way. A reserved chain that skips it is released.': 'Pläne für dieses Ziel nutzen nur Routen, die über dieses Schiff führen, zum Beispiel ein Schiff, das du auf dem Weg fliegen möchtest. Eine reservierte Kette, die es überspringt, wird freigegeben.',
  'Get it': 'Besorgen',
  'RSI marks nearly every offer as limited, so that mark is ignored here.': 'RSI markiert fast jedes Angebot als befristet, daher wird diese Markierung hier ignoriert.',
  'Runs until…': 'Läuft bis…',
  'Ends soon': 'Endet bald',
  'Clear my note': 'Meine Notiz löschen',
  "Don't lock this goal": 'Preis für dieses Ziel nicht sichern',
  'Needs a starting ship': 'Braucht ein Startschiff',
  'No starting ship found yet': 'Noch kein Startschiff gefunden',
  'Other ways: raise the starting ship price limit below, or mark another ship you own as a starting ship in the Hangar ("Use as starting ship").': 'Weitere Möglichkeiten: Erhöhe unten das Preislimit für Startschiffe oder markiere im Hangar ein anderes Schiff, das du besitzt, als Startschiff („Als Startschiff verwenden“).',
  'Starting ships are cheap ships you own that have Lifetime Insurance. A goal upgrades one of them; the upgraded ship keeps LTI.': 'Startschiffe sind günstige Schiffe, die du besitzt und die lebenslange Versicherung (Lifetime Insurance) haben. Ein Ziel wertet eines davon auf; das aufgewertete Schiff behält LTI.',
  'Start and target must differ.': 'Start und Ziel müssen sich unterscheiden.',
  'No goal needs it, a Standard offer was listed at the last sync, and the target was seen in the store on two syncs clear of any sale, or you confirmed it.': 'Kein Ziel braucht es. Beim letzten Sync gab es ein Standard-Angebot, und das Ziel wurde bei zwei Syncs außerhalb aller Sales im Store gesehen, oder du hast es bestätigt.',
  'Import from CCU Game': 'Aus CCU Game importieren',
  'Choose the saved file you downloaded from CCU Game. Nothing is added until you confirm.': 'Wähle die gespeicherte Datei, die du von CCU Game heruntergeladen hast. Es wird nichts hinzugefügt, bevor du bestätigst.',
  'New': 'Neu',
  'Already a goal': 'Schon ein Ziel',
  'Needs a ship': 'Braucht ein Schiff',
  'We could not match this ship name. Pick the ship to add the goal.': 'Wir konnten diesen Schiffsnamen nicht zuordnen. Wähle das Schiff, um das Ziel hinzuzufügen.',
  "Reserved goals count at the price they were reserved at, the others at today's plan.": 'Reservierte Ziele zählen mit dem Preis, zu dem sie reserviert wurden, die anderen mit dem heutigen Plan.',
  'No eligible LTI ship in this hangar. Choose a starting ship, or save this goal for later.': 'Kein geeignetes LTI-Schiff in diesem Hangar. Wähle ein Startschiff oder speichere dieses Ziel für später.',
  'Your hangar is not synced yet, so the planner cannot see your LTI ships. Sync the hangar, or choose a starting ship.': 'Dein Hangar ist noch nicht synchronisiert, daher sieht der Planer deine LTI-Schiffe nicht. Synchronisiere den Hangar oder wähle ein Startschiff.',
  'Without a starting ship the goal shows "needs a starting ship" until you choose one.': 'Ohne Startschiff zeigt das Ziel „braucht ein Startschiff“, bis du eines wählst.',
  'Try Alpha → Beta using an upgrade you already own': 'Alpha → Beta mit einem Upgrade ausprobieren, das du schon besitzt',
};

/** Builder key (loc() in the logic module) -> German twin with the same arguments. */
export const builders = {
  routeLine: (r) => `${usd(r.cash)} bar${r.creditUsed ? ` + ${usd(r.creditUsed)} Guthaben` : ''} · ${r.steps.filter((s) => s.kind === 'owned').length} im Besitz${r.ownedBasis ? ` (${usd(r.ownedBasis)}${r.unknownBasis ? ' + unbekannt' : ''})` : ''} · ${r.steps.filter((s) => s.kind !== 'owned').length} zu kaufen${r.allIn != null ? ` · insgesamt ${usd(r.allIn)}` : ''}`,

  describeDiff(d) {
    const delta = d.cashDelta == null ? '' : d.cashDelta < 0 ? ` · ${usd(-d.cashDelta)} weniger neues Geld` : d.cashDelta > 0 ? ` · ${usd(d.cashDelta)} mehr neues Geld` : ' · gleich viel neues Geld';
    const copies = d.released?.length || d.claimed?.length ? ` · gibt ${plural(d.released.length, 'CCU', 'CCUs')} frei, beansprucht ${d.claimed.length}` : '';
    return { new: 'Neuer Plan', 'no-route': 'Blockiert · keine Route', unchanged: 'Unverändert', 'same-path': `Gleicher Weg${delta}${copies}`, alternative: `Alternativer Weg${delta}${copies}` }[d.kind];
  },

  noRouteMessage: (targetName, incoming) => (incoming === 0
    ? `Keine Route: RSI bietet derzeit kein Upgrade auf ${targetName} an, und du besitzt kein CCU dorthin.`
    : 'Mit den aktuellen Angeboten und deinen CCUs wurde keine Route gefunden.'),

  issueLine(i, { name, goalName, arrow = '→' }) {
    const pair = () => pairOf(name, i.from, i.to, arrow);
    const kind = () => (i.step === 'warbond' ? 'Warbond' : 'Standard');
    switch (i.kind) {
      case 'token-gone': return `Startschiff${i.ship != null ? ` ${name(i.ship)}` : ''} nicht mehr im Hangar`;
      case 'copy-gone': return `CCU ${pair()} nicht mehr im Hangar`;
      case 'copy-shared': return `CCU ${pair()} ist auch für ${goalName(i.by)} reserviert`;
      case 'offer-gone': return `${kind()}-Angebot ${pair()} nicht mehr verfügbar`;
      case 'repriced': return `${kind()} ${pair()}: Preis geändert ${usd(i.was)} ${arrow} ${usd(i.now)}`;
      default: return String(i.kind);
    }
  },

  meltHeadline: (p, hasOverrides) => `Einschmelz-Kandidaten: ${plural(p.candidates.length, 'ungenutztes CCU', 'ungenutzte CCUs')}, ${usd(p.candidateCredit)} Guthaben (keine Ersparnis${hasOverrides ? ' zu aktuellen oder erwarteten Preisen' : ''}, Standard-Angebot beim letzten Sync, Ziel bei zwei Syncs außerhalb aller Sales im Store gesehen oder bestätigt, kein Konzeptschiff, keine Extras, nicht reserviert)`,

  meltWithoutNote: (n) => (n ? `(${n} weitere würden ohne deine erwarteten Preise infrage kommen; sie bleiben, weil sie nach der Änderung Geld sparen)` : null),

  meltPlanLinesApp: (p, name, goalName) => meltPlanBuild(p, {
    lockLine: (l) => `Preis sichern für ${goalName(l.chainId)}: ${name(l.step.from)} -> ${name(l.step.to)} ${usd(l.step.cash)} Standard jetzt (unten mitgezählt)`,
    finishText: (ids) => `Ziele im Fertigstellen-Modus: ${ids.map(goalName).join(', ')}`,
    locksOnly: 'Nur Preissicherungen',
  }),

  meltPickLineApp: (m, name) => `Einschmelzen: ${name(m.copy.from)} -> ${name(m.copy.to)} (bezahlt ${usd(m.paid)}, Standard heute ${usd(m.standardNow)})`,

  priceLine(shipName, today, o, covered) {
    if (today === o.msrp) return `${shipName}: aktueller und erwarteter Schiffswert beide ${usd(today)}. Diese Annahme betrifft ${plural(covered, 'Standard-Angebot', 'Standard-Angebote')}.${o.note ? ` Hinweis: ${o.note}.` : ''}`;
    return `${shipName}: heute ${usd(today)} -> erwartet ${usd(o.msrp)}${o.note ? ` (${o.note})` : ''} · ändert den erwarteten Preis von ${plural(covered, 'Standard-Angebot', 'Standard-Angeboten')}`;
  },

  assumptionsCoverText: (n) => `Deine Annahmen betreffen insgesamt ${plural(n, 'Standard-Angebot', 'Standard-Angebote')}.`,

  availabilityNoteText(a) {
    if (a.inStore === false) return `Beim letzten Sync (${shortDay(a.lastSyncDay)}) nicht im Store.`;
    if (a.inStore && a.previousMiss) return `Seit ${shortDay(a.since)} im Store, beim Sync am ${shortDay(a.previousMiss)} nicht.`;
    return '';
  },

  availabilityText(a) {
    if (a.inStore == null) return 'Kein Store-Sync aufgezeichnet.';
    if (!a.inStore) return `Beim letzten Sync (${shortDay(a.lastSyncDay)}) nicht im Store.${a.lastSeen ? ` Zuletzt am ${shortDay(a.lastSeen)} gesehen.` : ''}`;
    const current = a.previousMiss
      ? `Seit ${shortDay(a.since)} im Store. Beim Sync am ${shortDay(a.previousMiss)} war das Schiff nicht im Store.`
      : `Seit dem Sync am ${shortDay(a.since)} im Store.`;
    if (a.seenOutsideEvents) return `${current} Außerhalb von Sale-Events im Store gesehen.`;
    const during = a.seenIn
      ? `jeweils während ${a.seenIn.name} (RSI-Banner bis ${shortDay(a.seenIn.to)})`
      : 'jeweils während Sale-Events';
    return `${current} An ${plural(a.seenDays, 'Sync-Tag', 'Sync-Tagen')} im Store gesehen, ${during}.`;
  },

  standardLaterText: (cash) => `Standard später für ${usd(cash)} kaufen. Store-Guthaben funktioniert.`,

  waitingCostText: (a) => (a.saves == null ? '' : a.saves === Infinity ? ' (Warten lässt keine Route übrig)' : ` (Warten kostet ${usd(a.saves)} mehr${a.together ? ' für diese Schritte zusammen' : ''})`),

  buyBeforeText(a, { name, arrow = '→', hint = '' }) {
    const path = pairOf(name, a.step.from, a.step.to, arrow);
    const after = { pricier: usd(a.expected), gone: 'kein Standard-Upgrade', concept: `mehr (Konzeptschiff, Preisanstieg noch nicht bekannt${hint})` }[a.reason];
    return `Kaufe vor ${a.reason === 'concept' ? 'dem Preisanstieg' : 'der Preisänderung'}: ${path} ${usd(a.now)} jetzt, danach ${after}${waitingCostText(a)}`;
  },

  chipHelp(state, { lock = false, filler = false } = {}) {
    if (filler) return FILLER_HELP;
    if (lock && state === 'now') return LOCK_HELP;
    return STATE_HELP[state] ?? null;
  },

  lockCoveredText: (fromName, targetName, extraCash) => `Preisanstieg abgedeckt: Dein CCU ${fromName} → ${targetName} begrenzt die Mehrkosten auf ${usd(extraCash)}`,

  lockReasonText(code) {
    return { on: 'Du hast entschieden, den Preis dieses Schritts zu sichern.', expected: 'Der normale Preis dieses Schiffs wird voraussichtlich steigen.', concept: 'Dieses Schiff ist ein Konzept; sein Preis steigt meist, sobald es flugfähig wird.' }[code] ?? null;
  },

  waitReasonText(kind, { event = null, seen = null, cash = null, slot = null, gap = null } = {}) {
    if (kind === 'slot') return slot ? `Warte auf einen Warbond auf ein beliebiges Schiff von ${usd(slot.fromMsrp)} bis ${usd(slot.toMsrp)} (${slot.fromName} auf ${slot.toName}). Er könnte hier bis zu ${usd(slot.save)} sparen.` : 'Warte auf einen Warbond.';
    if (kind === 'filler') return `In die Preislücke von ${usd(gap)} passt kein Warbond. Das Standard-Upgrade ist am günstigsten und lässt sich mit Store-Guthaben bezahlen.`;
    if (kind === 'normal') return `Standardpreis ${usd(cash)}.`;
    if (kind === 'seen') return `Während ${event?.name ?? 'eines früheren Sales'} für ${usd(seen.cash)} gesehen.`;
    return null;
  },

  cashCutText: (cashText) => `bis zu ≈ ${cashText} weniger neues Geld als zu heutigen Preisen`,

  ownedRunText: ({ first, last, total, fromName, toName, count }) =>
    `${stepNumber(first, total)}–${stepNumber(last, total)} ${fromName} → ${toName} · ${plural(count, 'Upgrade', 'Upgrades')} im Besitz`,

  stepPhrase({ index, total, fromName, toName, state, lock = false }) {
    const label = state === 'own' ? 'Upgrade im Besitz' : lock && state === 'now' ? t(LOCK_LABEL) : t(STATE_LABEL[state] ?? '');
    return `Schritt ${index} von ${total}. Upgrade ${fromName} auf ${toName}.${label ? ` ${label}.` : ''}`;
  },

  otherWaysTitle: (n) => `Weitere Wege (${n})`,
  wouldHelpLine: (cashText) => `Ein Warbond unter ${cashText} würde das günstiger machen`,

  blockerItemText(item, { name, arrow = '→' }) {
    if (item.kind === 'copy') return `dein CCU ${pairOf(name, item.from, item.to, arrow)}`;
    if (item.kind === 'token') return `dein Startschiff ${name(item.from)}`;
    return `${usd(item.amount)} deines Store-Guthabens`;
  },

  blockerText(b, opts) {
    const texts = b.items.map((i) => blockerItemText(i, opts));
    const shown = texts.length > 3 ? [...texts.slice(0, 3), `${texts.length - 3} weitere`] : texts;
    return `${b.goalName} nutzt ${joinList(shown)}`;
  },

  sharedEffectShort: (effect) => (effect?.extra > 0 ? `+${usd(effect.extra)}, weil andere Ziele CCUs halten, die dieses Ziel allein nutzen würde.` : null),
  sharedEffectParts: (effect, opts) => (effect?.blockers ?? []).map((b) => `${blockerText(b, opts)}.`),
  neededBecauseText: (blockers, opts) => `Nötig, weil ${joinList(blockers.map((b) => blockerSub(b, opts)))}`,

  goalCostLines(cash, aloneCash) {
    if (cash == null) return null;
    if (aloneCash != null && aloneCash < cash) return { main: `Mit anderen Zielen · ${usd(cash)}`, alone: `Bei alleiniger Planung · ${usd(aloneCash)}` };
    return { main: usd(cash), alone: null };
  },

  acceptedDriftNote(drift) {
    if (!drift.length) return null;
    return `Reservierte Ketten zählen mit dem Preis, zu dem du sie reserviert hast: ${drift.map((d) => `${d.name} ${usd(d.accepted)} reserviert, jetzt ${usd(d.now)}`).join('; ')}.`;
  },

  acceptedStatusText: (status) => ({
    ok: 'Weiterhin gültig: Alles, was sie hält, ist noch da, zum gleichen Preis.',
    repriced: 'Weiterhin möglich, aber ein Preis hat sich geändert.',
    blocked: 'Nicht mehr möglich: Etwas, das sie braucht, ist weg.',
  }[status] ?? ''),

  acceptedStatusLine({ status, acceptedCash, nowCash, bestCash = null, differs = false }) {
    const better = differs && bestCash != null && acceptedCash != null && bestCash < acceptedCash ? { cash: bestCash } : null;
    let text = acceptedStatusText(status);
    if (status === 'repriced' && nowCash != null && acceptedCash != null && nowCash !== acceptedCash) {
      text = nowCash < acceptedCash
        ? `Weiterhin möglich. Ihre Schritte kosten jetzt ${usd(nowCash)} statt der ${usd(acceptedCash)}, zu denen du sie reserviert hast.`
        : `Weiterhin möglich, aber ihre Schritte kosten jetzt ${usd(nowCash)} statt der ${usd(acceptedCash)}, zu denen du sie reserviert hast.`;
    }
    return { text, better };
  },

  shortWhen(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return `${d.getDate()}. ${MON[d.getMonth()]} ${hm(d)}`;
  },

  changeCauseText(c, { name, arrow = '→' }) {
    const pair = () => pairOf(name, c.from, c.to, arrow);
    switch (c.kind) {
      case 'msrp': return `${name(c.shipId)} kostet jetzt ${usd(c.now)} statt ${usd(c.was)}`;
      case 'step-gone': return c.step === 'warbond' ? `Warbond ${pair()} wird nicht mehr angeboten` : `${pair()} wird nicht mehr verkauft`;
      case 'step-repriced': return `${c.step === 'warbond' ? 'Warbond ' : ''}${pair()} kostet jetzt ${usd(c.now)} statt ${usd(c.was)}`;
      case 'new-warbond': return `nutzt jetzt Warbond ${pair()} für ${usd(c.cash)}`;
      case 'in-store': return `${name(c.shipId)} ist wieder im Store. Dadurch ist heute eine Route über dieses Schiff möglich`;
      case 'copy-gone': return `dein CCU ${pair()} ist nicht mehr in deinem Hangar`;
      case 'copy-new': return `nutzt jetzt dein neues CCU ${pair()}`;
      case 'taken': return c.by ? `${c.by} hat dein CCU ${pair()} genommen` : 'ein anderes Ziel hat ein gemeinsames CCU genommen';
      case 'order': return 'Planungsreihenfolge geändert';
      case 'shared': return 'ergibt sich aus Änderungen bei anderen Zielen. Der gemeinsame Plan hat deine CCUs oder dein Store-Guthaben neu verteilt';
      default: return 'Keine Ursache gefunden';
    }
  },

  goalChangeLine(g, opts) {
    const head = g.delta != null ? `${g.name} ${signedUsd(g.delta)}` : g.now == null ? `${g.name} hat jetzt keine Route` : `${g.name} hat jetzt eine Route (${usd(g.now)})`;
    const byKind = new Map();
    for (const c of g.causes) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
    const parts = [];
    for (const [kind, list] of byKind) {
      if (kind === 'taken') continue;
      if (list.length > LIST_AT_MOST && COUNTED[kind]) parts.push(COUNTED[kind](list.length));
      else parts.push(...list.map((c) => changeCauseText(c, opts)));
    }
    const taken = byKind.get('taken') ?? [];
    if (taken.length === 1) parts.push(changeCauseText(taken[0], opts));
    else if (taken.length > 1) {
      const to = new Map();
      for (const c of taken) to.set(c.by ?? 'andere Ziele', (to.get(c.by ?? 'andere Ziele') ?? 0) + 1);
      parts.push(`seine CCUs gehen jetzt an ${[...to].sort((a, b) => b[1] - a[1]).map(([by, n]) => `${by} (${n})`).join(', ')}`);
    }
    return `${head}: ${parts.join('; ')}`;
  },

  changesDeltaText(c) {
    const d = c.since ? new Date(c.since) : null;
    const when = d && !Number.isNaN(d.getTime()) ? `${d.getDate()}. ${MON[d.getMonth()]} ${hm(d)}` : null;
    return `${c.totalDelta === 0 ? 'unverändert' : signedUsd(c.totalDelta)} seit ${when ?? 'dem letzten Sync'}`;
  },

  changesHeadline: (c) => `Gesamt ${changesDeltaText(c)}`,

  changesGoalLines(c) {
    const cash = (v) => (v == null ? 'keine Route' : usd(v));
    return [
      ...c.added.map((g) => `Ziel hinzugefügt: ${g.name}, heute ${cash(g.cash)}`),
      ...c.removed.map((g) => `Ziel entfernt: ${g.name}, war ${cash(g.cash)}`),
    ];
  },

  whenText: (iso, now = new Date()) => ageWhen(iso, now),

  heroBuyTitle: (n, cashText) => `Heute: ${plural(n, 'Upgrade', 'Upgrades')} kaufen · ${cashText}`,
  onlyOptionalText: (n, cashText) => (n === 1 ? `1 Upgrade ist im Angebot, falls du es willst (etwa ${cashText}).` : `${n} Upgrades sind im Angebot, falls du sie willst (etwa ${cashText}).`),
  todayNothingHeadline: (nothingWhy) => (nothingWhy === 'no-rush' ? 'Heute muss nichts gekauft werden' : 'Heute gibt es nichts zu kaufen'),

  otherGroupsLine({ norush = 0, optional = 0 }) {
    const parts = [];
    if (norush) parts.push(`Im Angebot: ${norush}`);
    if (optional) parts.push(`Optional: ${optional}`);
    return parts.length ? `Außerdem: ${parts.join(' · ')}` : null;
  },

  buyListEnd(todayCount, otherCount = 0) {
    if (todayCount > 0) return 'Das war’s für heute.';
    return otherCount > 0 ? 'Das ist alles, was angeboten wird. Nichts davon muss heute gekauft werden.' : 'Für kein Ziel ist heute ein Kauf nötig.';
  },

  buyCountText: (n) => `${n} kaufen`,
  forGoalsText: (names) => `für ${names.join(', ')}`,

  stepKindLabel: (s) => (s?.virtual || s?.kind === 'virtual' ? 'Virtuell' : { warbond: 'Warbond', standard: 'Standard', owned: 'Im Besitz' }[s?.kind] ?? 'Standard'),
  virtualStepText: (s) => `Ein virtuelles CCU, das du hinzugefügt hast: Besorge es außerhalb des RSI-Stores${s?.note ? ` (${s.note})` : ''}. Es zählt als ${s?.cash != null ? 'neues Geld' : 'Bargeld'}; Store-Guthaben kann es nicht bezahlen.`,
  paymentText: (kind) => (kind === 'warbond' || kind === 'virtual' ? 'nur Bargeld' : 'Store-Guthaben möglich'),
  creditLineText: (cents) => `Du hast ${usd(cents)} Store-Guthaben für Standard-Upgrades`,
  standardPriceText: (cents) => `Standard kostet ${usd(cents)}`,

  urgencyReasonText(r) {
    switch (r.code) {
      case 'limited': return 'zeitlich begrenztes Angebot';
      case 'new': return 'neu im Sale';
      case 'event-ends': return `Laut RSI-Banner endet ${r.event.name} am ${shortDay(r.event.to)}`;
      case 'price': return 'Warten kostet Geld';
      case 'note-soon': return 'du hast es als bald endend markiert';
      case 'note-ends': return `du hast es mit Ende ${shortDay(r.until)} markiert`;
      case 'finish': return 'du willst dieses Ziel so schnell wie möglich';
      default: return '';
    }
  },

  onSaleText({ kind = 'warbond', since = null, until = null, untilBy = null }) {
    const parts = [];
    if (kind === 'standard') parts.push('Jetzt verfügbar, keine Eile');
    else if (since) parts.push(`im Angebot seit ${shortDay(since)}`);
    if (until) parts.push(untilBy === 'note' ? `läuft bis ${shortDay(until)} (deine Notiz)` : untilBy === 'event' ? `Event-Ende laut RSI-Banner am ${shortDay(until)}` : `läuft bis ${shortDay(until)}`);
    return parts.join(' · ');
  },

  lockTradeText({ targetName, cash, code, extraCash = null }) {
    const cond = {
      concept: `Wenn der Preis von ${targetName} vor der Veröffentlichung steigt,`,
      expected: `Wenn der Preis von ${targetName} wie von dir erwartet steigt,`,
      on: `Wenn der Preis von ${targetName} steigt,`,
    }[code] ?? `Wenn der Preis von ${targetName} steigt,`;
    const tail = extraCash != null ? `deine anderen Routen begrenzen die Mehrkosten auf höchstens ${usd(extraCash)}.` : 'keine deiner anderen Routen deckelt das.';
    return `Optional: Jetzt für ${usd(cash)} kaufen, um diesen Preis zu behalten. ${cond} kostet das Warten den Anstieg; ${tail}`;
  },

  estimateText: (typical) => `Geschätztes neues Geld, wenn Rabatte zurückkehren · ≈ ${usd(Math.round(typical / 100) * 100)}`,
  estimateHowText: (typical, low, high, n = null) => [
    `Spanne ${usd(low)}–${usd(high)}, typischerweise ${usd(typical)}.`,
    `Berechnet, indem der übliche Warbond-Rabatt${n ? ` aus ${plural(n, 'Sale', 'Sales')} in deinem eigenen Verlauf` : ' aus deinem eigenen Verlauf'} von jedem wartenden Standard-Schritt abgezogen wird.`,
    'Für diese Schritte wurde noch kein Sale-Preis gesehen, daher ist das geschätzt, nicht beobachtet. Ein Sale kann kleiner, größer oder gar nicht wiederkommen.',
  ],

  conceptTieText: (altFromName, toName) => `Gewählt gegenüber ${altFromName} → ${toName} (gleicher Preis): ${altFromName} ist ein Konzeptschiff und könnte steigen.`,
  heroGoalsLine: (names) => (names.length === 1 ? `Für dein Ziel ${names[0]}` : `Für deine Ziele ${names.join(', ')}`),

  nothingWhyText(why, { waitCount = 0, anyNoRoute = false, anyNoToken = false } = {}) {
    if (why === 'no-route') return 'Keines deiner Ziele hat gerade eine Route.';
    if (why === 'no-token') return 'Keines deiner Ziele hat gerade ein Startschiff.';
    if (why === 'no-rush') return 'Nichts ist dringend: Was noch zu kaufen ist, hat keine Frist.';
    if (why === 'waiting' && waitCount > 0) return 'Alles, was noch fehlt, wartet auf einen Sale.';
    if (why === 'waiting' && anyNoRoute) return 'Keines deiner Ziele hat gerade eine Route.';
    if (why === 'waiting' && anyNoToken) return 'Einige deiner Ziele brauchen noch ein Startschiff.';
    return 'Alle deine Ziele sind erledigt.';
  },

  waitingHeadline: (steps, goals) => `Warten auf Sales · ${plural(goals, 'Ziel', 'Ziele')} · ${plural(steps, 'Upgrade', 'Upgrades')}`,
  meltTipText: (n, creditText) => `${n === 1 ? '1 CCU, das' : `${n} CCUs, die`} du nicht brauchst: einschmelzen für ${creditText} Store-Guthaben`,

  noTokenReason({ ltiCount = null, poolCount = null, limitCents = null } = {}) {
    if (ltiCount === 0) return 'Du hast kein Schiff mit lebenslanger Versicherung (LTI) in deinem Hangar, daher gibt es nichts Günstiges zum Starten.';
    if (poolCount === 0) return `Alle deine LTI-Schiffe kosten mehr als das Preislimit für Startschiffe${limitCents != null ? ` von ${usd(limitCents)}` : ''}, oder du hast sie auf „Nie verwenden“ gesetzt.`;
    return 'Alle deine günstigen LTI-Schiffe werden schon von anderen Zielen genutzt.';
  },

  noTokenHelp: (start, ctx = null) => (start?.pledgeId != null ? NO_PLEDGE_HELP
    : `Um die lebenslange Versicherung (LTI) zu behalten, startet ein Ziel von einem günstigen LTI-Schiff, das du besitzt. ${noTokenReason(ctx ?? undefined)} Wähle ein Startschiff für dieses Ziel.`),

  startLineText(start, token, shipName) {
    if (start?.kind === 'ship') return `ab ${shipName} (fest)`;
    if (token) return `ab ${shipName} · LTI`;
    return 'braucht ein Startschiff';
  },

  tokenOptionLabels(pool) {
    const base = (p) => tokenLabel(p.name, p.paidCents);
    const groups = new Map();
    for (const p of pool) groups.set(base(p), [...(groups.get(base(p)) ?? []), p]);
    const out = new Map();
    for (const [label, list] of groups) list.forEach((p, i) => out.set(p.pledgeId, list.length > 1 ? `${label} · Kopie ${i + 1} von ${list.length}` : label));
    return out;
  },

  tokenSummaryText(pool) {
    const counts = new Map();
    for (const p of pool) counts.set(tokenLabel(p.name, p.paidCents), (counts.get(tokenLabel(p.name, p.paidCents)) ?? 0) + 1);
    return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(', ');
  },

  goalNextText(steps, name) {
    const pair = (s) => pairOf(name, s.step.from, s.step.to);
    const now = steps.filter((s) => s.state === 'now');
    const urgent = now.find((s) => !s.urgency || s.urgency === 'today');
    if (urgent) return `Als Nächstes: ${pair(urgent)} ${urgent.step.virtual ? 'besorgen' : 'kaufen'} für ${usd(urgent.step.cash)}${urgent.step.virtual ? ' (dein virtuelles CCU)' : urgent.step.kind === 'warbond' ? ' (Warbond, im Angebot)' : ''}.`;
    const wait = steps.find((s) => s.state === 'wait');
    const calm = now[0];
    if (calm) {
      const tail = wait ? ` Danach auf einen Sale für ${pair(wait)} warten.` : '';
      return `Heute muss nichts gekauft werden. Optional: ${pair(calm)} ${calm.step.virtual ? 'ist dein virtuelles CCU' : 'ist im Angebot'} für ${usd(calm.step.cash)} (keine Eile).${tail}`;
    }
    if (wait) return `Als Nächstes: auf einen Sale für ${pair(wait)} warten (heute kostet es ${usd(wait.step.cash)}).`;
    return null;
  },

  goalStatusText(g) {
    if (g.status === 'no-token') return 'Braucht ein Startschiff';
    if (g.status === 'no-route') return 'Keine Route';
    if (g.status === 'done') return 'Alle Upgrades im Besitz';
    const parts = [];
    if (g.buyCount) parts.push(`Heute ${g.buyCount} kaufen`);
    if (g.noRushCount) parts.push(`${g.noRushCount} im Angebot`);
    if (g.optionalCount) parts.push(`${g.optionalCount} optional`);
    if (g.waitCount) parts.push(`${g.waitCount} warten`);
    return parts.join(' · ');
  },

  meltReasonPlain(keep) {
    const s = String(keep ?? '');
    const tail = (prefix) => s.slice(prefix.length).trim();
    if (s.startsWith('reserved by')) return `Ein Ziel nutzt es (${tail('reserved by')}), also bleibt es.`;
    if (s === 'protected') return 'Du hast es als eines markiert, das du behalten willst.';
    if (s === 'not meltable') return 'RSI lässt dich dieses nicht einschmelzen.';
    if (s === 'paid value unknown') return 'Wir wissen nicht, was du bezahlt hast, und können daher nicht sagen, ob sich das Einschmelzen lohnt.';
    if (s.startsWith('no Standard offer')) return 'Behalten: Beim letzten Sync gab es kein Standard-Angebot für dieses Upgrade.';
    if (s === 'not yet seen in the store on two syncs clear of any sale') return 'Behalten: Das Schiff wurde noch nicht bei zwei Syncs außerhalb aller Sales im Store gesehen.';
    if (s.startsWith('cheaper than the store today')) return `Es kostet weniger als ein Kauf jetzt${savesIn(s)}, also behalte es.`;
    if (s.startsWith('will save after an expected price change')) return `Es wird weniger kosten als im Store, sobald die erwartete Preisänderung eintritt${savesIn(s)}.`;
    if (s.startsWith('into a concept ship')) return 'Es führt zu einem Konzeptschiff, dessen Preis vor der Veröffentlichung steigt.';
    if (s.startsWith('carries extras')) {
      const extras = tail('carries extras').replace(/^:\s*/, '');
      return `Es hat Extras, die verloren gingen${extras ? `: ${extras}` : ''}.`;
    }
    return s ? `Behalten: ${s}.` : 'Behalten.';
  },

  noEventsNoticeStore: (saleEvents) => (saleEvents?.events?.length ? null : 'Keine Sale-Events eingetragen. Alle Sync-Tage zählen als Tage außerhalb von Sale-Events. Trag den aktuellen Sale im Formular unten ein.'),
  noEventsNoticeApp: (saleEvents) => (saleEvents?.events?.length ? null : 'Keine Sale-Events eingetragen. Alle Sync-Tage zählen als Tage außerhalb von Sale-Events. Trag den aktuellen Sale im Store ein.'),
  meltHeadlinePlain: ({ count, credit }) => (count ? `${meltTipText(count, usd(credit))}.` : 'Gerade lohnt sich nichts zum Einschmelzen.'),
  importConfirmLabel: (n) => (n === 1 ? '1 Ziel hinzufügen' : `${n} Ziele hinzufügen`),
  noMatchesText: (query) => `Keine Treffer für „${String(query ?? '').trim()}“.`,

  breakdownLines(b) {
    const lines = [];
    if (b.owned.count) {
      const paid = b.owned.paidKnown === 0 ? '' : b.owned.paidKnown === b.owned.count ? ` · du hast ${usd(b.owned.paid)} dafür bezahlt` : ` · du hast ${usd(b.owned.paid)} für die ${b.owned.paidKnown} mit bekanntem Preis bezahlt`;
      lines.push(`${plural(b.owned.count, 'Upgrade', 'Upgrades')} besitzt du bereits${paid}. Dieses Geld ist ausgegeben und nicht Teil des noch nötigen Geldes.`);
    }
    lines.push(b.purchases.count ? `${plural(b.purchases.count, 'Upgrade', 'Upgrades')} noch zu kaufen · ${usd(b.purchases.cash)} zu heutigen Preisen` : 'Kein Upgrade mehr zu kaufen.');
    if (b.credit > 0) lines.push(`Angerechnetes Store-Guthaben: ${usd(b.credit)}`);
    lines.push(`${t(NEW_CASH_LABEL)}: ${usd(b.cash)}`);
    return lines;
  },

  plannedTotalText(totalCents, goals) {
    const missing = goals.filter((g) => g.status === 'no-token' || g.status === 'no-route');
    if (!missing.length) return `Geplante Summe · ${usd(totalCents)}`;
    const why = (g) => `${g.name} ${g.status === 'no-token' ? 'braucht ein Startschiff' : 'hat keine Route'}.`;
    return `Geplante Summe · ${usd(totalCents)} für ${goals.length - missing.length} von ${goals.length} Zielen. ${missing.map(why).join(' ')}`;
  },

  settingsSummary(chain, startLine) {
    const parts = [
      startLine ? startLine.replace(/^ab /, 'Start ab ') : 'Startschiff noch nicht gewählt',
      t(MODE_CHOICE[chain.mode ?? 'watch']),
      `Priorität ${t(PRIORITY_CHOICE[chain.priority ?? 'normal']).toLowerCase()}`,
      `Preissicherung ${t(LOCK_CHOICE[chain.lock ?? 'auto'])}`,
    ];
    return parts.join(' · ');
  },
};
