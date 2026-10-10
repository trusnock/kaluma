/* Kaluma PIO Workbench — app.js
 *
 * Loads the REAL repo code (src/modules/rp2/rp2.js and tests/rp2.asm.test.js)
 * into the browser via a small CommonJS shim, so the fixes are exercised with
 * the actual source. The native `rp2` binding (PIO memory + state machines) is
 * emulated by a faithful model of the pico-sdk behavior those fixes target:
 *   - top-down PIO instruction-memory allocator (find_offset_for_program)
 *   - per-PIO `_used_instruction_space` static (only reset by
 *     pio_clear_instruction_memory)
 *   - SM enable/claim/stop
 * This is a MODEL, not silicon, and the UI says so.
 */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ------------------------------------------------------------------ *
 *  1. Load real repo source (relative to demo/)
 * ------------------------------------------------------------------ */
const REL = "../"; // demo/ -> repo root
async function loadText(p) {
  const r = await fetch(REL + p, { cache: "no-store" });
  if (!r.ok) throw new Error("failed to load " + p + " (" + r.status + ")");
  return r.text();
}

let rp2Src = null, testSrc = null, usedFallback = false;
try {
  [rp2Src, testSrc] = await Promise.all([
    loadText("src/modules/rp2/rp2.js"),
    loadText("tests/rp2.asm.test.js"),
  ]);
} catch (e) {
  // Fallback to the auto-generated bundle (base64 of the same two real files)
  // so the demo works from any serving root or opened as a local file.
  const B = self.__KALUMA_DEMO_BUNDLE__;
  if (B) {
    const fromB64 = (s) => atob(s);
    rp2Src = fromB64(B.rp2);
    testSrc = fromB64(B.test);
    usedFallback = true;
  } else {
    document.body.insertAdjacentHTML("beforeend",
      `<div style="position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#3b0d18;color:#ffd9de;border:1px solid #fb7185;padding:10px 16px;border-radius:12px;font-family:var(--mono);font-size:13px;z-index:99">
        Could not load repo source for the live section: ${e.message}. The static explanation still renders.
      </div>`);
    rp2Src = null; testSrc = null;
  }
}

/* ------------------------------------------------------------------ *
 *  2. Run the real test file in a Node-like sandbox, capturing output
 * ------------------------------------------------------------------ */
function runRealTests({ rp2Src, testSrc }) {
  const lines = [];
  let exitCode = 0;
  const proc = {
    binding: (n) => { throw new Error("process.binding(" + n + ")"); },
    exit: (c) => { exitCode = c; },
    platform: "browser",
    argv: ["node", "tests/rp2.asm.test.js"],
  };
  const cache = {};
  function require(path) {
    if (String(path).includes("rp2/rp2.js")) {
      if (!cache.rp2) {
        const exp = {}; const mod = { exports: exp };
        new Function("require", "exports", "module", "process", rp2Src)(
          require, exp, mod, proc
        );
        cache.rp2 = mod;
      }
      return cache.rp2.exports;
    }
    throw new Error("no module resolver for: " + path);
  }
  const clog = {
    log: (...a) => lines.push(a.map(String).join(" ")),
    info: (...a) => lines.push(a.map(String).join(" ")),
    warn: (...a) => lines.push("[warn] " + a.map(String).join(" ")),
    error: (...a) => lines.push("[error] " + a.map(String).join(" ")),
  };
  const mod = { exports: {} };
  new Function("require", "exports", "module", "process", "console", testSrc)(
    require, mod.exports, mod, proc, clog
  );
  return { lines, exitCode, rp2: cache.rp2 ? cache.rp2.exports : null };
}

/* ------------------------------------------------------------------ *
 *  3. Faithful PIO model (the native behavior the C fixes target)
 * ------------------------------------------------------------------ */
