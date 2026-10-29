#!/usr/bin/env bash
# The proof re-run for a freeze, one command: any change to Doors' words re-keys the judge cache (the key is the
# prompt), so a freeze head needs its own verdicts. Asks the judge (claude -p, Sonnet, the owner's plan, no spend) for
# every item not yet judged on this exact text, re-asks popularity in both A/B orders, rewrites docs/PROOF.md and
# data/proof/*.json, then checks every number README.md and SUBMISSION.md quote. Exit 1 = a doc number drifts or an
# item is still unjudged (rerun: verdicts already in hand are kept). ~65 judge calls on fresh text, ~40 min.
#   scripts/proof-freeze.sh
set -euo pipefail
cd "$(dirname "$0")/.."
nice -n 15 node scripts/proof/both-orders.mjs
nice -n 15 node scripts/proof.mjs --judge
node scripts/doc-numbers.mjs --check
