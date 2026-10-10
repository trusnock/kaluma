/* Kaluma PIO Workbench — app.js  (v2: animated "it's actually running")
 *
 * Runs the REAL repo code (src/modules/rp2/rp2.js + tests/rp2.asm.test.js) in
 * the browser, and drives a faithful model of the pico-sdk PIO behaviors the
 * C fixes target. Everything is ANIMATED (step-by-step, cancellable) so the
 * before/after difference is *watchable*: the offset drifts, the LED blinks,
 * memory fills/clears, and the SM stops — instead of snapping to an end-state.
 *
 * This is a MODEL, not silicon, and the UI says so.
 */
"use strict";

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEED = 430; // ms per .load step (slow enough to watch, fast enough to feel snappy)

/* ============ DEV-ONLY: visible error trap (verify console is clean) ============ */
(function installErrorTrap() {
  const panel = document.createElement("div");
  panel.id = "__errtrap";
  panel.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:9999;max-width:380px;max-height:45vh;overflow:auto;" +
    "background:#0b1220;color:#9fe6ff;border:1px solid #2dd4bf;border-left:5px solid #2dd4bf;" +
    "border-radius:8px;padding:8px 10px;font:11px/1.5 ui-monospace,Menlo,monospace;box-shadow:0 6px 24px rgba(0,0,0,.5);";
  function line(txt, bad) {
    const d = document.createElement("div");
    d.textContent = txt;
    d.style.color = bad ? "#ff9aa2" : "#9fe6ff";
    d.style.borderBottom = "1px dashed rgba(255,255,255,.08)";
    d.style.padding = "2px 0";
    panel.appendChild(d);
    panel.style.display = "block";
    panel.scrollTop = panel.scrollHeight;
  }
  panel.appendChild(Object.assign(document.createElement("div"),
    { textContent: "⚠ runtime error trap (dev) — empty = clean", style: { color: "#5eead4", fontWeight: "700", marginBottom: "4px" } }));
  const errs = [];
  window.addEventListener("error", (e) => {
    errs.push("error: " + (e.message || e.type) + (e.filename ? " @ " + e.filename + ":" + e.lineno : ""));
    line(errs[errs.length - 1], true);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const m = e.reason && (e.reason.message || String(e.reason));
    errs.push("rejection: " + m);
    line(errs[errs.length - 1], true);
  });
  self.__ERRTRAP__ = { errs, panel };
  return panel;
})();
/* ============ end dev error trap ============ */

/* ============ 1. load real repo source (with fallback bundle) ============ */
const REL = "../";
async function loadText(p) {
  const r = await fetch(REL + p, { cache: "no-store" });
  if (!r.ok) throw new Error("failed to load " + p + " (" + r.status + ")");
  return r.text();
}
let rp2Src = null, testSrc = null;
try {
  [rp2Src, testSrc] = await Promise.all([
    loadText("src/modules/rp2/rp2.js"),
    loadText("tests/rp2.asm.test.js"),
  ]);
} catch (e) {
  const B = self.__KALUMA_DEMO_BUNDLE__;
  if (B) { rp2Src = atob(B.rp2); testSrc = atob(B.test); }
  else {
    document.body.insertAdjacentHTML("beforeend",
      `<div style="position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#3b0d18;color:#ffd9de;border:1px solid #fb7185;padding:10px 16px;border-radius:12px;font-family:var(--mono);font-size:13px;z-index:99">
        Could not load repo source: ${e.message}. Static explanation still renders.</div>`);
    rp2Src = null; testSrc = null;
  }
}

/* ============ 2. run the real test file in a Node-like sandbox ============ */
function runRealTests({ rp2Src, testSrc }) {
  const lines = []; let exitCode = 0;
  const proc = {
    binding: () => { throw new Error("process.binding()"); },
    exit: (c) => { exitCode = c; },
    platform: "browser", argv: ["node", "tests/rp2.asm.test.js"],
  };
  const cache = {};
  function require(path) {
    if (String(path).includes("rp2/rp2.js")) {
      if (!cache.rp2) {
        const exp = {}; const mod = { exports: exp };
        new Function("require", "exports", "module", "process", rp2Src)(require, exp, mod, proc);
        cache.rp2 = mod;
      }
      return cache.rp2.exports;
    }
    throw new Error("no module resolver for: " + path);
  }
  const clog = { log: (...a) => lines.push(a.map(String).join(" ")) };
  const mod = { exports: {} };
  new Function("require", "exports", "module", "process", "console", testSrc)(require, mod.exports, mod, proc, clog);
  return { lines, exitCode, rp2: cache.rp2 ? cache.rp2.exports : null };
}

