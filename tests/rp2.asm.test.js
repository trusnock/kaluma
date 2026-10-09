// Unit tests for the rp2 ASM / StateMachine JavaScript layer (issues #688, #689, #691).
//
// Runs under plain Node by stubbing the native `rp2` binding. Only the pure-JS
// encoding/limits logic is exercised here; the hardware (state machines, PIO
// memory) is emulated closely enough to detect the #691 offset-drift bug class.
//
//   node tests/rp2.asm.test.js

"use strict";

// --- Stub the native binding before rp2.js is loaded -------------------------
// rp2.js does:  const rp2_native = process.binding(process.binding.rp2);
// So process.binding must be a function AND expose a `.rp2` name property.

// Minimal emulation of the pico-sdk PIO instruction-memory allocator:
// - per-PIO `used` bitmask (like the SDK's static `_used_instruction_space`)
// - pio_add_program packs programs at the first free contiguous slot (bit 0 up)
// - pio_clear_instruction_memory resets the used mask to 0 (bit 0)
function makeNativeStub() {
  const state = {
    pioUsed: [0, 0], // 32-bit used mask per PIO instance
  };
  const log = { addProgram: 0, clear: 0, smInit: 0, enabled: [] };

  function findOffset(pio, length) {
    // Mirror the real SDK: "work down from the top" (32 - length -> 0)
    if (length <= 0 || length > 32) return -1;
    let mask = 0;
    for (let i = 0; i < length; i++) mask |= 1 << i;
    for (let off = 32 - length; off >= 0; off--) {
      if ((state.pioUsed[pio] & (mask << off)) === 0) return off;
    }
    return -1;
  }

  return {
    __state: state,
    __log: log,
    pio_add_program(pio, bin) {
      log.addProgram++;
      const length = bin.length;
      const off = findOffset(pio, length);
      if (off < 0) return -1;
      let mask = 0;
      for (let i = 0; i < length; i++) mask |= 1 << (off + i);
      state.pioUsed[pio] |= mask;
      return off;
    },
    pio_clear_instruction_memory(pio) {
      log.clear++;
      state.pioUsed[pio] = 0;
    },
    pio_sm_init(pio, sm, options) {
      log.smInit++;
      this.__lastSmOffset = options.offset;
    },
    pio_sm_set_enabled(pio, sm, en) {
      log.enabled.push({ pio, sm, en });
    },
    pio_sm_restart() {},
    pio_sm_exec() {},
    pio_sm_put() {},
    pio_sm_get() {
      return 0;
    },
    pio_sm_set_pins() {},
    pio_sm_rxfifo() {
      return 0;
    },
    pio_sm_txfifo() {
      return 0;
    },
    pio_sm_clear_fifos() {},
    pio_sm_drain_txfifo() {},
    pio_sm_irq() {},
    dormant() {},
    randomBigInt() {
      return 1n;
    },
  };
}

const nativeStub = makeNativeStub();
const realBinding = process.binding;
process.binding = function (name) {
  if (name === "rp2") return nativeStub;
  return realBinding(name);
};
process.binding.rp2 = "rp2";

const { ASM, StateMachine, PIO } = require("../src/modules/rp2/rp2.js");

// --- tiny test runner --------------------------------------------------------
let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.log(`  \u2717 ${name}${extra ? " — " + extra : ""}`);
  }
}
function throws(name, fn, match) {
  try {
    fn();
    failed++;
    console.log(`  \u2717 ${name} (did NOT throw)`);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const good = !match || msg.includes(match);
    if (good) {
      passed++;
      console.log(`  \u2713 ${name} (threw: ${msg})`);
    } else {
      failed++;
      console.log(`  \u2717 ${name} (threw wrong: ${msg}, wanted /${match}/)`);
    }
  }
}
function section(t) {
  console.log(`\n${t}`);
}

// --- #689: program size limit ------------------------------------------------
section("Issue #689 — program size limit");
{
  const asm = new ASM();
  let threw = false;
  try {
    // build a program of 33 instructions -> must be rejected
    for (let i = 0; i < 33; i++) asm.nop();
  } catch (e) {
    threw = true;
  }
  ok("rejects a 33-instruction program", threw);
}
{
  const asm = new ASM();
  // exactly 32 instructions is legal
  for (let i = 0; i < 32; i++) asm.nop();
  ok("accepts exactly 32 instructions", asm.code.length === 32);
  ok("toBinary() length === 32", asm.toBinary().length === 32);
}
{
  // the error message from the issue is preserved
  const asm = new ASM();
  let msg = "";
  try {
    for (let i = 0; i < 40; i++) asm.nop();
  } catch (e) {
    msg = e.message;
  }
  ok("throws 'Program too long!'", msg === "Program too long!", msg);
}
{
  // limit is enforced even when using real instructions
  const asm = new ASM();
  let threw = false;
  try {
    for (let i = 0; i < 33; i++) asm.set("pins", 0);
  } catch (e) {
    threw = true;
  }
  ok("rejects 33 set() instructions", threw);
}

// --- #688: delay bounds ------------------------------------------------------
section("Issue #688 — delay() bounds checking");
{
  const asm = new ASM();
  asm.set("pins", 1).delay(0);
  ok("delay(0) accepted", (asm.code[0] & 0x1f00) === 0);
}
{
  const asm = new ASM();
  asm.set("pins", 1).delay(31);
  // 31 << 8 = 0x1F00, all within delay field
  ok("delay(31) accepted, fits in 5-bit field", (asm.code[0] & 0x1f00) === 0x1f00);
}
{
  const asm = new ASM();
  throws(
    "delay(32) throws (was corrupting instruction/sideset bits)",
    () => asm.set("pins", 1).delay(32),
    "range"
  );
}
{
  const asm = new ASM();
  throws("delay(-1) throws", () => asm.set("pins", 1).delay(-1), "range");
}
{
  const asm = new ASM();
  throws("delay(100) throws", () => asm.set("pins", 1).delay(100), "range");
}
{
  const asm = new ASM();
  throws("delay('2') throws (non-integer)", () => asm.set("pins", 1).delay("2"), "range");
}
{
  const asm = new ASM();
  throws("delay(NaN) throws", () => asm.set("pins", 1).delay(NaN), "range");
}

