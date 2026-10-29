// Public export: the empty baseline. The private build generates this file with scripts/enrich-baseline.mjs from its
// data/enrich/*.json (counts over every door Qloo takes as a signal); a live door's record is compared with it.
export const ENRICH_BASELINE = { n: 0, drinkCount: {}, brandCount: {}, tagCount: { music: {}, dishes: {}, keywords: {}, hobbies: {}, tone: {} }, catShare: {}, ageMed: {}, genderMed: null, cities: [], baked: null };