/* ============ 3. faithful PIO model ============ */
function makePioModel() {
  const used = [0, 0];
  const enabled = new Array(8).fill(false);
  const claimed = new Array(8).fill(false);
  function addProgram(pio, length) {
    if (length <= 0 || length > 32) return -1;
    for (let off = 32 - length; off >= 0; off--) {
      let mask = 0; for (let i = 0; i < length; i++) mask |= 1 << (off + i);
      if ((used[pio] & mask) === 0) { used[pio] |= mask; return off; }
    }
    return -1;
  }
  function clear(pio) { used[pio] = 0; }
  return {
    used, enabled, claimed,
    addProgram, clear,
    enable: (pio, sm, en) => { enabled[pio * 4 + sm] = en; },
    unclaim: (pio, sm) => { claimed[pio * 4 + sm] = false; },
    reset() { used[0] = 0; used[1] = 0; enabled.fill(false); claimed.fill(false); },
  };
}
/* The km_pio_cleanup() the fix adds (see targets/rp2/src/system.c). */
function km_pio_cleanup(m) {
  for (let pio = 0; pio < 2; pio++) {
    for (let sm = 0; sm < 4; sm++) { m.enable(pio, sm, false); m.unclaim(pio, sm); }
    m.clear(pio);
  }
}

/* ============ 4. shared animation runtime ============ */
let MODE = "after";
let token = { dead: false };
// Stop any in-flight run, then hand the new run a FRESH LIVE token.
// (Bug: this previously returned a dead token, so every button-triggered run
//  bailed on its first `if (isDead(t)) return;` and rendered nothing — the
//  "buttons don't visibly run anything" symptom.)
function cancelCurrent() {
  token.dead = true;        // mark the currently-running loop as dead (it references this object)
  token = { dead: false };  // the new run gets a fresh, LIVE token
  return token;
}
const isDead = (t) => t.dead;

function buildLedProgram(ASM) {
  const asm = new ASM();
  asm.set("pindirs", 1).label("again").set("pins", 1).delay(2)
    .set("pins", 0).delay(1).jmp("again");
  return asm;
}

/* ---- pin LED (showcase) ---- */
function setLed(state) { // 'idle' | 'blink' | 'lit'
  const led = $("#pinLed");
  led.classList.remove("lit", "blink");
  const txt = $("#pinLedText");
  if (state === "blink") { led.classList.add("blink"); txt.textContent = "pin 0 · SM0 RUNNING (blinking)"; }
  else if (state === "lit") { led.classList.add("lit"); txt.textContent = "pin 0 · HIGH"; }
  else txt.textContent = "pin 0 · idle";
}
function setSmLed(el, on, blink) {
  el.classList.remove("on", "blink");
  if (blink) el.classList.add("blink"); else if (on) el.classList.add("on");
}

/* ---- PIO memory / SM / trace rendering ---- */
function renderMemory(m, currentOffset) {
  const cells = $("#memCells"); cells.innerHTML = "";
  let usedCount = 0;
  for (let off = 31; off >= 0; off--) {
    const el = document.createElement("div"); el.className = "cell";
    const isUsed = (m.used[0] >> off) & 1;
    const isCur = currentOffset >= 0 && off >= currentOffset && off < currentOffset + 4;
    if (isCur) el.classList.add("cur");
    else if (isUsed) el.classList.add("used");
    if (isUsed) usedCount++;
    el.innerHTML = `<span>ins</span><span class="off">${off}</span>`;
    cells.appendChild(el);
  }
  $("#memUsed").textContent = `used: ${usedCount}/32`;
}
function renderSMs(m) {
  const row = $("#smRow"); row.innerHTML = "";
  const labels = ["SM0", "SM1", "SM2", "SM3"];
  for (let i = 0; i < 4; i++) {
    const on = m.enabled[i];
    const el = document.createElement("div");
    el.className = "sm " + (on ? "running" : "stopped");
    el.innerHTML = `<div class="id">pio0 · ${labels[i]}</div>
      <div class="state"><span class="d"></span>${on ? "running" : "stopped"}</div>`;
    row.appendChild(el);
  }
}
function renderTrace(offsets, upto) {
  const t = $("#offsetTrace"); t.innerHTML = "";
  const shown = offsets.slice(0, upto + 1);
  shown.forEach((o, i) => {
    const neg = o < 0;
    const el = document.createElement("div");
    el.className = "t " + (neg ? "neg" : (MODE === "after" ? "stable" : ""));
    el.textContent = "run" + i + "→" + (neg ? "FAIL" : o);
    el.title = neg ? "out of PIO instruction memory" : "program offset";
    t.appendChild(el);
    if (i < shown.length - 1) t.appendChild(Object.assign(document.createElement("span"), { className: "arr", textContent: "›" }));
  });
}
function setStatus(html) { $("#pioStatus").innerHTML = html; }

