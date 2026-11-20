// Loads data, applies actions, saves the changed document. No framework code:
// state.svelte.js makes it reactive through onChange.
import { applyAction } from '../../../../src/logic/state.mjs';
import { deriveAppState, withDocs } from './derive.mjs';
import { userSaleEvents } from '../../../../src/logic/feed.mjs';
import { t, N_ } from '../../../../src/logic/i18n.mjs';
import { backendError } from './backendErrors.mjs';

// Action result document -> save_doc name (the file names live in the backends).
const DOC_NAMES = { plans: 'plans', overrides: 'overrides', saleEvents: 'sale-events' };

export const CONFLICT_NOTICE = N_('Changed outside the app; reloaded. Do it again.');

/** `feed()` gives the feed's part of the sale events when state is derived: { events, at } (see withDocs); none by default. */
export function createController(backend, aliases, { onChange = () => {}, feed = () => undefined } = {}) {
  let queue = Promise.resolve();

  async function apply(action) {
    const app = self.state;
    if (!app) return;
    try {
      const meta = { catalogAt: app.data.meta.catalogAt, hangarAt: app.data.meta.hangarAt };
      const out = applyAction({ plans: app.plans, overrides: app.overrides, saleEvents: userSaleEvents(app.saleEvents) }, action, { ships: app.data.ships, graph: app.graph, meta });
      const name = out.changed;
      const doc = out[name];
      const bound = backend.current?.();
      const rev = await backend.save(DOC_NAMES[name], doc, doc.rev ?? 0);
      // The data was switched while the save ran (sample data on or off): this result belongs to the old state.
      if (backend.current?.() !== bound) return;
      const saved = { ...doc, rev };
      self.state = name === 'plans' ? withDocs(app, saved, out.overrides, out.saleEvents)
        : name === 'overrides' ? withDocs(app, out.plans, saved, out.saleEvents)
        : withDocs(app, out.plans, out.overrides, saved);
      self.notice = null;
      onChange(self);
      return out.result;
    } catch (e) {
      if (e?.conflict) {
        try {
          await self.load();
          self.notice = t(CONFLICT_NOTICE);
        } catch (loadError) {
          self.notice = t('Changed outside the app; reload failed: {error}', { error: backendError(loadError) });
        }
      } else {
        self.notice = backendError(e);
      }
      onChange(self);
    }
  }

  const self = {
    state: null,
    notice: null,
    async load() {
      self.state = deriveAppState(await backend.load(), aliases, { feed: feed() });
      backend.committed?.(); // the state is derived and in place: saves may follow its backend now
      onChange(self);
    },
    /** Derives the sale events again with the current feed() (the feed changed, or sample data was entered or left). Queued behind running saves. */
    refeed() {
      const run = queue.then(() => {
        const app = self.state;
        if (!app) return;
        self.state = withDocs(app, app.plans, app.overrides, userSaleEvents(app.saleEvents), feed() ?? { events: [], at: null });
        onChange(self);
      });
      queue = run.catch(() => {});
      return run;
    },
    /** Resolves when every dispatch made so far has finished. */
    idle: () => queue,
    // One dispatch at a time: each starts from the state and rev the previous one left.
    dispatch(action) {
      const run = queue.then(() => apply(action));
      queue = run.catch(() => {});
      return run;
    },
  };
  return self;
}
