#!/usr/bin/env bash
# Boot smoke: does the Worker start in workerd, Cloudflare's own runtime? The node tests import src/worker.js
# directly and never see a startup error (a named export workerd refuses, from 282ffb4 on 2026-10-21, kept every build since from starting: see
# src/entry.js). Runs `wrangler dev --local` (nothing deployed, no Cloudflare login, no key: SAMPLE mode), waits for
# Ready, then GET / and /api/health. Exit 0 = boots and answers; 1 = it doesn't (the log's errors are printed).
# Usage: scripts/workerd-boot.sh [port]   (default 8797). Run it on every merge into v2.
set -uo pipefail
ROOT="${DOORS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}" # DOORS_ROOT: check another checkout (a bisect)
PORT="${1:-8797}"
TMP="$(mktemp -d)"
PID=""
cleanup() { [[ -n "$PID" ]] && kill -- -"$PID" 2>/dev/null; sleep 1; [[ -n "$PID" ]] && kill -9 -- -"$PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
fail() { echo "BOOT FAIL: $1"; grep -E "ERROR|Uncaught|✘" "$TMP/dev.log" | sed 's/\x1b\[[0-9;]*m//g' | head -8; exit 1; }
# a copy of wrangler.toml with absolute paths, without [ai]: the AI binding is remote-only and would need a login
sed -e "s|^main = \"\([^\"]*\)\"|main = \"$ROOT/\1\"|" -e "s|^directory = \"\./public\"|directory = \"$ROOT/public\"|" -e '/^\[ai\]$/,/^binding = "AI"$/d' "$ROOT/wrangler.toml" > "$TMP/wrangler.toml"
setsid npx -y wrangler@4 dev --config "$TMP/wrangler.toml" --local --port "$PORT" --ip 127.0.0.1 --persist-to "$TMP/state" > "$TMP/dev.log" 2>&1 < /dev/null &
PID=$!
for _ in $(seq 1 120); do
  grep -q "Ready on" "$TMP/dev.log" && break
  grep -qE "ERROR|failed to start" "$TMP/dev.log" && fail "workerd did not start"
  kill -0 "$PID" 2>/dev/null || fail "wrangler exited"
  sleep 1
done
grep -q "Ready on" "$TMP/dev.log" || fail "not Ready after 120 s"
B="http://127.0.0.1:$PORT"
code="$(curl -s -o "$TMP/index.html" -w '%{http_code}' "$B/")"
[[ "$code" == 200 ]] && grep -qi "<html" "$TMP/index.html" || fail "GET / answered $code"
code="$(curl -s -o "$TMP/health.json" -w '%{http_code}' "$B/api/health")"
[[ "$code" == 200 ]] && grep -q '"ok":true' "$TMP/health.json" || fail "GET /api/health answered $code: $(head -c 200 "$TMP/health.json")"
# the map tiles' byte ranges (src/tiles.js): workerd's asset answer may have no content-length, and a range read must still
# get only its bytes (livesmoke 10-24: bytes=0-15 answered 200 with the whole 15 MB file); a tile-sized range and a
# plain read are unchanged
T="$B/tiles/austin.pmtiles"
SIZE=$(stat -c %s "$ROOT/public/tiles/austin.pmtiles")
read -r code n < <(curl -s -H "Range: bytes=0-15" -o "$TMP/r0" -w '%{http_code} %{size_download}' "$T")
[[ "$code" == 206 && "$n" == 16 ]] || fail "tiles bytes=0-15 answered $code with $n bytes (want 206, 16)"
cmp -s "$TMP/r0" <(head -c 16 "$ROOT/public/tiles/austin.pmtiles") || fail "tiles bytes=0-15: not the file's first 16 bytes"
read -r code n < <(curl -s -H "Range: bytes=16384-32767" -o "$TMP/r1" -w '%{http_code} %{size_download}' "$T")
[[ "$code" == 206 && "$n" == 16384 ]] || fail "tiles bytes=16384-32767 answered $code with $n bytes (want 206, 16384)"
cmp -s "$TMP/r1" <(tail -c +16385 "$ROOT/public/tiles/austin.pmtiles" | head -c 16384) || fail "tiles bytes=16384-32767: wrong bytes"
read -r code n < <(curl -s -o /dev/null -w '%{http_code} %{size_download}' "$T")
[[ "$code" == 200 && "$n" == "$SIZE" ]] || fail "tiles without a range answered $code with $n bytes (want 200, $SIZE)"
TILES="tiles 0-15 → 206/16 B, a 16 KiB range → 206, no range → 200/$SIZE B"
grep -qE "ERROR|Uncaught" "$TMP/dev.log" && fail "errors in the log after the requests"
echo "BOOT OK: workerd started; / and /api/health answered 200; $TILES ($(head -c 160 "$TMP/health.json"))"
