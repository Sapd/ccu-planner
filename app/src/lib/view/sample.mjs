// "Try with sample data": a backend that keeps everything in memory. It has the same load/save as the real
// backend but touches no file, no data folder and no RSI session, so it can never overwrite real data.

const DOCS = { plans: 'plans', overrides: 'overrides', 'sale-events': 'saleEvents' };

/** @param {object} raw the sample's RawData (see src/logic/sampleData.mjs) */
export function createSampleBackend(raw) {
  const docs = { plans: raw.plans ?? null, overrides: raw.overrides ?? null, saleEvents: raw.saleEvents ?? null };
  return {
    load: async () => structuredClone({ ...raw, ...docs }),
    save: async (name, doc, baseRev) => {
      const key = DOCS[name];
      if (!key) throw new Error('unknown document name');
      if ((docs[key]?.rev ?? 0) !== baseRev) throw { conflict: true };
      const rev = baseRev + 1;
      docs[key] = structuredClone({ ...doc, rev });
      return rev;
    },
  };
}
