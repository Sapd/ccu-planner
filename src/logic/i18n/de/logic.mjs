// German texts for the shared logic modules (see src/logic/i18n.mjs). Pure.
import { t } from '../../i18n.mjs';
import { isDay } from '../../availability.mjs';
import { PROPOSED_LABEL, RESERVED_LABEL, RESERVED_STAYS } from '../../chainChoice.mjs';
import { BEST_DIFFERS_LABEL, eventLockWhy, eventLockDecision, routeLine } from '../../describe.mjs';
import { normalizePricing, usd } from '../../format.mjs';
import { edgeKey } from '../../planner.mjs';
import { buyRowText, otherGoalsText, signed } from '../../whatifText.mjs';

/** English text -> German text (string with the same {placeholders}, or (params) => string). */
export const texts = {
  "Proposed chain": "Vorgeschlagene Kette",
  "Reserved chain": "Reservierte Kette",
  "Your reserved chain stays in place until you switch.": "Deine reservierte Kette bleibt bestehen, bis du wechselst.",
  "This chain holds nothing of yours: it only needs purchases.": "Für diese Kette sind nur Käufe nötig. Sie hält nichts aus deinem Bestand fest.",
  "a sale event needs a name": "Gib dem Sale-Event einen Namen.",
  "sale event dates must be YYYY-MM-DD": "Gib die Daten des Sale-Events im Format YYYY-MM-DD ein.",
  "a sale event cannot end before it starts": "Das Sale-Event kann nicht vor seinem Beginn enden.",
  "unknown sale event {id}": "Unbekanntes Sale-Event {id}",
  "This is not a CCU Game saved-chains file": "Diese Datei enthält keine gespeicherten Ketten aus CCU Game.",
  "Ships and vehicles": "Schiffe und Fahrzeuge",
  "Packs": "Pakete",
  "Game packages": "Spielpakete",
  "Paints": "Lackierungen",
  "Limited time": "Zeitlich begrenzt",
  "Premium": "Premium",
  "Standard": "Standard",
  "Gear": "Ausrüstung",
  "Armor": "Rüstungen",
  "Clothing": "Kleidung",
  "Equipment": "Zubehör",
  "Add-ons": "Extras",
  "Digital goodies": "Digitale Extras",
  "UEC": "UEC",
  "Event tickets": "Event-Tickets",
  "Gift cards": "Geschenkkarten",
  "Subscriber store": "Subscriber-Store",
  "kind must be warbond or standard": "Wähle Warbond oder Standard.",
  "the price must be a whole number of cents": "Gib den Preis in ganzen Cent ein.",
  "unknown ship": "unbekanntes Schiff",
  "no ship name": "kein Schiffsname",
  "no \"X to Y\" or \"from X\" pair found": "kein Schiffspaar im Format „X to Y“ oder „from X“ gefunden",
  "both sides are the same ship": "auf beiden Seiten steht dasselbe Schiff",
  "no price found": "kein Preis gefunden",
  "\"{name}\" matches several catalog ships": "„{name}“ passt zu mehreren Schiffen im Katalog",
  "\"{name}\" is not a catalog ship": "„{name}“ steht nicht im Schiffskatalog",
  "\"{name}\" is not a catalog ship (did you mean {suggestion}?)": "„{name}“ steht nicht im Schiffskatalog. Meinst du {suggestion}?",
  "The planner has no route for this goal today": "Der Planer findet heute keine Route für dieses Ziel",
  "CCU Game plans each chain separately; the planner shares your CCUs between goals, so its total can be lower.": "CCU Game plant jede Kette einzeln. Hier können deine Ziele auf dieselben CCUs zugreifen. Dadurch kann der Gesamtbetrag niedriger ausfallen.",
  "{name} is not in the ship catalog": "{name} steht nicht im Schiffskatalog",
  "Not in your goals: {name}": "Fehlt in deinen Zielen: {name}",
  "Ours starts from {ours}, CCU Game from {theirs}": "Startschiff hier: {ours}. Startschiff bei CCU Game: {theirs}",
  "CCU Game plans each chain separately; ours share your CCUs (on its own this goal costs {alone} here, {shared} shared)": "CCU Game plant jede Kette einzeln. Hier teilen sich deine Ziele die verfügbaren CCUs. Das Ziel kostet einzeln {alone}, im gemeinsamen Plan {shared}",
  "Not in CCU Game: {name}": "Fehlt in CCU Game: {name}",
  "the item IDs and the title name different ships": "Artikel-IDs und Titel verweisen auf unterschiedliche Schiffe",
  "from matches {from}, ship targets {to}": "Treffer fürs Ausgangsschiff: {from}, fürs Zielschiff: {to}",
  "another goal": "ein anderes Ziel",
  "a goal": "ein Ziel",
  "the target": "das Zielschiff",
  "start": "Start",
  "target": "Ziel",
  "unknown job {op}": "Unbekannte Aufgabe {op}",
  "price must be a whole number of cents above zero": "Gib einen Preis in ganzen Cent über null ein.",
  "unknown what-if change": "Unbekannte Änderung für die Vorschau",
  "unknown ship {id}": "Unbekanntes Schiff {id}",
  "{name} to itself is not an upgrade RSI sells": "Ein Upgrade von {name} auf dasselbe Schiff gibt es bei RSI nicht.",
  "{to} does not cost more than {from}, so RSI sells no upgrade from one to the other": "{to} ist höchstens so teuer wie {from}. Deshalb bietet RSI dafür kein Upgrade an.",
  "start must be a token or a ship": "Wähle ein Startschiff oder ein festes Ausgangsschiff.",
  "token pledgeId must be a string": "Die pledgeId des Startschiffs muss Text sein.",
  "addChain needs a start and a target ship": "Wähle ein Ausgangsschiff und ein Zielschiff für die Kette.",
  "start and target must differ": "Ausgangsschiff und Zielschiff müssen verschieden sein.",
  "token limit must be a whole number of cents": "Gib das Preislimit fürs Startschiff in ganzen Cent ein.",
  "copyId must be a non-empty string": "Die copyId muss ein nicht leerer Text sein.",
  "excluded must be true or false": "Für excluded ist nur true oder false möglich.",
  "a virtual CCU needs a known source and target ship": "Wähle für das virtuelle CCU ein Ausgangsschiff und ein Zielschiff aus dem Katalog.",
  "source and target ship must differ": "Ausgangsschiff und Zielschiff müssen verschieden sein.",
  "price must be a whole number of cents, 0 or more": "Gib einen Preis ab null in ganzen Cent ein.",
  "copies must be between 1 and 99": "Gib eine Stückzahl von 1 bis 99 ein.",
  "expiration date must be YYYY-MM-DD": "Gib das Ablaufdatum im Format YYYY-MM-DD ein.",
  "note must be at most 100 characters": "Deine Notiz darf höchstens 100 Zeichen lang sein.",
  "the ship to route through must differ from the target": "Wähle ein anderes Zwischenschiff als das Zielschiff.",
  "the ship to route through must differ from the start": "Wähle ein anderes Zwischenschiff als das Ausgangsschiff.",
  "mark must be use, never or null": "Für mark ist nur use, never oder null möglich.",
  "credit must be zero or more whole cents": "Gib dein Store-Guthaben ab null in ganzen Cent ein.",
  "an offer note needs a day (YYYY-MM-DD) or soon: true": "Gib ein Datum im Format YYYY-MM-DD ein oder markiere das Angebot als bald endend.",
  "unknown chain {id}": "Unbekannte Kette {id}",
  "{field} must be an array of strings": "Für {field} ist eine Liste von Textwerten nötig.",
  "unknown virtual CCU {id}": "Unbekanntes virtuelles CCU {id}",
  "priority must be one of {values}": "Mögliche Prioritäten: {values}",
  "availability must be one of {values}": "Mögliche Werte für die Verfügbarkeit: {values}",
  "unknown ship in {from}-{to}": "Unbekanntes Schiff in {from} → {to}",
  "unknown action {type}": "Unbekannte Aktion {type}",
  "this route does not pass through the ship the goal must route through": "Die Route führt nicht über das gewählte Zwischenschiff.",
  "mode must be one of {values}": "Mögliche Planungsmodi: {values}",
  "objective must be one of {values}": "Mögliche Planungsoptionen: {values}",
  "lock must be one of {values}": "Mögliche Werte für die Preissicherung: {values}",
  "token already used by {goal}": "Das Startschiff ist bereits für {goal} reserviert.",
  "chosen": "gewählt",
  "not on sale": "nicht im Angebot",
  "another copy of the same CCU is used": "Ein anderes Exemplar desselben CCU wird verwendet",
  "same price": "gleicher Preis",
  " This also locks the target price.": " Damit sicherst du auch den Preis des Zielschiffs.",
  "price will rise (expected {price})": "Preis steigt voraussichtlich auf {price}",
  "price will fall (expected {price})": "Preis fällt voraussichtlich auf {price}",
  "reserved by {name}": "reserviert für {name}",
  "higher all-in (paid {price})": "höhere Gesamtkosten ({price} bereits bezahlt)",
  "costs {price} more": "kostet {price} mehr",
  "cheaper by {price}": "{price} günstiger",
  "Buy Standard {price} before the sale ends: {reason}.": "Kauf Standard für {price} vor Ende des Sale-Events ({reason}).",
  "Buy Standard {price} before the price rises to {expected}.": "Kauf Standard für {price}, bevor der Preis auf {expected} steigt.",
  "Buy Standard {price}: the chain is in finish mode.": "Kauf Standard für {price}, damit du die Kette so bald wie möglich abschließen kannst.",
  "a Warbond {from} → {to} below {price} would switch the plan": "Ein Warbond {from} → {to} unter {price} würde den Plan ändern",
};