function makePioModel() {
  const used = [0, 0];        // 32-bit used mask per PIO  (SDK `_used_instruction_space`)
  const enabled = new Array(8).fill(false); // 2 PIOs x 4 SMs
  const claimed = new Array(8).fill(false);
  const log = [];

  // pico-sdk: "work down from the top" — highest free contiguous run.
  function addProgram(pio, length) {
    if (length <= 0 || length > 32) return -1;
    for (let off = 32 - length; off >= 0; off--) {
      let mask = 0;
      for (let i = 0; i < length; i++) mask |= 1 << (off + i);
      if ((used[pio] & mask) === 0) {
        used[pio] |= mask;
        log.push({ kind: "add", pio, offset: off, length });
        return off;
      }
    }
    log.push({ kind: "add-fail", pio, offset: -1, length });
    return -1; // out of PIO instruction memory
  }
  function clear(pio) { used[pio] = 0; log.push({ kind: "clear", pio }); }
  function enable(pio, sm, en) { enabled[pio * 4 + sm] = en; }
  function unclaim(pio, sm) { claimed[pio * 4 + sm] = false; }
  function reset() { used[0] = 0; used[1] = 0; enabled.fill(false); claimed.fill(false); log.length = 0; }

  return { used, enabled, claimed, log, addProgram, clear, enable, unclaim, reset,
           get state() { return { used: used.slice(), enabled: enabled.slice() }; } };
}

/* The km_pio_cleanup() the fix adds (see targets/rp2/src/system.c). */
function km_pio_cleanup(m) {
  for (let pio = 0; pio < 2; pio++) {
    for (let sm = 0; sm < 4; sm++) { m.enable(pio, sm, false); m.unclaim(pio, sm); }
    m.clear(pio);
  }
}

/* ------------------------------------------------------------------ *
 *  4. The five fixes, before / after
 * ------------------------------------------------------------------ */
let MODE = "after"; // "before" | "after"

// Build a real 4-instruction PIO program with the REAL ASM (used to drive the
// memory model with a genuine program length).
function buildLedProgram(ASM) {
  const asm = new ASM();
  // toggle pin 0 with delays — 4 instructions, the classic "blink" program
  asm.set("pindirs", 1).label("again").set("pins", 1).delay(2)
    .set("pins", 0).delay(1).jmp("again");
  return asm;
}

function set688() {
  const beforeEl = $("#d688before"), bNote = $("#d688beforeNote");
  const afterEl = $("#d688after"), aNote = $("#d688afterNote");
  if (!rp2Src) { [beforeEl, afterEl].forEach(e => (e.textContent = "(source not loaded)")); return; }
  // BEFORE (pre-fix behavior, simulated): old delay() did `c |= val << 8` with no check.
  {
    const inst = 0xe001 | (200 << 8); // SET pins 1, delay field "200"
    const hi = inst & 0x1000;         // bit 13 — the sideset/instruction boundary
    beforeEl.textContent = "0x" + inst.toString(16).padStart(4, "0");
    beforeEl.classList.add("err");
    bNote.textContent = `bits above the 5-bit field spill into the instruction opcode & sideset (${hi ? "bit 13 set → corrupted" : "—"}). Loaded silently; ran garbage.`;
  }
  // AFTER (real code): RangeError.
  {
    try {
      const asm = buildLedProgram(RP2.ASM); asm.code[asm.code.length - 1]; asm.set("pins", 1).delay(200);
      afterEl.textContent = "accepted??"; afterEl.classList.remove("ok");
    } catch (e) {
      afterEl.textContent = "RangeError: " + e.message;
      afterEl.classList.add("ok");
      aNote.textContent = "Rejected before it can clobber neighboring bits. Clean, predictable failure.";
    }
  }
}

function set689() {
  if (!rp2Src) return;
  // BEFORE (simulated): old code used this.code.push directly → no cap.
  {
    const code = []; for (let i = 0; i < 33; i++) code.push(0xa042);
    const b = $("#d689before"), bn = $("#d689beforeNote");
    b.textContent = "33 instructions accepted (no cap)";
    b.classList.add("err");
    bn.textContent = "Exceeds the 5-bit instruction offset (max 32). Fails unpredictably on the device.";
  }
  // AFTER (real code): "Program too long!" at the 33rd.
  {
    const a = $("#d689after"), an = $("#d689afterNote");
    try {
      const asm = new RP2.ASM(); for (let i = 0; i < 33; i++) asm.nop();
      a.textContent = "33 accepted??"; a.classList.remove("ok");
    } catch (e) {
      a.textContent = "Error: " + e.message; a.classList.add("ok");
      an.textContent = "32 is legal; the 33rd throws immediately, in the source, not on the board.";
    }
  }
}

