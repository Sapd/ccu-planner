// Routes the controller's load/save to one of two backends (the real one, or the in-memory sample) and binds every
// save to the backend of the state that is actually shown: `loadedWith` changes only when the controller has derived
// and committed the new state (committed()), never merely because a load returned. So a derive error, a slow load
// or a failed switch can never send sample documents to the real data folder, or the other way round.

export function createBackendSwitch(initial) {
  let active = initial;
  let loadedWith = initial;
  let pending = initial;
  return {
    async load() { const backend = active; const raw = await backend.load(); pending = backend; return raw; },
    /** Called by the controller once the state from the last load is in place. */
    committed() { loadedWith = pending; },
    /** The backend of the state now shown. */
    current: () => loadedWith,
    save: (name, doc, baseRev) => loadedWith.save(name, doc, baseRev),
    /** Loads from `next` through `reload` (the controller's load); the previous backend stays when that fails, and the error is thrown. */
    async switchTo(next, reload) {
      const previous = active;
      active = next;
      try { await reload(); } catch (e) { active = previous; throw e; }
    },
  };
}

/** Switches the data after every save already started has finished, so none can land on the new state. */
export async function switchBackend(route, controller, next) {
  await controller.idle();
  await route.switchTo(next, () => controller.load());
}