// --- encoding correctness (regression guard) --------------------------------
section("Encoding regression (instruction + label + delay)");
{
  const asm = new ASM();
  asm.set("pindirs", 1)
    .label("again")
    .set("pins", 1)
    .delay(2)
    .set("pins", 0)
    .delay(1)
    .jmp("again");
  const bin = asm.toBinary();
  ok("4 instructions produced", bin.length === 4, "got " + bin.length);
  // SET pindirs 1 == 0xe000 | (4<<5) | 1 = 0xe081  (dest pindirs = 4, so bit 7)
  ok("SET pindirs 1 == 0xe081", bin[0] === 0xe081, "0x" + bin[0].toString(16));
  // SET pins 1 + delay(2): 0xe000 | 1 | (2<<8) = 0xe201
  ok("SET pins 1 + delay(2) == 0xe201", bin[1] === 0xe201, "0x" + bin[1].toString(16));
  // SET pins 0 + delay(1): 0xe000 | 0 | (1<<8) = 0xe100
  ok("SET pins 0 + delay(1) == 0xe100", bin[2] === 0xe100, "0x" + bin[2].toString(16));
  // JMP 'again' target = 1
  ok("JMP target resolved to 1", (bin[3] & 0x1f) === 1, "0x" + bin[3].toString(16));
}

// --- #691: StateMachine offset stability across program runs -----------------
section("Issue #691 — StateMachine offset stable across program runs");
{
  nativeStub.__log.addProgram = 0;
  nativeStub.__log.clear = 0;
  nativeStub.__log.smInit = 0;
  nativeStub.__state.pioUsed = [0, 0];

  function newSm() {
    const asm = new ASM();
    asm.set("pindirs", 1)
      .label("again")
      .set("pins", 1)
      .delay(2)
      .set("pins", 0)
      .delay(1)
      .jmp("again");
    const options = { freq: 5000000, setBase: 0 };
    return new StateMachine(StateMachine.getAvailableId(), asm, options);
  }

  const first = newSm();
  ok("first program offset === 28 (SDK allocates top-down)", first.offset === 28, "got " + first.offset);
  ok("first program length === 4", first.length === 4, "got " + first.length);

  // Emulate what a clean teardown (km_system_cleanup) MUST do: clear PIO memory
  // (which in the SDK also resets the static `_used_instruction_space` counter).
  // The #691 fix adds km_pio_cleanup() that calls pio_clear_instruction_memory
  // for both PIOs on every program end / .load / .reset.
  nativeStub.pio_clear_instruction_memory(0);
  nativeStub.pio_clear_instruction_memory(1);

  // A fresh JS heap would also drop the static ids list; reset it to model
  // process restart between .load runs.
  StateMachine.ids = [0, 4, 1, 5, 2, 6, 3, 7];
  const second = newSm();
  ok("second program offset === 28 again (no drift)", second.offset === 28, "got " + second.offset);
  ok("second program length === 4", second.length === 4, "got " + second.length);
}
{
  // Reproduce the #691 bug: across .load runs the SDK's C-static
  // `_used_instruction_space` (a per-PIO counter) is never reset, and each run
  // is a fresh JS heap that re-adds the same program to pio 0.
  // The real SDK allocates downward from the top, so the offset drifts by the
  // program length each run and eventually goes negative (the reporter's log).
  nativeStub.__state.pioUsed = [0, 0];
  const offsets = [];
  // 3-instruction program (delay() modifies, it does not add an instruction);
  // 11 runs push the offset below zero
  for (let run = 0; run < 11; run++) {
    // fresh JS heap each run: static ids list is reset
    StateMachine.ids = [0, 4, 1, 5, 2, 6, 3, 7];
    const asm = new ASM();
    asm.set("pindirs", 1).label("x").set("pins", 1).delay(2).jmp("x"); // 3 ins
    const s = new StateMachine(StateMachine.getAvailableId(), asm, {});
    offsets.push(s.offset);
    // NOTE: no km_pio_cleanup() here -> models the buggy teardown
  }
  ok(
    "without cleanup, offset drifts run-to-run (harness reproduces the bug)",
    offsets[0] === 29 && offsets[1] === 26 && offsets[2] === 23,
    `offsets = ${offsets.join(", ")} (expected 29, 26, 23, ...)`
  );
  ok(
    "drift reaches negative (the corruption the reporter hit)",
    offsets[offsets.length - 1] < 0,
    `final = ${offsets[offsets.length - 1]}`
  );
}

// --- StateMachine id allocation (regression) --------------------------------
section("StateMachine id allocation");
{
  StateMachine.ids = [0, 4, 1, 5, 2, 6, 3, 7];
  const asm = new ASM();
  asm.nop();
  const s = new StateMachine(4, asm, {});
  ok("SM 4 -> pio 1, sm 0", s.pio === 1 && s.sm === 0, `pio=${s.pio} sm=${s.sm}`);
}
{
  StateMachine.ids = [0, 4, 1, 5, 2, 6, 3, 7];
  const asm = new ASM();
  asm.nop();
  const s = new StateMachine(1, asm, {});
  ok("SM 1 -> pio 0, sm 1", s.pio === 0 && s.sm === 1, `pio=${s.pio} sm=${s.sm}`);
}

// --- summary -----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
