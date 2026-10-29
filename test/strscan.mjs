// Test helper: the pieces of text a JS file can show a reader (string literals and template text outside ${}),
// with comments, code and regex literals skipped. Used by popular-words.test.mjs.
// Pieces of text a JS file shows: string literals and template text (outside ${}), comments and code skipped.
export function textPieces(src) {
  const out = []; let i = 0, line = 1; const n = src.length;
  const push = (s, l) => { if (s) out.push({ text: s, line: l }); };
  function tmpl() { // at index after the opening backtick
    let buf = "", l = line;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { buf += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { i++; push(buf, l); return; }
      if (c === "$" && src[i + 1] === "{") { push(buf, l); buf = ""; i += 2; code(1); l = line; continue; }
      if (c === "\n") line++;
      buf += c; i++;
    }
    push(buf, l);
  }
  function str(q) { let buf = "", l = line; while (i < n && src[i] !== q) { if (src[i] === "\\") { buf += src.slice(i, i + 2); i += 2; continue; } if (src[i] === "\n") { line++; break; } buf += src[i++]; } i++; push(buf, l); }
  function code(depth) { // until the matching } when depth>0
    let prev = "";
    while (i < n) {
      const c = src[i];
      if (c === "\n") { line++; i++; continue; }
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const seg = src.slice(i, e < 0 ? n : e + 2); line += (seg.match(/\n/g) ?? []).length; i = e < 0 ? n : e + 2; continue; }
      if (c === "'" || c === '"') { i++; str(c); prev = "x"; continue; }
      if (c === "`") { i++; tmpl(); prev = "x"; continue; }
      if (c === "/" && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prev)) { // a regex literal: skip it
        i++; let cls = false; while (i < n) { const d = src[i]; if (d === "\\") { i += 2; continue; } if (d === "[") cls = true; else if (d === "]") cls = false; else if (d === "/" && !cls) { i++; break; } else if (d === "\n") break; i++; } while (/[a-z]/.test(src[i] ?? "")) i++; prev = "x"; continue; }
      if (c === "{" && depth) depth++;
      if (c === "}" && depth) { depth--; if (!depth) { i++; return; } }
      if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? (/\w/.test(prev) ? prev + c : c).slice(-6) : c;
      i++;
    }
  }
  code(0);
  return out;
}
