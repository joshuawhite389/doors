// Dev only: EXPO_PUBLIC_DOORS_NOW (a local "YYYY-MM-DDTHH:mm") set when a simulator build is bundled starts the app's
// clock at that instant and lets it run, so time-bound states (drive's "running late", a day not yet started) can be
// checked at any hour, as the web's checks pin the page clock. Unset (every real build: scripts/build-launch.sh
// refuses it) this file does nothing. Imported first, by index.ts.
const pin = process.env.EXPO_PUBLIC_DOORS_NOW;
if (pin) {
  // the bundle's marker: the string "DOORS_PINNED_CLOCK=" is compiled into main.jsbundle only when a clock is pinned
  // (unset, this block is dead code), and scripts/build-launch.sh fails a launch build that carries it (a bare date
  // would match the demo's own dates)
  (globalThis as any).__doorsPinnedClock = `DOORS_PINNED_CLOCK=${pin}`;
  const at = new Date(pin).getTime();
  if (Number.isFinite(at)) {
    const RealDate = Date;
    const offset = at - RealDate.now();
    class PinnedDate extends RealDate {
      constructor(...args: any[]) {
        if (args.length) super(...(args as [any]));
        else super(RealDate.now() + offset);
      }
      static now() { return RealDate.now() + offset; }
    }
    (globalThis as any).Date = PinnedDate;
  }
}
export {};