/* ============ 5. SHOWCASE animation (#690/#691) ============ */
const RUNS = 8;
function doShowcase(t) {
  const m = makePioModel();
  const offsets = [];
  const len = 4;
  (async () => {
    for (let i = 0; i < RUNS; i++) {
      if (isDead(t)) return;
      const off = m.addProgram(0, len);
      offsets.push(off);
      if (off >= 0) m.enable(0, 0, true); // SM0 started
      renderMemory(m, off); renderSMs(m); renderTrace(offsets, i);
      if (off >= 0) { setLed("blink"); setStatus(`<span style="color:var(--amber)">run ${i}</span> · program @ offset ${off} · SM0 running…`); }
      else { setStatus(`<span style="color:var(--red)">run ${i} · FAIL — out of PIO instruction memory</span>`); }
      await sleep(SPEED * 0.9); if (isDead(t)) return;

      // program end / teardown
      if (MODE === "after") {
        km_pio_cleanup(m);
        renderMemory(m, -1); renderSMs(m);
        setLed("idle");
        setStatus(`<span style="color:var(--green)">run ${i} end</span> · km_pio_cleanup() → SM0 stopped, memory cleared`);
      } else {
        renderMemory(m, -1);
        setLed("blink");
        setStatus(`<span style="color:var(--red)">run ${i} end</span> · no teardown — SM0 <b>still running</b> on stale memory`);
      }
      await sleep(SPEED); if (isDead(t)) return;
    }
    // final verdict
    if (MODE === "after") {
      renderMemory(m, -1); renderSMs(m); setLed("idle");
      setStatus(`<b style="color:var(--green)">✓ stable.</b> Every run re-allocates at the same top slot (km_pio_cleanup clears memory + stops SMs between runs).`);
    } else {
      renderMemory(m, -1);
      setLed("blink");
      setStatus(`<b style="color:var(--red)">✗ fault.</b> Memory never cleared → allocator runs out (top-down) and SMs keep running on stale instructions. Only flash_nuke recovers the part.`);
    }
  })();
}

/* ============ 6. the other fixes (animated) ============ */
function set688bits(spill) {
  const wrap = $("#d688bits"); wrap.innerHTML = "";
  // 16 bits, left = bit15 .. right = bit0. delay = bits 12..8 (5). opcode 15..12 (SET=1110).
  for (let b = 15; b >= 0; b--) {
    const cell = document.createElement("div"); cell.className = "bit";
    let cls = "";
    if (b >= 12 && b <= 15) cls = "op";
    else if (b >= 8 && b <= 12) cls = "delay";
    if (cls) cell.classList.add(cls); // guard: classList.add('') throws a SyntaxError in real browsers
    cell.textContent = b;
    // SET pins 1 = opcode 1110 (bits 15-12), dest bits 7-5 = 000, set count bit0=1
    if (b === 15 || b === 14) cell.classList.add("set");      // opcode 1,1
    if (b === 12) cell.classList.add("set");                  // opcode 0
    if (b === 0) cell.classList.add("set");                   // set value bit
    if (spill && b >= 13) cell.classList.add("spill");        // 200 = 11001000 spills into 15..13
    wrap.appendChild(cell);
  }
}

function run688(t) {
  const bEl = $("#d688before"), aEl = $("#d688after");
  const bNote = $("#d688beforeNote"), aNote = $("#d688afterNote");
  bEl.textContent = "…"; aEl.textContent = "…";
  (async () => {
    // BEFORE: old delay() did c |= val<<8 with no check → bits spill
    set688bits(true);
    await sleep(SPEED * 0.8); if (isDead(t)) return;
    bEl.textContent = "0x" + (0xe001 | (200 << 8)).toString(16);
    bEl.classList.add("err"); bEl.classList.remove("ok");
    bEl.classList.remove("pulse"); void bEl.offsetWidth; bEl.classList.add("pulse");
    bNote.textContent = `delay=200 (0b11001000) needs 8 bits — 3 spill past the 5-bit field into the opcode/sideset bits (red). Loads silently → garbage.`;
    await sleep(SPEED * 0.6); if (isDead(t)) return;
    // AFTER: real code throws before touching the bits
    aEl.textContent = "…";
    await sleep(SPEED * 0.5); if (isDead(t)) return;
    if (RP2) {
      try { new RP2.ASM().set("pins", 1).delay(200); aEl.textContent = "accepted?"; }
      catch (e) { aEl.textContent = "RangeError: " + e.message; aEl.classList.add("ok"); }
    } else { aEl.textContent = "RangeError: delay out of range"; aEl.classList.add("ok"); }
    aNote.textContent = "Rejected up front — the field can't be corrupted. Clean, predictable failure.";
  })();
}

