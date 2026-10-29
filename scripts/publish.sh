#!/usr/bin/env bash
# One-time publish of Doors. RUN BY THE OWNER ONLY (Jard). Agents must not run this: it creates public surfaces
# under his name.
#   1. checks the key files and runs the offline tests
#   2. stores the Qloo key and the optional Gemini / ORS / Geoapify keys as Cloudflare secrets (read from files, never
#      printed; an optional key whose file is missing is skipped, and the app falls back as README "Limits" says)
#   3. deploys the Worker and smoke-tests /api/health
#   4. writes the live URL into README.md, commits it here, and pushes a PUBLIC copy (scripts/export-public.sh: no
#      Qloo response data, no private history) to joshuawhite389/doors. The Worker keeps serving the full data.
# Needs: gh logged in; ~/.config/gigbot/{qloo-key,cloudflare-token,cloudflare-account-id}; optional: gemini-key,
# ors-key (road routing + address search; without it every route is the labelled straight-line estimate), geoapify-key
# (a future routing provider, slice G1; stored now so it is ready, unused by this build).
# Exports the branch you are on: run it from master after landing v2.
set -euo pipefail
cd "$(dirname "$0")/.."
C="$HOME/.config/gigbot"
REPO="joshuawhite389/doors"
for f in qloo-key cloudflare-token cloudflare-account-id; do
  [[ -s "$C/$f" ]] || { echo "Missing $C/$f"; exit 1; }
done

if grep -q "TODO" SUBMISSION.md; then echo "(note: SUBMISSION.md still has TODO lines: add the quotes or delete \"What a rep said\" before it goes public)"; fi

echo "== secret check (no tracked file may contain a key)"
for f in qloo-key gemini-key ors-key geoapify-key cloudflare-token cloudflare-account-id; do
  if [[ -s "$C/$f" ]] && git grep -qF -f "$C/$f" -- . 2>/dev/null; then
    echo "A tracked file contains the contents of $C/$f. Stop and remove it before publishing."; exit 1
  fi
done
echo "clean"

export CLOUDFLARE_API_TOKEN="$(<"$C/cloudflare-token")"
export CLOUDFLARE_ACCOUNT_ID="$(<"$C/cloudflare-account-id")"
WR="npx -y wrangler@4"

echo "== tests (full suite, with the data)"; node --test test/ >/dev/null && echo "pass"

echo "== KV: the build's monthly call counter (required for the monthly ceiling, BUILD_BUDGET, to hold in production)"
KV_ID="$($WR kv namespace list 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=JSON.parse(s).find(x=>/DOORS_KV/.test(x.title));if(n)console.log(n.id)}catch{}})')"
if [[ -z "$KV_ID" ]]; then
  KV_ID="$($WR kv namespace create DOORS_KV 2>&1 | grep -oE '[0-9a-f]{32}' | head -1)"
fi
[[ -n "$KV_ID" ]] || { echo "Could not create or find the DOORS_KV namespace; stop here."; exit 1; }
sed -i "s|^id = \".*\"|id = \"$KV_ID\"|" wrangler.toml
MONTH="$(date -u +%Y-%m)"
USED="$(node -e 'import("./src/ledger.js").then(l=>console.log(l.ledgerCount(l.readLedger("data/ledger.jsonl"),process.argv[1])))' "$MONTH")"
# one counter value a month (src/kvbook.js): {calls, day, runs, writes, ips}; only its calls are seeded, never lowered
CUR="$($WR kv key get --namespace-id "$KV_ID" "count:$MONTH" --remote --text 2>/dev/null || true)"
NEXT="$(node -e '
  let c = {}; try { c = JSON.parse(process.argv[1] || "{}") || {}; } catch {}
  const used = Number(process.argv[2]); c.calls = Math.max(Number(c.calls ?? 0), used);
  console.log(JSON.stringify(c));' "$CUR" "$USED")"
$WR kv key put --namespace-id "$KV_ID" "count:$MONTH" "$NEXT" --remote >/dev/null
echo "counter count:$MONTH = $NEXT (ledger $USED)"

