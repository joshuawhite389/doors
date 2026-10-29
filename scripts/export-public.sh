#!/usr/bin/env bash
# Build the PUBLIC copy of Doors in <out-dir>: the committed tree (HEAD) minus every file that holds Qloo response
# data or is derived from it (Qloo's #qloo rule, Oct 6: "don't store Qloo response data in a public repo"). The
# deployed Worker still serves the full data: publish.sh deploys from this private tree, then pushes only this copy.
# The private git history (which has the data) is never pushed. Usage: scripts/export-public.sh <out-dir>
# (scripts/export-public.sh --check <dir>: the guard alone, on an export already made)
set -euo pipefail
# The guard, on an export (also on its own: scripts/export-public.sh --check <dir>, which builds nothing).
REPO="$(cd "$(dirname "$0")/.." && pwd)"   # the private tree: its Qloo data names the venues the guard looks for
UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
guard() {
echo "== export guard"
bad=0
[[ -d data ]] && { echo "data/ is present"; bad=1; }
for f in CLAUDE.md PROGRESS.md LIVE-SMOKE.md tests scripts/dev/eval-runs docs/PLAN-V2.md docs/ROUTING-V3.md docs/SPEC-V2.md docs/PROOF.md docs/JUDGE-WALKTHROUGH.md docs/ROUTING-V5.md docs/ROUTING-V5-EVAL.md; do [[ -e $f ]] && { echo "$f is private"; bad=1; }; done
# the map's libraries are ours to serve, never a CDN's, and each vendored part ships its license
grep -lE 'unpkg\.com|jsdelivr|protomaps\.github\.io|fonts\.(googleapis|gstatic)\.com' public/*.html public/ui/*.js public/lib/*.js public/sw.js 2>/dev/null | sed 's/^/CDN at runtime: /' | grep . && bad=1
for d in public/vendor/maplibre-gl-5.24.0 public/vendor/pmtiles-4.5.0 public/vendor/protomaps-basemaps-5.7.2 public/vendor/basemaps-assets/fonts public/vendor/basemaps-assets/sprites public/vendor/fonts/inter public/vendor/fonts/intertight; do ls "$d" 2>/dev/null | grep -qiE '^(LICENSE|OFL)' || { echo "$d has no license file"; bad=1; }; done
[[ -n "$(find public/data -type f ! -path public/data/facts.json 2>/dev/null)" ]] && { echo "public/data has Qloo files"; bad=1; }
# the drink list and the raw brand-search answers by path, whatever their ids look like (auditor, 2026-10-22)
named="$(find . \( -name 'drinks*.json' -o -path ./test/fixtures/qloo-search-\*.json -o -path ./test/fixtures/agent/\* \) -type f; [[ -e data/drinks ]] && echo ./data/drinks || true)"
[[ -n "$named" ]] && { echo "$named"; echo "^ Qloo data (drink list, brand-search answers)"; bad=1; }
# Any UUID in any text file that is not one of the synthetic ids above means a Qloo entity id leaked in.
leaks="$(grep -rIoiE "$UUID" . | grep -viE ':(00000000-0000-4000-8000-|11111111-2222-3333-4444-555555555555)' || true)"
[[ -n "$leaks" ]] && { echo "$leaks"; echo "^ these files carry Qloo entity ids"; bad=1; }
# A file naming many of Qloo's venues is a Qloo list, ids or not: tests/day1.md shipped sister-door lists for 10 rooms
# and popularity medians that way. scripts/venue-lists.mjs has the rule and its threshold.
if lists="$(node "$REPO/scripts/venue-lists.mjs" "$REPO" . 2>&1)"; then
  [[ -n "$lists" ]] && { echo "$lists"; echo "^ these files list Qloo venues (names found, file, first names)"; bad=1; }
else echo "$lists"; echo "the venue-list check could not run"; bad=1; fi
# no build-lane or agent names in the public copy: comments say what the code does, not who changed it
names="$(grep -rIlE 'gigbot[-]|\b[Ll]ane L[0-9]|\(L[0-9]\b|\b[Ee]ase (fixes |lane )?L[0-9]\b|\bL[0-9] privacy' . || true)"
[[ -n "$names" ]] && { echo "$names"; grep -rInoE '.{0,30}(gigbot[-]|\b[Ll]ane L[0-9]|\(L[0-9]\b|\b[Ee]ase (fixes |lane )?L[0-9]\b|\bL[0-9] privacy).{0,20}' $names | head -20; echo "^ these files name build lanes (gigbot[-]…, lane L<n>, (L<n>…)"; bad=1; }
[[ $bad == 0 ]] || { echo "export guard failed"; exit 1; }
echo "clean"
}
[[ "${1:-}" == --check ]] && { cd "${2:?usage: scripts/export-public.sh --check <dir>}"; guard; exit 0; }
cd "$(dirname "$0")/.."
OUT="${1:?usage: scripts/export-public.sh <out-dir>}"
[[ -e "$OUT" && -n "$(ls -A "$OUT" 2>/dev/null)" ]] && { echo "$OUT is not empty"; exit 1; }
mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"

# Qloo-derived files. public/data/facts.json is hand-sourced (not Qloo) and stays; public/tiles/ is OSM.
cd "$OUT"
find public/data -type f ! -path public/data/facts.json -delete
find public/data -type d -empty -delete
rm -rf data                                    # entities, pitches, talk lines, extra doors, ledger, OSRM cache
rm -f test/fixtures/athletic-brewing-*.json test/fixtures/r2-austin-profile.json test/fixtures/road-austin-day1.json test/fixtures/heineken-budlight-boise.json
rm -f test/fixtures/qloo-search-*.json         # raw Qloo brand-search answers (owner review 7)
rm -rf test/fixtures/agent                     # R9: recorded agent turns quote Qloo's venue records
find screenshots -name report.json -delete    # demo-run request logs, with Qloo entity ids
rm -f CLAUDE.md PROGRESS.md                    # the build notes stay private (Jard, 2026-10-21)
rm -f LIVE-SMOKE.md                            # the owner's post-publish run steps (paths on his box)
rm -rf tests                                   # day1.md: Qloo sister-door lists + popularity medians (pre-audit 3, A3)
rm -rf scripts/dev/eval-runs                   # agent eval runs list Qloo venues (agentcore 10-23, A3); untracked now, gone here too
# The plans and design notes quote ranks, venues and ids from real runs: build notes too.
rm -f docs/PLAN-V2.md docs/ROUTING-V3.md docs/SPEC-V2.md
rm -f docs/PROOF.md docs/JUDGE-WALKTHROUGH.md     # quote venues, ranks and Qloo text from runs
rm -f docs/ROUTING-V5.md docs/ROUTING-V5-EVAL.md   # quote raw Qloo affinities by brand and city
sed -i 's| (docs/ROUTING-V3\.md)||g' README.md SUBMISSION.md
perl -0pi -e 's/<!-- QUOTE-SLOT.*?-->\n//s' SUBMISSION.md   # the empty quote slot is a note to ourselves
# Qloo entity ids in code, tests and scripts (demo contacts, fixtures inline) → synthetic ids, the same everywhere so
# the tests still match: 00000000-0000-4000-8000-<12 hex of a hash>, case kept.
grep -rlIiE "$UUID" . | node -e '
const fs = require("fs"), { createHash } = require("crypto");
const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const fake = (id) => { if (/^00000000-0000-4000-8000-|^11111111-2222-3333-4444-555555555555$/i.test(id)) return id;
  const s = "00000000-0000-4000-8000-" + createHash("sha1").update(id.toUpperCase()).digest("hex").slice(0, 12);
  return id === id.toLowerCase() ? s : s.toUpperCase(); };
for (const f of fs.readFileSync(0, "utf8").split("\n").filter(Boolean)) fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(re, fake));'
# src/sample-data.js is trimmed real Qloo responses; ship an empty stand-in so SAMPLE=1 still loads.
cat > src/sample-data.js <<'JS'
// Empty in the public repo: Qloo's terms keep its responses out of public repos. Regenerate the real offline sample
// from your own precompute with `node scripts/make-sample.mjs` (needs data/raw/, see README "Data").
export const SAMPLE = { page: { results: { entities: [] }, query: {} }, sisters: { results: { entities: [] } }, sounds: [{ results: { entities: [] } }], city: { results: { entities: [] } }, search: [] };
JS
# src/enrich-baseline.js is counts over Qloo's answers (brand and tag names); ship the empty baseline, so a live door's
# record compares with nothing (vsCity lifts null) until the public build bakes its own (scripts/enrich-baseline.mjs).
cat > src/enrich-baseline.js <<'JS'
// Public export: the empty baseline. The private build generates this file with scripts/enrich-baseline.mjs from its
// data/enrich/*.json (counts over every door Qloo takes as a signal); a live door's record is compared with it.
export const ENRICH_BASELINE = { n: 0, drinkCount: {}, brandCount: {}, tagCount: { music: {}, dishes: {}, keywords: {}, hobbies: {}, tone: {} }, catShare: {}, ageMed: {}, genderMed: null, cities: [], baked: null };
JS

guard
echo "== public test suite"; node scripts/test.mjs