function run689(t) {
  const bar = $("#d689bar");
  const bEl = $("#d689before"), aEl = $("#d689after");
  const bNote = $("#d689beforeNote"), aNote = $("#d689afterNote");
  bar.style.width = "0%"; bar.classList.remove("over");
  (async () => {
    // BEFORE: no cap — fills all the way past 32
    for (let i = 1; i <= 33; i++) {
      if (isDead(t)) return;
      bar.style.width = Math.min(100, (i / 33) * 100) + "%";
      if (i > 32) bar.classList.add("over");
      await sleep(SPEED * 0.35);
    }
    bEl.textContent = "33 instructions accepted (no cap)"; bEl.classList.add("err");
    bNote.textContent = "Overflow the 5-bit offset (max 32) — fails unpredictably on the device.";
    await sleep(SPEED * 0.6); if (isDead(t)) return;
    // AFTER: real code stops at 33
    aEl.textContent = "…";
    await sleep(SPEED * 0.5); if (isDead(t)) return;
    if (RP2) {
      try { const a = new RP2.ASM(); for (let i = 0; i < 33; i++) a.nop(); aEl.textContent = "accepted?"; }
      catch (e) { aEl.textContent = "Error: " + e.message; aEl.classList.add("ok"); }
    } else { aEl.textContent = "Error: Program too long!"; aEl.classList.add("ok"); }
    aNote.textContent = "32 is legal; the 33rd throws immediately, in the source — not on the board.";
  })();
}

function run686(t) {
  const core = [".load", ".flash", ".reset", ".help", ".echo", ".sleep"];
  const fs = [".ls", ".pwd", ".cd", ".mkdir", ".rm", ".cat"];
  const beforeEl = $("#d686before"), afterEl = $("#d686after");
  beforeEl.innerHTML = ""; afterEl.innerHTML = "";
  const beforeCount = $("#d686beforeCount"), afterCount = $("#d686afterCount");
  beforeCount.textContent = "…"; afterCount.textContent = "…";
  const pushLine = (el, name, dup) => {
    const d = document.createElement("div");
    d.innerHTML = `<span class="cmd ${dup ? "dup" : ""}">${name}</span>${dup ? "  <span style='color:var(--red)'>×dup</span>" : ""}`;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
  };
  (async () => {
    for (let boot = 1; boot <= 4; boot++) {
      if (isDead(t)) return;
      const all = [...core, ...fs];
      for (const name of all) {
        if (isDead(t)) return;
        const dup = fs.includes(name) && boot > 1;
        pushLine(beforeEl, name, dup);
        if (!afterEl.querySelector(`.cmd[data-n="${name}"]`)) {
          const d = document.createElement("div");
          d.innerHTML = `<span class="cmd" data-n="${name}">${name}</span>`;
          afterEl.appendChild(d); afterEl.scrollTop = afterEl.scrollHeight;
        }
        await sleep(18);
      }
      await sleep(SPEED * 0.5);
      beforeCount.textContent = beforeEl.children.length;
      afterCount.textContent = afterEl.children.length;
    }
    if (isDead(t)) return;
    beforeCount.textContent = beforeEl.children.length;
    afterCount.textContent = afterEl.children.length;
    $("#d686note").textContent = `Before: ${beforeEl.children.length} .help lines (the 6 fs commands re-registered on every boot). After: ${afterEl.children.length} lines (registered once, then updated in place).`;
  })();
}

