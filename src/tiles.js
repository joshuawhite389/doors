// /tiles/*: byte ranges for the Protomaps fallback (public/tiles/<city>.pmtiles). pmtiles reads each file in ranges;
// Cloudflare's docs do not promise Range on Workers static assets, so the Worker answers it itself. If the asset
// binding already answers 206 that answer is passed through; a 200 is cut to the range by streaming (the bytes before
// the range are skipped, the stream is cancelled after it), so only the asked-for bytes are held (all of them for an
// open-ended "bytes=0-", up to 22 MiB for Chicago). An asset answer without a content-length never sends the whole file
// for a range read (see unsized).

export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m || (!m[1] && !m[2])) return null; // absent, multi-range or malformed → the whole file
  let a, b;
  if (!m[1]) { a = Math.max(0, size - Number(m[2])); b = size - 1; } // suffix: the last n bytes
  else { a = Number(m[1]); b = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (a > b || a >= size) return { bad: true };
  return { a, b };
}

async function cut(body, a, b) {
  const out = new Uint8Array(b - a + 1);
  const reader = body.getReader();
  let pos = 0, filled = 0;
  while (filled < out.length) {
    const { done, value } = await reader.read();
    if (done) break;
    const end = pos + value.length;
    if (end > a) {
      const from = Math.max(0, a - pos), to = Math.min(value.length, b + 1 - pos);
      out.set(value.subarray(from, to), filled);
      filled += to - from;
    }
    pos = end;
  }
  reader.cancel().catch(() => {});
  return out.subarray(0, filled);
}

export async function handleTiles(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const range = request.headers.get("range");
  const res = await env.ASSETS.fetch(request);
  if (!range || res.status === 206 || res.status !== 200) {
    if (res.status !== 200) return res;
    const h = new Headers(res.headers);
    h.set("accept-ranges", "bytes");
    return new Response(res.body, { status: 200, headers: h });
  }
  const size = Number(res.headers.get("content-length"));
  if (!Number.isFinite(size) || size <= 0) return unsized(request, res, range);
  const r = parseRange(range, size);
  if (!r) return res;
  if (r.bad) { res.body?.cancel(); return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } }); }
  const h = new Headers(res.headers);
  h.set("accept-ranges", "bytes");
  h.set("content-range", `bytes ${r.a}-${r.b}/${size}`);
  h.set("content-length", String(r.b - r.a + 1));
  if (request.method === "HEAD") { res.body?.cancel(); return new Response(null, { status: 206, headers: h }); }
  return new Response(await cut(res.body, r.a, r.b), { status: 206, headers: h });
}

// The asset's 200 has no content-length (local workerd: bytes=0-15 answered 200 with all 15,704,450 bytes of
// austin.pmtiles). A range read never gets the whole file: a closed range "bytes=a-b" (what pmtiles asks) is cut from
// the stream and answers 206 "bytes a-b/*" (with the size when the file ended inside the range); any other range form
// reads the file once to learn its size and answers as above (a malformed or multi-range header: the whole file, 200).
async function unsized(request, res, range) {
  const h = new Headers(res.headers);
  h.set("accept-ranges", "bytes");
  h.delete("content-length");
  const m = /^bytes=(\d+)-(\d+)$/.exec(range.trim());
  if (m) {
    const a = Number(m[1]), want = Number(m[2]);
    if (a > want) { res.body?.cancel(); return new Response(null, { status: 416, headers: { "content-range": "bytes */*" } }); }
    const bytes = await cut(res.body, a, want);
    const short = bytes.length < want - a + 1; // the file ended inside the range: its size is known
    if (!bytes.length) return new Response(null, { status: 416, headers: { "content-range": short ? `bytes */${a}` : "bytes */*" } });
    const b = a + bytes.length - 1;
    h.set("content-range", `bytes ${a}-${b}/${short ? b + 1 : "*"}`);
    h.set("content-length", String(bytes.length));
    return new Response(request.method === "HEAD" ? null : bytes, { status: 206, headers: h });
  }
  const all = new Uint8Array(await new Response(res.body).arrayBuffer());
  const r = parseRange(range, all.length);
  if (!r) { h.set("content-length", String(all.length)); return new Response(request.method === "HEAD" ? null : all, { status: 200, headers: h }); }
  if (r.bad) return new Response(null, { status: 416, headers: { "content-range": `bytes */${all.length}` } });
  h.set("content-range", `bytes ${r.a}-${r.b}/${all.length}`);
  h.set("content-length", String(r.b - r.a + 1));
  return new Response(request.method === "HEAD" ? null : all.slice(r.a, r.b + 1), { status: 206, headers: h });
}
