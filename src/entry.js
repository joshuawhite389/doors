// The Worker's entry (wrangler.toml main). workerd treats every named export of the main module as an entrypoint and
// refuses to start on one that isn't a handler or a class ("Incorrect type for map entry 'AGENT_DAY'"), and
// src/worker.js exports its constants and helpers for the tests. So main is this file: the handler and nothing else.
// A Durable Object class goes here too, by name (SpendBook). scripts/workerd-boot.sh checks the Worker starts.
export { default } from "./worker.js";
export { SpendBook } from "./spend.js"; // the site's Claude $ a day (binding SPEND_BOOK, src/spend.js)
