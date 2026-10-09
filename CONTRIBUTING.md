# A maintained-fork of Kaluma (by trusnock)

## What this is — and what it is not

This repository (`trusnock/kaluma`) is a **personal, non-authoritative fork** of
[**Kaluma**](https://github.com/kaluma-project/kaluma) — a tiny JavaScript runtime
for RP2040 (Raspberry Pi Pico) by **Changjae (Jay) Kim** and the Kaluma
contributors.

- **It is NOT the original project**, and it is NOT trying to become the
  authoritative source for Kaluma. The upstream project is
  [kaluma-project/kaluma](https://github.com/kaluma-project/kaluma)
  (official site: [kalumajs.org](https://kalumajs.org/)).
- **I take no credit for any of the code here.** The runtime, every module, and
  all original tooling are the work of the upstream authors.
- This fork exists for one practical reason: the upstream project has been in a
  long stretch of dormancy (last upstream push: October 2025), and several
  **known, reported bugs** were preventing people from actually using it. I used
  AI-assisted development to **triage and fix a small set of those reported bugs**
  so this build is usable again.
- Everything here is **Apache-2.0 licensed** (same as upstream). Per that license,
  the original copyright notices are preserved and this fork does not add any
  new claims of ownership. See [LICENSE](./LICENSE).

Please treat this as a "my little corner of the world where I fixed a few known
issues so people could get back to using it" — **not** a competing fork or a new
home for the project.

## What was fixed in this fork

These correspond to real, still-open issues on upstream. Each fix links back to
its source issue.

| Upstream issue | Problem | Fix (this fork) |
| --- | --- | --- |
| [#688](https://github.com/kaluma-project/kaluma/issues/688) | `rp2` PIO `ASM.delay()` had no bounds checking; an oversized value silently clobbered adjacent instruction/sideset bits | `ASM.delay()` now validates the 5-bit field (integer 0–31) and throws `RangeError` — `src/modules/rp2/rp2.js` |
| [#689](https://github.com/kaluma-project/kaluma/issues/689) | PIO `ASM` had no program-size limit | `ASM` now enforces a 32-instruction limit in a single choke point (`_add()`) — `src/modules/rp2/rp2.js` |
| [#690](https://github.com/kaluma-project/kaluma/issues/690) | PIO state machines kept running after the program ended | `km_pio_cleanup()` stops SMs on every program end / `.reset` / `.load` — `targets/rp2/src/system.c` |
| [#691](https://github.com/kaluma-project/kaluma/issues/691) | PIO program not cleared between runs → program offset drifted down to negative; part unrecoverable without `flash_nuke` | `km_pio_cleanup()` also unclaims SMs and clears PIO instruction memory on every program end — `targets/rp2/src/system.c` |
| [#686](https://github.com/kaluma-project/kaluma/issues/686) | `.help` listed the six filesystem commands (`.ls .pwd .cd .mkdir .rm .cat`) many times | REPL command registration is now idempotent (replace-if-exists) — `src/repl.c` |

### How the fixes were validated
- **`tests/rp2.asm.test.js`** — a Node test harness (25 cases) that stubs the
  native `rp2` binding with a faithful model of pico-sdk's PIO instruction-memory
  allocator. It unit-tests the `ASM` limits (#688/#689) and **reproduces the #691
  negative-offset drift**, then confirms clearing instruction memory fixes it.
  Run it with: `node tests/rp2.asm.test.js`.
- **Firmware build** — the C changes compile and link into the RP2040/Pico
  target and produce a flashable `.uf2`. See *Building* below.
- **Not yet validated (needs real hardware):** the C fixes are verified by
  inspection against the pico-sdk API and by the build, but a physical Pico
  flash-and-run was not available in the environment that made these changes.
  If you have a Pico and see something off, that's exactly what the
  [Issues](#reporting-issues) section below is for.

## Getting started (use it)

### Prerequisites
- A [RP2040 / Raspberry Pi Pico](https://www.raspberrypi.com/products/raspberry-pi-pico/) board.
- A C toolchain and `cmake`. Kaluma is designed to build inside the
  project's own Docker environment, which is the easiest path and matches what
  the project authors used.
- `python` (the build invokes `python`; if you only have `python3`, alias it).

### Build
```bash
git clone --recursive https://github.com/trusnock/kaluma
cd kaluma

# pick a target + board. "rp2" covers Pico / Pico W / Pico 2, etc.
node build.js --target rp2 --board pico2        # e.g. Pico 2
# node build.js --target rp2 --board pico       # e.g. Pico
```
The build produces `build/kaluma-rp2-<board>-<version>.uf2` — copy that file to
the Pico while it's held in BOOTSEL (plug in USB with BOOTSEL pressed) and it is
flashed, then a REPL appears over serial (115200 baud).

> **Toolchain note (honest caveat):** a stock newer ARM GCC (e.g. 13.3) can fail
> on a pre-existing warning in the third-party `jerryscript` submodule under
> `-Werror`. The project's own Docker toolchain is unaffected. If you hit it, see
> the "Known build quirks" note below.

### Try the fixed behavior
The fixes are in the shipped runtime. A quick check that the #691-style
"runs twice" scenario now works is to load the same PIO program twice (via
`.load` twice, or `.reset` in between) — previously the second load drifted the
program offset down and stopped working.

## Reporting issues

The **Issues** tab is open on this fork. Please:
- File a **new issue** here if you hit a bug in *this* build (include: board,
  firmware version, board model, and the exact steps to reproduce).
- Check the upstream issue list first if it looks like a general Kaluma feature
  gap — new feature requests really should go to
  [upstream](https://github.com/kaluma-project/kaluma/issues).

## Submitting a PR

Yes — pull requests to this fork are welcome.
- Branch from `master`, keep changes focused, and reference the issue it fixes.
- For `rp2` changes, add/extend coverage in `tests/` where possible and make sure
  `node tests/rp2.asm.test.js` still passes.
- **Do not relicense or remove** the upstream copyright notices — Apache-2.0
  requires they stay.

## Building from source — known quirks (for reproducibility)

- `python` vs `python3`: `build.js` calls `python`. If your system only has
  `python3`, run `ln -s $(command -v python3) $(dirname $(command -v python3))/python`
  (or set up an alias) before building.
- `jerryscript` + newer GCC + `-Werror`: the third-party `jerryscript` submodule
  (pinned commit) triggers a new `-Werror=unterminated-string-initialization`
  on some newer toolchains. Using the project's Docker toolchain avoids this. If
  you must build on a newer GCC, you can locally relax that one diagnostic for
  the `jerryscript` submodule (this is a **build-environment workaround only**,
  not a code change to the project).

---

*Forked by trusnock. Original project and all original code by Changjae (Jay)
Kim and the Kaluma contributors. Licensed Apache-2.0.*
