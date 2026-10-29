// The phone's tap-to-talk recording as the WAV the Worker takes (POST /api/voice/listen, src/voice.js: a PCM WAV with
// the 44-byte header the web's encoder writes, public/ui/voice.js toWav). iOS's recorder writes a valid WAV but with more
// chunks than that: a JUNK (or FLLR) chunk before "fmt " and/or before "data", so the Worker's header read (byte rate at
// 28, audio from 44) would read the wrong numbers. This walks the chunks and rebuilds the plain header around the same
// samples. Shared so a test can run it in node (test/phonemic.test.mjs).

const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// bytes of any RIFF/WAVE → {format, channels, rate, bits, data} (data: the samples' bytes), or null when it isn't one
export function readWav(b) {
  if (!b || b.byteLength < 12 || tag(b, 0) !== "RIFF" || tag(b, 8) !== "WAVE") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fmt = null;
  for (let o = 12; o + 8 <= b.byteLength; ) {
    const id = tag(b, o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= b.byteLength) {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) return null;
      // a recorder stopped mid-write can leave the size short or 0xFFFFFFFF: the bytes that are there are the audio
      const end = size > 0 && size !== 0xffffffff ? Math.min(b.byteLength, body + size) : b.byteLength;
      return { ...fmt, data: b.subarray(body, end) };
    }
    o = body + size + (size & 1); // chunks are padded to even sizes
  }
  return null;
}

// any 16-bit PCM WAV → the plain 44-byte-header WAV (same samples), or null when it isn't 16-bit PCM
export function plainWav(b) {
  const w = readWav(b);
  if (!w || w.format !== 1 || w.bits !== 16 || !w.channels || !w.rate) return null;
  const n = w.data.byteLength - (w.data.byteLength % (2 * w.channels));
  const out = new Uint8Array(44 + n);
  const v = new DataView(out.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, w.channels, true); v.setUint32(24, w.rate, true);
  v.setUint32(28, w.rate * w.channels * 2, true); v.setUint16(32, w.channels * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n, true);
  out.set(w.data.subarray(0, n), 44);
  return out;
}

// seconds of audio in a plain WAV's samples
export const wavSecs = (b) => {
  const w = readWav(b);
  return w && w.rate && w.channels && w.bits ? w.data.byteLength / (w.rate * w.channels * (w.bits / 8)) : 0;
};

// a plain 16-bit PCM WAV cut to the audio from fromSec on (the hands-free ear keeps a long quiet wait out of what it
// sends: only the rep's words, with a short run-up). → the same WAV when fromSec ≤ 0 or it isn't one.
export function wavSlice(b, fromSec) {
  const w = readWav(b);
  if (!w || !(fromSec > 0) || w.format !== 1 || w.bits !== 16) return b;
  const skip = Math.min(w.data.byteLength, Math.floor(fromSec * w.rate) * w.channels * 2);
  if (!skip) return b;
  const out = plainWav(b);
  return out ? cutPlain(out, skip) : b;
}
// the plain 44-byte-header WAV without its first `skip` bytes of samples
function cutPlain(out, skip) {
  const n = out.byteLength - 44 - skip;
  const cut = new Uint8Array(44 + n);
  cut.set(out.subarray(0, 44));
  cut.set(out.subarray(44 + skip), 44);
  const cv = new DataView(cut.buffer);
  cv.setUint32(4, 36 + n, true);
  cv.setUint32(40, n, true);
  return cut;
}
