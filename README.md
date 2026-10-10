> ## 🍴 This is a personal fork — **not the original project, not authoritative**
>
> You're looking at **`trusnock/kaluma`**, a **personal fork** of
> [**Kaluma**](https://github.com/kaluma-project/kaluma) (the official site is
> [kalumajs.org](https://kalumajs.org/)). It is **not** the upstream project and
> **not** trying to become its new home.
>
> - **No credit taken for the code.** All original code is by Changjae (Jay) Kim
>   and the Kaluma contributors, licensed **Apache-2.0** (notices preserved).
> - **Why this fork exists:** the upstream project has been dormant for a while,
>   and a few **known, reported bugs** were blocking real use. I used AI-assisted
>   work to **fix a small set of those reported bugs** so this build works again.
> - **What was fixed:** #688, #689, #690, #691, #686 — see
>   **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the full breakdown, how to
>   build/run, and how to file issues or open PRs.
>
> **This is a "my little corner of the world where I fixed a few known issues so
> people could get back to using it" build — not a competing fork.**

![logo](https://github.com/kaluma-project/kaluma/blob/master/logo.png?raw=true)

[![Current Version](https://img.shields.io/github/tag/kaluma-project/kaluma.svg)](https://github.com/kaluma-project/kaluma/tags)
[![GitHub license](https://img.shields.io/github/license/kaluma-project/kaluma)](https://github.com/kaluma-project/kaluma/blob/master/LICENSE)
[![Docs Status](https://img.shields.io/badge/docs-ready-orange.svg)](https://kalumajs.org/docs/)

# Overview

**Official website: [kalumajs.org](https://kalumajs.org/)**

__Kaluma__ is a tiny and efficient **JavaScript runtime** for [RP2040 (Raspberry Pi Pico)](https://www.raspberrypi.org/products/raspberry-pi-pico/). The main features are:

- **Small footprint**. Runs minimally on microcontrollers with 300KB ROM with 64KB RAM.
- Support **modern JavaScript** standards (ECMAScript 5/6/6+). Powered by [JerryScript](https://jerryscript.net/).
- Has internal event loop like as Node.js for **asynchronous**.
- Has **built-in modules** including file systems (LittleFS, FAT), graphics, networking and more.
- Support RP2's **PIO (Programmable I/O) assembly** embeddable in JavaScript code.
- Provides very friendly API that resembles **Node.js** and **Arduino**.

# Try the PIO fixes in your browser

There's an interactive **PIO Workbench** demo that shows each of the five fixed
bugs (#686, #688, #689, #690, #691) working **before → after** live, running the
**real fixed `rp2.js`** and the **real test suite** in your browser.

**Easiest — no install, no server, just double-click:**

```
open demo/standalone.html        # one self-contained file — it works from disk
```

(`standalone.html` is a pre-built single file. Rebuild it anytime with
`node tools/build-standalone.js` if the demo source changes.)

**Or serve the repo** (then the demo runs the *live* `rp2.js`/test file straight
from the repo instead of its bundled copy):

```
cd kaluma
python3 -m http.server 8080      # or: npx serve .
# → http://localhost:8080/demo/
```

And the checks it runs can also be run headless, no browser:

```
node tests/rp2.asm.test.js       # the real 25-assertion suite → 25 passed, 0 failed
node tools/verify-demos.js       # drives the real demo card code, asserts every before/after state
```

> **What's real, what's a model:** the PIO *JavaScript* (instruction encoding, the
> `delay()` range guard, the 32-instruction limit, state-machine ID allocation) and
> the 25-assertion test suite run as the **real repo code** in your browser/Node.
> The hardware side — state machines actually stepping, PIO instruction memory
> filling/draining, and the `km_pio_cleanup()` teardown — is driven by a **faithful
> model of the pico-sdk behavior** (clearly labeled as such in the UI), because a
> real Pico can't run in a browser. The C-side fix itself is **build-verified, not
> hardware-tested** (no Pico in the loop). See [demo/README.md](./demo/README.md)
> for the full breakdown.