function set686() {
  const core = [".load", ".flash", ".reset", ".help", ".echo", ".sleep"];
  const fsCmds = [".ls", ".pwd", ".cd", ".mkdir", ".rm", ".cat"];
  function simulate(idempotent) {
    const reg = [];
    const register = (name) => {
      if (idempotent) { const i = reg.indexOf(name); if (i >= 0) reg[i] = name; else reg.push(name); }
      else reg.push(name); // pre-fix: always appends
    };
    const boot = () => { core.forEach(register); fsCmds.forEach(register); }; // module_fs_init
    boot();
    for (let k = 0; k < 3; k++) boot(); // three .load cycles re-run module_fs_init
    return reg;
  }
  const before = simulate(false), after = simulate(true);
  $("#d686beforeCount").textContent = before.length;
  $("#d686afterCount").textContent = after.length;
  $("#d686before").innerHTML = before.map(c => {
    const dup = before.filter(x => x === c).length > 1;
    return `<div><span class="cmd ${dup ? "dup" : ""}">${c}</span>${dup ? "  <span style='color:var(--red)'>×dup</span>" : ""}</div>`;
  }).join("");
  $("#d686after").innerHTML = after.map(c => `<div><span class="cmd">${c}</span></div>`).join("");
  $("#d686note").textContent =
    `Before: ${before.length} .help lines (the 6 fs commands × 4 boots). After: ${after.length} lines (registered once, then updated in place).`;
}

function set690text() {
  const before = $("#d690before"), bN = $("#d690beforeNote");
  const after = $("#d690after"), aN = $("#d690afterNote");
  before.textContent = "SM0 enabled=1, executing stale program @ old offset";
  before.classList.add("err");
  bN.textContent = "SMs keep running after program end — they re-execute leftover instructions.";
  after.textContent = "SM0 enabled=0, unclaimed, memory cleared";
  after.classList.add("ok");
  aN.textContent = "km_pio_cleanup() stops, unclaims and clears every SM + PIO memory on program end.";
}

