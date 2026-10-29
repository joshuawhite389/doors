// Small DOM helpers shared by the v2 UI.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const initials = (s) => String(s ?? "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
export const debounce = (f, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); };
};
// ?instant=1 (screenshots) and prefers-reduced-motion: no animation
export const instant = () => new URLSearchParams(location.search).has("instant") || matchMedia("(prefers-reduced-motion: reduce)").matches;