const glossary = [
  { key: 'ccu', term: 'CCU', text: 'CCU steht für Cross-Chassis Upgrade. Damit machst du aus einem Schiff in deinem Hangar ein teureres Schiff. Du zahlst den Preisunterschied.' },
  { key: 'standard-warbond', term: 'Standard und Warbond', text: 'Dasselbe Upgrade gibt es in zwei Varianten. Standard-Upgrades kosten den regulären Preis und lassen sich mit Store-Guthaben bezahlen, wenn sie erhältlich sind. Für Warbond-Upgrades brauchst du neues Geld. Sie sind meist günstiger, tauchen vor allem bei Sale-Events auf und können wieder verschwinden.' },
  { key: 'store-credit', term: 'Store-Guthaben', text: 'Guthaben auf deinem RSI-Konto, das du beim Einschmelzen erhältst. Damit kannst du nur Standard-Upgrades kaufen.' },
  { key: 'lti', term: 'LTI und Startschiffe', text: 'LTI bedeutet lebenslange Versicherung. Ein Startschiff ist ein günstiges Schiff mit LTI in deinem Hangar. Wenn du damit eine Kette beginnst, geben alle Upgrades die Versicherung bis zum Zielschiff weiter.' },
  { key: 'insurance', term: 'Versicherungsregel', text: 'Bei einem Upgrade bleibt die beste Versicherung des Pledges erhalten. Hat dein Schiff eine lebenslange Versicherung, behält es sie auch nach dem Upgrade.' },
  { key: 'chain', term: 'Kette', text: 'Eine Reihe von Upgrades vom Ausgangsschiff bis zum Zielschiff. Mehrere kleine Upgrades sind oft günstiger als ein großes. Der Planer sucht für jedes Ziel die günstigste Kette.' },
  { key: 'status', term: 'Im Besitz, Jetzt kaufen, Im Angebot, Optional, Warten, Reserviert', text: 'Die Hinweise an den Schritten. Im Besitz: Du hast das Upgrade. Jetzt kaufen: Das Angebot kann bald enden. Im Angebot: Du hast Zeit. Optional: Du kannst auch warten. Warten: Warte auf ein passendes Warbond-Upgrade. Passt keins, kannst du das Standard-Upgrade kaufen, wann du willst. Reserviert: Eine reservierte Kette hält den Schritt für ihr Ziel fest.' },
  { key: 'lock', term: 'Preissicherung', text: 'Du kaufst ein Standard-Upgrade schon jetzt, um dir den Preis zu sichern, bevor er steigt. Du kannst die Preissicherung für jedes Ziel ein- oder ausschalten.' },
  { key: 'accept', term: 'Reservieren und freigeben', text: 'Reservieren ist freiwillig und löst keinen Kauf aus. Es hält die Kette und ihre vorhandenen CCUs für das Ziel fest. Der Planer prüft dann nur, ob die Kette noch funktioniert. Ohne Reservierung wählt er immer die günstigste Route. Gibst du die Kette frei, stehen die CCUs wieder für andere Ziele zur Verfügung.' },
  { key: 'virtual', term: 'Virtuelles CCU', text: 'Ein Upgrade, das du selbst hinzufügst, weil du es etwa von jemandem oder in einem kommenden Sale erwartest. Gib Preis, Stückzahl und auf Wunsch ein Ablaufdatum an. Wie ein Warbond-Upgrade kostet es neues Geld und lässt sich nicht mit Store-Guthaben bezahlen. Jedes Exemplar zählt für ein Ziel. Du findest es im Hangar unter „Upgrades“.' },
  { key: 'via', term: 'Route über ein Schiff', text: 'Lege in den Einstellungen eines Ziels ein Zwischenschiff fest. Der Planer sucht dann nur nach Ketten über dieses Schiff. Das ist praktisch, wenn du es unterwegs fliegen möchtest.' },
  { key: 'priority', term: 'Priorität', text: 'Die Priorität bestimmt, welches Ziel zuerst geplant wird. Ziele mit hoher Priorität haben zuerst Zugriff auf deine CCUs, Startschiffe und dein Store-Guthaben. Die anderen bekommen, was übrig bleibt.' },
  { key: 'alone', term: 'Einzeln geplant', text: 'So viel würde ein Ziel kosten, wenn ihm alle deine CCUs, Startschiffe und dein Store-Guthaben zur Verfügung stünden. Im gemeinsamen Plan kann es teurer sein. Die Tabelle „Ziele“ zeigt den noch zu zahlenden Betrag im gemeinsamen Plan. Den Einzelpreis findest du beim jeweiligen Ziel unter „Mehr“.' },
  { key: 'full-price', term: 'Noch benötigtes neues Geld und Listenwert', text: 'Du siehst, wie viel du zu heutigen Store-Preisen noch zahlst, wenn deine vorhandenen Upgrades und dein Store-Guthaben eingerechnet sind. Das direkte Upgrade zum Listenwert zeigt dir zum Vergleich den Preisunterschied in einem einzigen Schritt. Der Betrag sagt nichts darüber aus, was du ausgegeben oder gespart hast.' },
  { key: 'starting-ship', term: 'Startschiff und Preislimit', text: 'Ein Ziel, das LTI behalten soll, beginnt mit einem günstigen LTI-Schiff aus deinem Hangar. Du legst mit dem Preislimit fest, was als günstig gilt. Im Hangar kannst du ein Schiff auch selbst als Startschiff markieren.' },
  { key: 'sale-event', term: 'Sale-Event', text: 'Ein zeitlich begrenzter Verkauf wie Invictus oder ein Jubiläum. Günstige Warbond-Upgrades gibt es vor allem dann. Trag die Daten im Store ein, damit der Planer weiß, dass ein Angebot nur vorübergehend verfügbar ist.' },
  { key: 'browse-store', term: 'Store durchsuchen', text: 'Im zweiten Tab im Store findest du den Pledge-Store für alle sowie Angebote für Subscriber und Concierge. Die Listenpreise sind in USD ohne Steuern. Angebote für Subscriber und Concierge siehst du, wenn du beim Sync des Store-Katalogs bei RSI angemeldet bist. Der Planer zeigt Artikel an und öffnet ihre RSI-Seiten. Dein Warenkorb bleibt unberührt.' },
  { key: 'concept', term: 'Konzeptschiff', text: 'Ein Schiff, das noch nicht flugfähig ist. Sobald es flugfähig wird, steigt meist der Preis. Deshalb kann es sich lohnen, den Preis des Upgrades auf dieses Schiff früh zu sichern.' },
  { key: 'melt', term: 'Einschmelzen', text: 'Wenn du ein eigenes CCU einschmilzt, bekommst du den gezahlten Betrag als Store-Guthaben zurück. Damit kannst du Standard-Upgrades kaufen. Der Planer macht nur Vorschläge. Einschmelzen kannst du selbst bei RSI.' },
  { key: 'buyback', term: 'Buyback', text: 'Bei RSI kannst du einen eingeschmolzenen Artikel über den Buyback zurückkaufen. Der Planer berücksichtigt Buyback in seinen Plänen nicht.' },
  { key: 'downward', term: 'Upgrades auf inzwischen günstigere Schiffe', text: 'Ein vorhandenes CCU bleibt nutzbar, auch wenn das Zielschiff nach einer Preisänderung günstiger ist als das Ausgangsschiff. RSI blockiert nur den Neukauf eines solchen Upgrades.' },
  { key: 'advanced', term: 'Upgrade-Karte, Routen vergleichen, Preisannahmen', text: 'Diese drei Seiten findest du unter „Erweitert“. Die Upgrade-Karte zeigt die Routen zwischen Schiffen für ein Ziel oder alle Ziele. Unter „Routen vergleichen“ probierst du eine Route aus, ohne ein Ziel anzulegen. Unter „Preisannahmen“ siehst du, welche Upgrade-Preise und dauerhaft verfügbaren Schiffe der Planer annimmt.' },
  { key: 'pledge', term: 'Pledge', text: 'Ein Artikel auf deinem RSI-Konto, etwa ein Schiff, Paket, CCU, eine Lackierung oder Ausrüstung. Im Hangar findest du alle deine Pledges.' },
  { key: 'hangar-money', term: 'Ausgegeben, gespart und ungenutzt', text: 'Im Hangar siehst du, was du für deine Pledges gezahlt hast. Das entspricht dem Einschmelzwert bei RSI. Geschenke zählen als $0. Die Ersparnis ist eine Schätzung: der heutige Standard-Preis deiner Upgrades abzüglich deiner Ausgaben. Gibt es keinen Standard-Preis, zählt der Preisunterschied zwischen den Schiffen. Ungenutzte Upgrades sind weder reserviert noch in einer aktuellen Kette.' },
  { key: 'giftable', term: 'Verschenkbar und zurückkaufbar', text: 'Verschenkbar heißt, dass du das Pledge an ein anderes Konto verschenken kannst. Zurückkaufbar heißt, dass du es nach dem Einschmelzen bei RSI wieder kaufen kannst.' },
];