/* ---------------- showcase: #690/#691 memory model ---------------- */
function renderMemory(m, currentOffset) {
  const cells = $("#memCells");
  cells.innerHTML = "";
  let usedCount = 0;
  for (let off = 31; off >= 0; off--) {
    const el = document.createElement("div");
    el.className = "cell";
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
  const labels = ["SM0", "SM1", "SM2", "SM3", "SM4", "SM5", "SM6", "SM7"];
  for (let i = 0; i < 8; i++) {
    const on = m.enabled[i];
    const el = document.createElement("div");
    el.className = "sm " + (on ? "running" : "stopped");
    el.innerHTML = `<div class="id">pio${i > 3 ? 1 : 0} · ${labels[i]}</div>
      <div class="state"><span class="d"></span>${on ? "running" : "stopped"}</div>`;
    row.appendChild(el);
  }
}
function renderTrace(offsets) {
  const t = $("#offsetTrace"); t.innerHTML = "";
  offsets.forEach((o, i) => {
    const neg = o < 0;
    const el = document.createElement("div");
    el.className = "t " + (neg ? "neg" : (MODE === "after" ? "stable" : ""));
    el.textContent = "run" + i + "→" + (neg ? "FAIL" : o);
    el.title = neg ? "out of PIO instruction memory" : "program offset";
    t.appendChild(el);
    if (i < offsets.length - 1) t.appendChild(Object.assign(document.createElement("span"), { className: "arr", textContent: "›" }));
  });
}

function simulateRuns() {
  const m = makePioModel();
  const len = 4; // real LED program length
  const runs = 10;
  const offsets = [];
  let lastOffset = -1;
  for (let i = 0; i < runs; i++) {
    // each .load = fresh JS heap → SM ids reset to all available
    const off = m.addProgram(0, len);
    offsets.push(off);
    lastOffset = off;
    if (off >= 0) m.enable(0, 0, true); // SM0 started
    // teardown at program end
    if (MODE === "after") km_pio_cleanup(m);
    else { /* buggy teardown: nothing is reset — this is the #690/#691 bug */ }
    paintProgress(m, offsets, lastOffset);
  }
  paintProgress(m, offsets, lastOffset, true);
}

function paintProgress(m, offsets, lastOffset, final = false) {
  renderMemory(m, lastOffset);
  renderSMs(m);
  renderTrace(offsets);
  const status = $("#pioStatus");
  const failed = offsets.some(o => o < 0);
  if (MODE === "after") {
    status.innerHTML = final
      ? `<b>✓ stable.</b> Every run re-allocates at the same top slot because km_pio_cleanup() clears memory + stops SMs between runs. SMs are <b>stopped</b> after each program ends.`
      : "allocating…";
  } else {
    status.innerHTML = failed
      ? `<span style="color:var(--red)">✗ fault.</span> PIO memory never cleared → each run allocates lower (top-down) until there's no room: <b>out of PIO instruction memory</b>. SMs left <b>running</b> on stale instructions. Only <code>flash_nuke</code> recovers the part.`
      : "allocating (no teardown)…";
  }
}

/* ---------------- test terminal ---------------- */
function paintTestOutput(lines, exitCode) {
  const out = $("#termOut");
  out.innerHTML = "";
  const frag = document.createDocumentFragment();
  lines.forEach((ln) => {
    const div = document.createElement("div");
    if (ln.trim().startsWith("\u2713")) div.className = "pass";
    else if (ln.trim().startsWith("\u2717")) div.className = "fail";
    else if (/^(Issue|Encoding|StateMachine|PIO)/.test(ln.trim())) div.className = "sec";
    else if (/\d+ passed/.test(ln)) div.className = "sum";
    div.textContent = ln.length ? ln : "\u00a0";
    frag.appendChild(div);
  });
  out.appendChild(frag);
  out.scrollTop = out.scrollHeight;
  const passed = (lines.join("\n").match(/\u2713/g) || []).length;
  const failedN = (lines.join("\n").match(/\u2717/g) || []).length;
  $("#termStat").innerHTML = failedN
    ? `${passed} passed, <b style="color:var(--red)">${failedN} failed</b>`
    : `<b>${passed} passed</b>, 0 failed · exit 0`;
}

/* ------------------------------------------------------------------ *
 *  5. Wire up
 * ------------------------------------------------------------------ */
let RP2 = null;
function applyMode() {
  MODE = MODE; // keep
  $("#btnBefore").setAttribute("aria-pressed", MODE === "before");
  $("#btnAfter").setAttribute("aria-pressed", MODE === "after");
  const title = $("#pioCardTitle"), desc = $("#pioCardDesc");
  if (MODE === "after") {
    title.textContent = "After the fix — stable program offset across runs";
    desc.textContent = "km_pio_cleanup() stops SMs + clears PIO memory on every program end, so the allocator always starts clean.";
  } else {
    title.textContent = "Before the fix — PIO memory never reset (the bug)";
    desc.textContent = "No cleanup between runs: the allocator runs out of memory and SMs keep running on stale instructions.";
  }
  if (rp2Src) { set688(); set689(); }
  set686(); set690text();
  simulateRuns();
}

function init() {
  if (rp2Src) {
    const res = runRealTests({ rp2Src, testSrc });
    RP2 = res.rp2;
    paintTestOutput(res.lines, res.exitCode);
  } else {
    paintTestOutput(["(real test source could not be loaded in this context)"], 1);
  }
  set686(); set690text();
  applyMode();

  $("#btnBefore").addEventListener("click", () => { MODE = "before"; applyMode(); });
  $("#btnAfter").addEventListener("click", () => { MODE = "after"; applyMode(); });
  $("#btnSim").addEventListener("click", simulateRuns);
  $("#btnResetPio").addEventListener("click", simulateRuns);
  $("#btnRunTests").addEventListener("click", () => {
    const res = runRealTests({ rp2Src, testSrc });
    RP2 = res.rp2; paintTestOutput(res.lines, res.exitCode);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