echo "== Cloudflare secrets"
$WR secret put QLOO_API_KEY < "$C/qloo-key" >/dev/null
if [[ -s "$C/gemini-key" ]]; then $WR secret put GEMINI_API_KEY < "$C/gemini-key" >/dev/null; else echo "(no Gemini key: pitches use the template)"; fi
if [[ -s "$C/ors-key" ]]; then $WR secret put ORS_API_KEY < "$C/ors-key" >/dev/null; else echo "(no ORS key: routes and drive times are the labelled straight-line estimate; address search says it is off)"; fi
if [[ -s "$C/geoapify-key" ]]; then $WR secret put GEOAPIFY_API_KEY < "$C/geoapify-key" >/dev/null; fi

echo "== deploy (first time only: it may ask you to pick a workers.dev subdomain, any name is fine)"
$WR deploy | tee .deploy.log
URL="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' .deploy.log | head -1)"; rm -f .deploy.log
[[ -n "$URL" ]] || { echo "Deploy printed no URL; stop here."; exit 1; }
curl -fsS "$URL/api/health" && echo

echo "== KV: the pre-warmed popular runs (scripts/prewarm.mjs wrote data/prewarm/); safe to repeat"
# One KV write per run (the free plan allows 1,000 a day): each run's value with its saved-runs entry as metadata;
# the saved-runs list is a KV list() of them, so nothing else is written. Dry run first, without touching Cloudflare:
# node scripts/prewarm.mjs --bulk=/tmp/doors-bulk writes the files this step uploads and says how many writes.
if ls data/prewarm/*.json >/dev/null 2>&1; then
  node scripts/prewarm-convert.mjs   # files from an older pre-warm (aliases, runs-index.json) → the current format
  BULKDIR="$(mktemp -d)"
  node scripts/prewarm.mjs --bulk="$BULKDIR"
  for f in "$BULKDIR"/bulk-*.json; do $WR kv bulk put "$f" --namespace-id "$KV_ID" --remote; done
  rm -rf "$BULKDIR"
else
  echo "(no data/prewarm/: the site starts with no saved runs)"
fi

echo "== GitHub (public copy of $(git branch --show-current) at $(git rev-parse --short HEAD); private history stays here)"
if grep -q "LIVE_URL" README.md; then
  sed -i "s|LIVE_URL|$URL|g" README.md SUBMISSION.md
  git add README.md SUBMISSION.md wrangler.toml && git commit -qm "Live demo URL and KV namespace id" || true
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "(note: uncommitted changes stay local; only the committed tree is exported)"
fi
PUB="$(mktemp -d)/doors-public"
scripts/export-public.sh "$PUB"
for f in qloo-key gemini-key ors-key geoapify-key cloudflare-token cloudflare-account-id; do
  if [[ -s "$C/$f" ]] && grep -rqF -f "$C/$f" "$PUB"; then echo "The public copy contains $C/$f. Stop."; exit 1; fi
done
MSG="Doors $(git rev-parse --short HEAD) (public copy: Qloo response data left out, see README \"Data\")"
if gh repo view "$REPO" >/dev/null 2>&1; then
  # The public repo only ever holds exports: lay the new tree over its history and push one commit.
  W="$(mktemp -d)/doors-remote"; gh repo clone "$REPO" "$W" -- -q
  mv "$W/.git" "$PUB/.git"
  git -C "$PUB" add -A && { git -C "$PUB" commit -qm "$MSG" || echo "(public copy unchanged)"; }
  git -C "$PUB" push -q origin HEAD
else
  git -C "$PUB" init -q -b main && git -C "$PUB" add -A && git -C "$PUB" commit -qm "$MSG"
  gh repo create "$REPO" --public --source="$PUB" --push --homepage "$URL" \
    --description "Doors: plans a drink brand's first days in a new city on Qloo's taste data (Qloo Agentic Hackathon)"
  gh repo edit "$REPO" --add-topic qloo --add-topic ai-agent --add-topic cloudflare-workers --add-topic beverage --add-topic field-sales
fi
echo
echo "LIVE:  $URL"
echo "REPO:  https://github.com/$REPO"