// Full month names: an abbreviation's dot would double up at the end of a sentence ("bis 27. Nov..").
const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const joinList = (items) => items.length > 1 ? `${items.slice(0, -1).join(', ')} und ${items.at(-1)}` : (items[0] ?? '');
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cheaper = (deltas) => deltas.filter((d) => d.delta != null && d.delta < 0);
const amounts = (deltas) => deltas.map((d) => `${d.name} ${signed(d.delta)}`).join(', ');
const moved = (r) => r.deltas.filter((d) => d.delta != null);
const otherAmount = (deltas) => `${signed(deltas.reduce((sum, d) => sum + d.delta, 0))} (${amounts(deltas)})`;
const routeNotes = (r) => {
  const lost = r.deltas.filter((d) => d.now == null && d.was != null);
  const gained = r.deltas.filter((d) => d.was == null && d.now != null);
  return [
    lost.length ? `${joinList(lost.map((d) => d.name))} ${lost.length === 1 ? 'würde' : 'würden'} die Route verlieren.` : null,
    gained.length ? `${joinList(gained.map((d) => d.name))} ${gained.length === 1 ? 'bekäme' : 'bekämen'} eine Route.` : null,
  ].filter(Boolean);
};
const planOf = (deltas) => {
  const names = cheaper(deltas).map((d) => d.name);
  return names.length === 1 ? `im Plan für ${names[0]}` : names.length ? `in den Plänen für ${joinList(names)}` : 'in deinen Plänen';
};
const conceptWarbonds = (route, concept) => route.steps.filter((s) => s.kind === 'warbond' && concept.has(s.from));
const kindText = (step) => step.kind === 'owned' ? 'Upgrade im Besitz' : `${step.kind === 'warbond' ? 'Warbond' : 'Standard'} ${usd(step.cash)}`;

