/* verify-demos.js — runs the REAL demo/app.js card functions (sections 3-6)
 * against the REAL rp2.js in a DOM mock, asserting each card's end-state in
 * Bug(before)/Fixed(after) modes.  Durable, browser-independent check.
 *
 *   node tools/verify-demos.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "demo/app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "demo/index.html"), "utf8");
const rp2Src = fs.readFileSync(path.join(ROOT, "src/modules/rp2/rp2.js"), "utf8");

// ---- extract sections 3-6 (the card functions) ----
const start = appSrc.indexOf("/* ============ 3. faithful PIO model");
const end = appSrc.indexOf("/* ============ 7. test terminal");
if (start < 0 || end < 0) throw new Error("section markers not found in app.js");
let code = appSrc.slice(start, end);
// RP2 is referenced by run688/run689; it's supplied as a factory parameter (see below).

// ---- DOM mock (just enough for the card functions) ----
function makeEl() {
  const classes = new Set();
  const el = {
    _innerHTML: "", _text: "", _parent: null, children: [],
    style: {}, dataset: {}, title: "", scrollTop: 0, scrollHeight: 0,
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; this.children = []; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
    },
    appendChild(c) { this.children.push(c); c._parent = this; return c; },
    querySelector(sel) {
      const m = String(sel).match(/data-n="([^"]+)"/);
      if (m) return this.children.find((c) => (c._innerHTML || "").includes(`data-n="${m[1]}"`)) || null;
      return null;
    },
    setAttribute: () => {},
  };
  return el;
}
const elCache = {};
const query = (sel) => { if (!elCache[sel]) elCache[sel] = makeEl(); return elCache[sel]; };
const documentMock = {
  querySelector: query,
  createElement: (tag) => makeEl(),
  addEventListener: () => {},
  readyState: "complete",
  body: makeEl(), head: makeEl(), documentElement: makeEl(),
  getElementById: (id) => query("#" + id),
};

// ---- load the real rp2.js with a faithful native stub ----
function loadRealRp2() {
  const used = [0, 0];
  const findOffset = (pio, len) => {
    if (len <= 0 || len > 32) return -1;
    let mask = 0; for (let i = 0; i < len; i++) mask |= 1 << i;
    for (let off = 32 - len; off >= 0; off--) if ((used[pio] & (mask << off)) === 0) return off;
    return -1;
  };
  const stub = {
    pio_add_program(pio, bin) {
      const off = findOffset(pio, bin.length);
      if (off < 0) return -1;
      let mask = 0; for (let i = 0; i < bin.length; i++) mask |= 1 << (off + i);
      used[pio] |= mask; return off;
    },
    pio_clear_instruction_memory(pio) { used[pio] = 0; },
    pio_sm_init() {}, pio_sm_set_enabled() {}, pio_sm_restart() {}, pio_sm_exec() {},
    pio_sm_put() {}, pio_sm_get() { return 0; }, pio_sm_set_pins() {},
    pio_sm_rxfifo() { return 0; }, pio_sm_txfifo() { return 0; },
    pio_sm_clear_fifos() {}, pio_sm_drain_txfifo() {}, pio_sm_irq() {},
    dormant() {}, randomBigInt() { return 1n; },
  };
  const proc = { binding: (n) => (n === "rp2" ? stub : (() => { throw new Error("no binding " + n); })()), platform: "node" };
  proc.binding.rp2 = "rp2";
  const mod = { exports: {} };
  new Function("require", "exports", "module", "process", rp2Src)(
    () => { throw new Error("no require"); }, mod.exports, mod, proc
  );
  return mod.exports;
}

// ---- run the extracted card functions, controlling $/sleep/RP2/MODE ----
const fastSleep = () => new Promise((r) => setTimeout(r, 0));
const RP2 = loadRealRp2();
const factory = new Function(
  "$", "sleep", "RP2", "document", "SPEED",
  `"use strict";\n${code}\n; return {
    RUNS, doShowcase, run688, run689, run686, run690, set688bits,
    makePioModel, km_pio_cleanup, cancelCurrent, isDead,
    getMODE: () => MODE, setMODE: (m) => { MODE = m; } };`
);
const S = factory((sel) => query(sel), fastSleep, RP2, documentMock, 430);
S.setMODE("after");

// ---- test helpers ----
let pass = 0, fail = 0;
const lines = [];
const section = (t) => lines.push("\n" + t);
const ok = (name, cond, extra) =>
  cond ? (pass++, lines.push("  \u2713 " + name)) : (fail++, lines.push("  \u2717 " + name + (extra ? " \u2014 " + extra : "")));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  section("Ground truth: real rp2.js");
  let dErr = null; try { new RP2.ASM().set("pins", 1).delay(200); } catch (e) { dErr = e; }
  ok("real delay(200) throws RangeError", dErr instanceof RangeError, dErr && dErr.message);
  ok("real delay(200) says range 0-31 (got 200)", dErr && dErr.message.includes("range 0-31 (got 200)"), dErr && dErr.message);
  let pErr = null; try { const a = new RP2.ASM(); for (let i = 0; i < 33; i++) a.nop(); } catch (e) { pErr = e; }
  ok("real 33rd nop throws 'Program too long!'", pErr && pErr.message === "Program too long!", pErr && pErr.message);

  section("#688 delay() bounds");
  S.setMODE("after"); S.run688({ dead: false }); await wait(120);
  const b688 = query("#d688before").textContent, a688 = query("#d688after").textContent;
  ok("before: corruption hex 0xe801", /e801/i.test(b688), b688);
  ok("fixed: REAL 'range 0-31 (got 200)'", a688.includes("range 0-31 (got 200)"), a688);

  section("#689 program size limit");
  S.run689({ dead: false }); await wait(220);
  const b689 = query("#d689before").textContent, a689 = query("#d689after").textContent;
  ok("before: '33 accepted'", /33/.test(b689) && /accept/i.test(b689), b689);
  ok("fixed: real 'Program too long!'", a689.includes("Program too long!"), a689);
  ok("bar flagged over-limit", query("#d689bar").classList.contains("over"));

  section("#686 .help duplication");
  S.run686({ dead: false }); await wait(600);
  const bc = query("#d686before").children.length, ac = query("#d686after").children.length;
  ok("before: 48 lines (dup across 4 boots)", bc === 48, "got " + bc);
  ok("fixed: 12 lines (registered once)", ac === 12, "got " + ac);

  section("#690 SMs keep running");
  S.run690({ dead: false }); await wait(220);
  const b690 = query("#d690before").textContent, a690 = query("#d690after").textContent;
  ok("before: 'SM0 enabled=1'", /enabled=1/.test(b690), b690);
  ok("fixed: 'SM0 enabled=0'", /enabled=0/.test(a690), a690);

  section("Showcase #690/#691 (headline fix)");
  ok("RUNS=9 (9th program genuinely fails)", S.RUNS === 9, "got " + S.RUNS);
  const am = S.makePioModel(); const after = [];
  for (let i = 0; i < S.RUNS; i++) { after.push(am.addProgram(0, 4)); S.km_pio_cleanup(am); }
  ok("after: all 9 runs at offset 28 (stable)", after.every((o) => o === 28), after.join(","));
  const bm = S.makePioModel(); const before = [];
  for (let i = 0; i < S.RUNS; i++) before.push(bm.addProgram(0, 4));
  ok("before: drift 28,24,...,0,FAIL(-1)", before.join(",") === "28,24,20,16,12,8,4,0,-1", before.join(","));
  ok("before: 9th run FAILS (allocator runs out)", before[8] === -1, "got " + before[8]);
  ok("before: 32/32 memory used", (bm.used[0] >>> 0) === 0xffffffff, "used=" + (bm.used[0] >>> 0).toString(16));

  section("Consistency");
  ok("before ends in a real FAIL (verdict 'fault' is earned)", before[before.length - 1] < 0);
  ok("after never fails (verdict 'stable' is accurate)", after.every((o) => o >= 0));
  ok("HTML: hint says 4 .load cycles", /across 4 <code>\.load<\/code>/.test(html));
  ok("HTML: all 5 run buttons present", ["btn688", "btn689", "btn686", "btn690", "btnRunTests"].every((id) => html.includes(`id="${id}"`)));

  console.log(lines.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("harness error:", e); process.exit(2); });
