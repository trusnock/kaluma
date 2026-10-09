This `rp2` module is for rp2040 (Raspberry Pi Pico) only.

## PIO (`ASM` / `StateMachine`)

- **Program size limit:** a PIO program is at most **32 instructions**. `ASM`
  enforces this while you chain instruction methods — building a longer program
  throws `"Program too long!"` (issue #689).
- **`delay(value)` bounds:** the delay field is 5 bits, so `value` must be an
  integer in **0–31**. Larger values used to silently overwrite the instruction
  and/or side-set bits; they now throw a `RangeError` (issue #688).
- **Side-set:** `sidesetPindirs` and `sidesetOpt` require `sideset >= 1`; the
  constructor throws if that isn't the case.
- **Program end / `.load` / `.reset`:** on every program termination Kaluma now
  stops all PIO state machines and clears the PIO instruction memory, so a
  re-run of your code (or a new `.load`) starts from a clean slate. Previously
  state machines kept running and the program offset drifted by the program
  length on each run (issues #690 and #691). Note that state machines are
  intentionally stopped on program end; if your design needs a state machine to
  outlive the script, re-activate it (`sm.active(true)`) within the same
  running program before it ends, or keep it active with a periodic task.