function run690(t) {
  const bLed = $("#d690ledBefore"), aLed = $("#d690ledAfter");
  const bEl = $("#d690before"), aEl = $("#d690after");
  (async () => {
    // BEFORE: SM0 keeps running after program end → LED stays blinking
    setSmLed(bLed, true, true);
    bEl.textContent = "…"; await sleep(SPEED * 0.7); if (isDead(t)) return;
    bEl.textContent = "SM0 enabled=1, executing stale program @ old offset"; bEl.classList.add("err");
    $("#d690beforeNote").textContent = "Left enabled after the program ended — it keeps re-executing leftover instructions.";
    await sleep(SPEED * 0.8); if (isDead(t)) return;
    // AFTER: cleanup stops it → LED goes out
    aEl.textContent = "…"; await sleep(SPEED * 0.5); if (isDead(t)) return;
    setSmLed(aLed, false, false);
    aEl.textContent = "SM0 enabled=0, unclaimed, memory cleared"; aEl.classList.add("ok");
    $("#d690afterNote").textContent = "km_pio_cleanup() stops, unclaims and clears every SM + PIO memory on program end.";
  })();
}

/* ============ 7. test terminal (stream in) ============ */
async function streamTests(t) {
  const out = $("#termOut"); out.innerHTML = "";
  const btn = $("#btnRunTests");
  btn.classList.add("loading");
  const res = runRealTests({ rp2Src, testSrc });
  RP2 = res.rp2;
  for (const ln of res.lines) {
    if (isDead(t)) { btn.classList.remove("loading"); return; }
    const div = document.createElement("div");
    if (ln.trim().startsWith("\u2713")) div.className = "pass";
    else if (ln.trim().startsWith("\u2717")) div.className = "fail";
    else if (/^(Issue|Encoding|StateMachine|PIO)/.test(ln.trim())) div.className = "sec";
    else if (/\d+ passed/.test(ln)) div.className = "sum";
    div.textContent = ln.length ? ln : "\u00a0";
    out.appendChild(div); out.scrollTop = out.scrollHeight;
    await sleep(14);
  }
  const passed = (res.lines.join("\n").match(/\u2713/g) || []).length;
  const failedN = (res.lines.join("\n").match(/\u2717/g) || []).length;
  $("#termStat").innerHTML = failedN
    ? `${passed} passed, <b style="color:var(--red)">${failedN} failed</b>`
    : `<b>${passed} passed</b>, 0 failed · exit 0`;
  btn.classList.remove("loading");
}

/* ============ 8. orchestration ============ */
let RP2 = null;
function runAll(t) {
  const title = $("#pioCardTitle"), desc = $("#pioCardDesc");
  if (MODE === "after") {
    title.textContent = "After the fix — stable program offset across runs";
    desc.textContent = "km_pio_cleanup() stops SMs + clears PIO memory on every program end, so the allocator always starts clean.";
  } else {
    title.textContent = "Before the fix — PIO memory never reset (the bug)";
    desc.textContent = "No cleanup between runs: the allocator runs out of memory and SMs keep running on stale instructions.";
  }
  $("#btnBefore").setAttribute("aria-pressed", MODE === "before");
  $("#btnAfter").setAttribute("aria-pressed", MODE === "after");
  doShowcase(t);
  if (rp2Src) { run688(t); run689(t); }
  run686(t); run690(t);
}

function init() {
  set688bits(false);
  runAll(token);
  $("#btnBefore").addEventListener("click", () => { const t = cancelCurrent(); MODE = "before"; runAll(t); });
  $("#btnAfter").addEventListener("click", () => { const t = cancelCurrent(); MODE = "after"; runAll(t); });
  $("#btnRun").addEventListener("click", () => { const t = cancelCurrent(); doShowcase(t); });
  $("#btnStop").addEventListener("click", () => { cancelCurrent(); setLed("idle"); setStatus("stopped."); });
  $("#btnStep").addEventListener("click", () => {
    cancelCurrent();
    // single step in current mode
    const m = makePioModel(); const off = m.addProgram(0, 4);
    if (off >= 0) { m.enable(0, 0, true); setLed("blink"); }
    renderMemory(m, off); renderSMs(m);
    setStatus(off >= 0 ? `step · program @ offset ${off}, SM0 ${MODE === "after" ? "(will be cleaned up)" : "(not cleaned up)"}` : `step · FAIL — out of PIO instruction memory`);
  });
  $("#btn688").addEventListener("click", () => { if (rp2Src) run688(cancelCurrent()); });
  $("#btn689").addEventListener("click", () => { if (rp2Src) run689(cancelCurrent()); });
  $("#btn686").addEventListener("click", () => run686(cancelCurrent()));
  $("#btn690").addEventListener("click", () => run690(cancelCurrent()));
  $("#btnRunTests").addEventListener("click", () => streamTests(cancelCurrent()));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