/** Builder key (loc() in the logic module) -> German twin with the same arguments. */
export const builders = {
  glossaryList: () => glossary,
  dayText: (s) => (isDay(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : String(s)),
  shortDay: (s) => (isDay(s) ? `${+s.slice(8, 10)}. ${months[+s.slice(5, 7) - 1]}` : String(s)),

  otherGoalsText(r) {
    const deltas = moved(r);
    return [deltas.length ? `Andere Ziele: ${otherAmount(deltas)}.` : 'Andere Ziele: keine Änderung.', ...routeNotes(r)].join(' ');
  },
  addGoalText(r) {
    const goal = r.added[0];
    if (!goal) return null;
    if (goal.cash == null) return `${goal.name}: Keine Route gefunden. Deshalb steht kein Kauf an. ${otherGoalsText(r)}`;
    return `${goal.name}: ${usd(goal.cash)}. ${otherGoalsText(r)} Insgesamt ${signed(r.grand.delta)}.`;
  },
  removeGoalText(r) {
    const goal = r.removed[0];
    if (!goal) return null;
    const deltas = moved(r);
    const other = deltas.length ? `andere Ziele ${otherAmount(deltas)}` : 'andere Ziele bleiben unverändert';
    const total = goal.cash != null ? ` Insgesamt ${signed(r.grand.delta)}, einschließlich der ${usd(goal.cash)} für dieses Ziel.` : '';
    return [`Ohne ${goal.name}: ${other}.`, ...routeNotes(r)].join(' ') + total;
  },
  buyRowText(row) {
    const copies = `${count(row.copies, 'Exemplar', 'Exemplare')} (${usd(row.spent)})`;
    if (row.usedCopies === 0 && row.plannedBy?.length) {
      const names = joinList(row.plannedBy);
      return `${copies}: Der Schritt ist für ${names} bereits eingeplant. Der geplante Kauf bleibt bestehen. Ein zusätzlicher Kauf kostet ${usd(row.spent)} mehr.`;
    }
    if (row.usedCopies === 0 || row.saved <= 0) return `${copies}: Kein Ziel würde ${row.copies === 1 ? 'es' : 'sie'} nutzen. Kein Plan wird dadurch günstiger.`;
    if (row.net === 0) return `${copies}: Mit dem Kauf zahlst du ${usd(row.saved)} ${planOf(row.deltas)} vorab. Insgesamt bleibt der Betrag gleich.`;
    if (row.net > 0) return `${copies}: Du sparst ${usd(row.saved)} ${planOf(row.deltas)} und zahlst jetzt ${usd(row.spent)}. Das kostet insgesamt ${usd(row.net)} mehr.`;
    const who = amounts(cheaper(row.deltas));
    return `${copies}: Für deine Ziele fallen ${usd(row.saved)} weniger an${who ? ` (${who})` : ''}. Insgesamt sparst du ${usd(-row.net)}.`;
  },
  plannedBuyText({ cash, goals, lock = false, outside = [] }) {
    const names = [...new Set(goals)];
    if (!names.length) return null;
    const away = [...new Set(outside)].filter((n) => names.includes(n));
    if (away.length) {
      const chain = away.length === 1 ? 'der vorgeschlagenen Kette' : 'den vorgeschlagenen Ketten';
      const reserved = away.length === 1 ? 'die reservierte Kette' : 'die reservierten Ketten';
      return `Für ${joinList(away)} steht dieser Schritt nur in ${chain}. Für ${reserved} ist er nicht eingeplant. Schau vor dem Kauf unter „Warum?“ nach.`;
    }
    const plan = names.length === 1 ? 'im Plan' : 'in den Plänen';
    return lock
      ? `Mit dem Kauf sicherst du dir den heutigen Preis von ${usd(cash)} ${plan} für ${joinList(names)}. Zu heutigen Preisen bleibt der Gesamtbetrag gleich.`
      : `Mit dem Kauf zahlst du ${usd(cash)} ${plan} für ${joinList(names)} vorab. Der Gesamtbetrag bleibt gleich.`;
  },
  buyVerdictText({ rows: [one, two] }) {
    if (!one || one.saved <= 0 || !two) return null;
    return two.extraSaved <= 0 ? 'Ein zweites Exemplar bringt keine Ersparnis.' : `Ein zweites Exemplar spart weitere ${usd(two.extraSaved)}.`;
  },
  offerCheckLines(r, shipName, { effect = true } = {}) {
    const pair = `${shipName(r.offer.from)} → ${shipName(r.offer.to)}`;
    const store = r.store.map((s) => `${s.kind === 'warbond' ? 'Warbond' : 'Standard'} für ${usd(s.cash)}`);
    const lines = [store.length ? `Heute im Store: ${pair} als ${joinList(store)}.` : `${pair} ist heute im Store nicht erhältlich.`];
    const used = r.copies.filter((c) => c.usedBy);
    const free = r.copies.length - used.length;
    if (r.copies.length) {
      const parts = used.map((c) => `ein Exemplar ist für ${c.usedBy.goalName} eingeplant`);
      if (free) parts.push(`${count(free, 'Exemplar ist', 'Exemplare sind')} ungenutzt`);
      lines.push(`Du hast ${count(r.copies.length, 'Exemplar', 'Exemplare')} dieses CCU: ${parts.join(', ')}.`);
    } else lines.push('Du hast kein Exemplar dieses CCU.');
    const names = [...new Set(r.onRoutes.map((x) => x.goalName))];
    lines.push(names.length ? `Dieser Schritt ist für ${joinList(names)} eingeplant.` : 'Keine Route enthält diesen Schritt.');
    if (effect) {
      const e = r.effect;
      lines.push(buyRowText({ copies: 1, spent: e.purchase.spent, saved: 0 - e.totalDelta, net: e.net, usedCopies: e.usedCopies, deltas: e.deltas }));
    }
    return lines;
  },
  offerTile(r) {
    const e = r.effect;
    const spent = e.purchase.spent;
    const saved = -e.totalDelta;
    const helped = cheaper(e.deltas);
    if (e.net < 0) {
      const goal = helped.length === 1 ? helped[0].name : null;
      const replaces = goal != null && r.onRoutes.some((x) => x.goalName === goal && x.kind !== 'owned');
      const text = replaces
        ? `Du sparst insgesamt ${usd(-e.net)}. Der Kauf für ${usd(spent)} ersetzt für ${goal} einen geplanten Kauf für ${usd(saved)}.`
        : `Du sparst insgesamt ${usd(-e.net)}. Wenn du jetzt ${usd(spent)} zahlst, brauchst du später ${goal == null ? 'für deine Ziele' : `für ${goal}`} ${usd(saved)} weniger.`;
      return { tone: 'good', head: `Lohnt sich · du sparst ${usd(-e.net)}`, text };
    }
    if (e.net > 0 && saved > 0) return { tone: 'bad', head: `Auslassen · kostet ${usd(e.net)} mehr`, text: `Der Kauf kostet ${usd(spent)} und spart bei deinen Zielen nur ${usd(saved)}.` };
    if (e.net === 0 && saved > 0) return { tone: 'neutral', head: 'Keine Ersparnis', text: `Du zahlst ${usd(saved)} ${planOf(e.deltas)} vorab. Der Gesamtbetrag bleibt gleich.` };
    return { tone: 'neutral', head: 'Nicht nötig', text: r.verdict };
  },
  'offerCheck.verdict'(effect, saving, n, onRoutes, from, to, cash, shipName) {
    if (saving > 0) {
      const helped = cheaper(effect.deltas);
      const gets = helped.length === 1 ? `${helped[0].name} wird um ${usd(saving)} günstiger.`
        : `${helped.length ? `${helped.length} Ziele werden` : 'Deine Ziele werden'} insgesamt um ${usd(saving)} günstiger.`;
      return n ? `Du hast schon ${count(n, 'Exemplar', 'Exemplare')}. Ein weiteres lohnt sich. ${gets}` : gets;
    }
    if (n) return `Du hast schon ${count(n, 'Exemplar', 'Exemplare')}. Kein Ziel braucht ein weiteres.`;
    if (onRoutes.length) {
      const goals = joinList(onRoutes.map((r) => r.goalName));
      return `${goals} ${onRoutes.length === 1 ? 'nutzt' : 'nutzen'} bereits ${shipName(from)} → ${shipName(to)}. Für ${usd(cash)} bringt der Kauf keine Ersparnis.`;
    }
    return 'Kein Ziel würde dadurch günstiger.';
  },
  'offerCheck.differentPrices': (values) => `zwei verschiedene Preise (${joinList([...values].map((c) => usd(c)))})`,

  proposedLabel: (cash) => `${t(PROPOSED_LABEL)} · ${usd(cash)}`,
  reservedLabel: (cash) => `${t(RESERVED_LABEL)} · ${usd(cash)}`,
  proposedEffectText(reservedCash, proposedCash) {
    const stays = t(RESERVED_STAYS);
    if (reservedCash == null || proposedCash == null) return stays;
    const diff = reservedCash - proposedCash;
    if (diff > 0) return `Du brauchst ${usd(diff)} weniger neues Geld. ${stays}`;
    if (diff < 0) return `Du brauchst ${usd(-diff)} mehr neues Geld. ${stays}`;
    return `Du brauchst gleich viel neues Geld. Die Schritte ändern sich. ${stays}`;
  },
  changeLines(changes, name) {
    const pair = (s) => `${name(s.from)} → ${name(s.to)}`;
    const dropped = new Set(changes.dropped.map(edgeKey));
    const added = new Set(changes.added.map(edgeKey));
    return [
      ...changes.dropped.map((s) => `Entfällt: ${pair(s)} (${kindText(s)}${s.copyId ? ', für andere Ziele frei' : ''})`),
      ...changes.added.map((s) => `Kommt hinzu: ${pair(s)} (${kindText(s)}${s.copyId ? ', neu reserviert' : ''})`),
      ...changes.released.filter((s) => !dropped.has(edgeKey(s))).map((s) => `Freigegeben: dein Exemplar von ${pair(s)} (für andere Ziele frei)`),
      ...changes.claimed.filter((s) => !added.has(edgeKey(s))).map((s) => `Reserviert: ein anderes Exemplar von ${pair(s)}`),
    ];
  },
  proposedBanner(reservedCash, proposedCash, changedSteps = 0) {
    const diff = changedSteps ? ` · ${count(changedSteps, 'Schritt ändert sich', 'Schritte ändern sich')}` : '';
    if (proposedCash < reservedCash) return { tone: 'better', text: `Günstigere Kette: ${usd(proposedCash)} statt ${usd(reservedCash)}${diff}` };
    if (proposedCash > reservedCash) return { tone: 'worse', text: `Andere Kette vorgeschlagen: ${usd(proposedCash)} statt ${usd(reservedCash)}${diff}` };
    return { tone: 'same', text: `Andere Kette vorgeschlagen, gleich viel neues Geld: ${usd(proposedCash)}${diff}` };
  },
  comparingBanner: (cash) => `Du siehst die vorgeschlagene Kette · ${usd(cash)}`,

  reservationLines(items, name) {
    const lines = items.copies.map((c) => `${name(c.from)} → ${name(c.to)} (Upgrade im Besitz${c.paid != null ? `, ${usd(c.paid)} bezahlt` : ''})`);
    if (items.token) lines.push(`Startschiff: ${items.token.ship != null ? name(items.token.ship) : 'dein Schiff mit LTI'}`);
    if (items.credit > 0) lines.push(`Store-Guthaben: ${usd(items.credit)}`);
    return lines;
  },
  reservationSummary(items, name) {
    const parts = [];
    if (items.copies.length) parts.push(count(items.copies.length, 'Upgrade im Besitz', 'Upgrades im Besitz'));
    if (items.token) parts.push(`dein Startschiff${items.token.ship != null ? ` ${name(items.token.ship)}` : ''}`);
    if (items.credit > 0) parts.push(`${usd(items.credit)} Store-Guthaben`);
    return joinList(parts);
  },
  reserveHeading: (name, hasItems = true) => hasItems ? `Beim Reservieren hältst du Folgendes für ${name} fest. Für andere Ziele ist es dann gesperrt:` : `Reserviere diese Kette für ${name}.`,
  reservedHeading: (name, hasItems = true) => hasItems ? `Reserviert für ${name}. Für andere Ziele ist Folgendes gesperrt:` : `Reserviert für ${name}.`,

  'ccugameCompare.storeStartNote': (f) => `CCU Game startet mit ${f.fromName} aus dem Store ohne LTI${f.startCost ? ` (${usd(f.startCost)} fürs Schiff sind im Betrag enthalten und werden beim Vergleich abgezogen)` : ''}`,
  currencyProblem(pricing) {
    const p = pricing?.declared === undefined ? normalizePricing(pricing) : pricing;
    if (!p.declared) return 'Der Planer unterstützt nur Store-Konten in USD. In deinen gespeicherten Store-Daten fehlt die Währung. Synchronisiere den Store erneut. Bis dahin siehst du keinen Plan.';
    if (p.currencyCode !== 'USD') return `Dein Konto verwendet ${p.currencyCode}. Preise und Warbond-Angebote sind nur für USD geprüft. Deshalb siehst du keinen Plan.`;
    if (p.taxRate && !p.isTaxInclusive) return 'Auf deine Store-Preise kommen noch Steuern. Der Planer rechnet nur mit USD-Preisen ohne Steuern. Deshalb siehst du keinen Plan.';
    if (p.taxRate) return 'Deine Store-Preise enthalten Steuern. Der Planer kann bisher nur USD-Preise ohne Steuern lesen. Deshalb siehst du keinen Plan.';
    return null;
  },
  'goals.reservedCopiesError': (clash, others) => `CCUs bereits reserviert: ${clash.map((s) => `${s.copyId} für ${others.get(s.copyId)}`).join(', ')}`,
  'goals.reservedCreditError': (needed, free) => `Die Kette braucht ${usd(needed)} Store-Guthaben. Nur ${usd(free)} sind frei.`,

  versusText(best, alt, objective = 'cash', { concept = null, name = null } = {}) {
    if (objective === 'allin' && alt.allIn !== best.allIn) return `${usd(alt.allIn - best.allIn)} niedrigere Gesamtkosten als bei der nächsten Route`;
    if (alt.cash !== best.cash) return `${usd(alt.cash - best.cash)} weniger neues Geld als bei der nächsten Route`;
    const lead = objective === 'allin' ? 'Gleiche Gesamtkosten und gleich viel neues Geld' : 'Gleich viel neues Geld';
    if (alt.creditUsed !== best.creditUsed) return `${lead}, aber du brauchst ${usd(Math.abs(alt.creditUsed - best.creditUsed))} ${alt.creditUsed > best.creditUsed ? 'weniger' : 'mehr'} Store-Guthaben`;
    if (concept?.size && conceptWarbonds(alt, concept).length > conceptWarbonds(best, concept).length) {
      const bestWarbonds = conceptWarbonds(best, concept);
      const who = conceptWarbonds(alt, concept).filter((a) => !bestWarbonds.some((b) => b.from === a.from))
        .map((a) => (name ? name(a.from) : t('unknown ship')));
      const ships = who.length === 1 ? 'ist ein Konzeptschiff' : 'sind Konzeptschiffe';
      return `${lead}. Warbonds von flugfähigen Schiffen haben Vorrang. ${joinList(who)} ${ships}. Bei Konzeptschiffen können die Preise noch steigen`;
    }
    if (alt.ownedUsed !== best.ownedUsed) {
      const n = best.ownedUsed - alt.ownedUsed;
      const copies = Math.abs(n) === 1 ? 'ein zusätzliches CCU' : `${Math.abs(n)} zusätzliche CCUs`;
      return `${lead}, aber du ${n > 0 ? `nutzt ${copies} aus deinem Bestand` : `hältst ${copies} frei`}`;
    }
    if (alt.steps.length !== best.steps.length) {
      const n = alt.steps.length - best.steps.length;
      return `${lead}, ${count(Math.abs(n), 'Schritt', 'Schritte')} ${n > 0 ? 'weniger' : 'mehr'}`;
    }
    const buys = (r) => r.steps.filter((x) => x.kind !== 'owned').length;
    const n = buys(alt) - buys(best);
    if (n) return `${lead}, ${count(Math.abs(n), 'Kauf', 'Käufe')} ${n > 0 ? 'weniger' : 'mehr'}`;
    return `${lead} und gleicher Aufwand. Bei Gleichstand entscheidet eine feste Reihenfolge`;
  },
  'decision.lockText'(why, event, expected) {
    if (why === 'event') return eventLockWhy(event);
    if (why === 'concept') return 'Konzeptschiff: Sichere dir den Preis jetzt';
    if (why === 'expected') return `Preis steigt voraussichtlich${expected ? ` auf ${usd(expected.cash)}` : ''}`;
    return 'Preis jetzt sichern: Preissicherung ist eingeschaltet';
  },
  'decision.ownedText': (copy) => `Nutze dein vorhandenes CCU${copy?.paid != null ? ` (${usd(copy.paid)} bereits bezahlt)` : ''}. Es kostet dich jetzt nichts.`,
  'decision.warbondText'(cash, standard) {
    const vs = standard == null ? 'Ein Standard-Upgrade ist gerade nicht im Angebot.'
      : standard > cash ? `Das sind ${usd(standard - cash)} weniger als für Standard.` : 'Standard kostet höchstens genauso viel.';
    return `Kauf Warbond jetzt für ${usd(cash)}. ${vs} Warbond-Angebote können wieder verschwinden.`;
  },
  'decision.standardLockText'(cash, why, event) {
    if (why === 'event') return eventLockDecision(cash, event);
    const reason = { concept: 'Das Ziel ist ein Konzeptschiff.', expected: 'Du erwartest einen Preisanstieg.', on: 'Die Preissicherung ist eingeschaltet.' }[why];
    return `Kauf Standard später oder sichere dir jetzt den Preis von ${usd(cash)}. ${reason ?? ''}`.trimEnd();
  },
  'decision.verdictText'(differs, objective, best) {
    const label = objective === 'allin' ? 'Niedrigste Gesamtkosten' : 'Am wenigsten neues Geld';
    const line = `${label}: ${routeLine(best)}`;
    return differs ? `${line} · ${t(BEST_DIFFERS_LABEL)}` : line;
  },
};
