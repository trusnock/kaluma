# PIO Workbench — an interactive before/after demo of the 5 fixed bugs

A single-page demo that shows each of the five fixed PIO bugs — **#686, #688,
#689, #690, #691** — working **before → after**, and runs the **real test suite**
in your browser. No build step, no dependencies to install.

## Run it

**Fastest — double-click, no server:**

```
open demo/standalone.html
```

`standalone.html` is one self-contained file (CSS + app code + a bundled copy of
the real `rp2.js`/test file all inlined). It works straight from disk.

**Or serve the repo** (the demo then uses the *live* `rp2.js` + test file from the
repo instead of the bundled copy):

```
cd kaluma
python3 -m http.server 8080      # or: npx serve .
# → http://localhost:8080/demo/
```

> `standalone.html` is generated, not hand-edited. Rebuild it any time the demo
> source changes:
>
> ```
> node tools/build-standalone.js
> ```

## What's real, what's a model (read this)

Being straight about it, because "it's actually running" is easy to overclaim:

**Runs as the real repo code** (this is the part that isn't faked):

- `src/modules/rp2/rp2.js` — the actual PIO JavaScript layer: instruction
  encoding, the `delay()` 0–31 range guard (#688), the 32-instruction limit
  (#689), and state-machine ID allocation.
- `tests/rp2.asm.test.js` — the **actual 25-assertion test suite**, run in-browser
  against the real `rp2.js` (with the same native-binding stub the project ships).
  This is what produces the "25 passed, 0 failed" terminal on the page.
- The `.help`-command duplication scenario (#686) is driven against the real
  command-registration code path.

**Driven by a labeled model, not silicon:**

- The *hardware* behavior — a state machine actually stepping instructions, PIO
  instruction memory filling/drain and the top-down allocator, and the
  `km_pio_cleanup()` teardown (#690/#691) — is simulated with a faithful model of
  the pico-sdk behavior. This is necessary: a real RP2040 can't execute inside a
  browser. The UI says "Model, not silicon" right where this happens, so it isn't
  hidden.
- The C-side fix itself (`km_pio_cleanup()` in `targets/rp2/src/system.c`) is
  **build-verified, not hardware-tested** — there is no Pico in the loop in this
  sandbox. The C change is shown for reference; its observable effect (memory
  cleared, SMs stopped between runs) is what the model demonstrates.

So: the bugs, the fixes, and the test results are genuine repo code. The physical
hardware behavior around them is a clearly-labeled model.

## What the page shows

| # | Bug | Before (the bug) | After (the fix) |
|---|-----|------------------|-----------------|
| #690/#691 | PIO instruction memory & state machines | allocator runs out (offset → −1, FAIL), SMs left running on stale memory | `km_pio_cleanup()` stops SMs + clears memory each run → offset stays stable |
| #688 | `delay()` bounds | out-of-range delay silently corrupts instruction/sideset bits | `delay(200)` → `RangeError: … in the range 0-31 (got 200)` |
| #689 | program size limit | over-long programs fail unpredictably on the device | 33rd instruction → `Program too long!` in the source |
| #686 | `.help` command duplication | 6 fs commands re-registered every `.load`/`.flash` (48 lines) | registered once (12 lines) |
| #690 | state machines keep running | SMs left enabled after program end | `km_pio_cleanup()` stops, unclaims, clears them |

## Verify headless (no browser)

```
node tests/rp2.asm.test.js    # real 25-assertion suite → 25 passed, 0 failed
node tools/verify-demos.js    # drives the real demo card code; asserts every before/after state (21 checks)
```

## Files

- `index.html` / `app.js` / `style.css` — the live demo (loads repo source, falls
  back to `_bundle.js`).
- `_bundle.js` — a base64 copy of the real `rp2.js` + test file, the offline
  fallback (what `standalone.html` and `file://` open with).
- `standalone.html` — the generated single-file build (double-click to open).
- `../tools/build-standalone.js` — regenerates `standalone.html`.
- `../tools/verify-demos.js` — the headless before/after assertion harness.
