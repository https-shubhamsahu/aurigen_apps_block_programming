# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Aurigen — a browser-based visual programming platform for ESP32 and Arduino Uno.
Students build programs in Blockly, which generates C++; a cloud service compiles
it with `arduino-cli`; the compiled binary is flashed to the board over Web Serial
directly from the browser. No local toolchain install required.

```
┌────────────┐   XML/C++    ┌──────────────┐   BullMQ    ┌─────────────┐
│  React +   │ ───────────▶ │ Express API  │ ──────────▶ │   Worker    │
│  Blockly   │ ◀─────────── │  (VPS)       │ ◀────────── │ arduino-cli │
└─────┬──────┘   .bin URL   └──────┬───────┘    Redis    └─────────────┘
      │ Web Serial (esptool-js)    │ Supabase JWT verify
      ▼                            ▼
  ESP32 DevKit V1              Supabase (Auth + Postgres + RLS)
```

Three deployables: `frontend/` (Vite/React SPA), `backend/` (Express API +
BullMQ worker, runs on a VPS/Oracle box, not serverless), `supabase/` (Postgres
schema + RLS).

## Commands

### Frontend (`frontend/`)
```bash
npm run dev       # vite dev server, port 5173
npm run build     # production build
npm test          # vitest run (all *.test.js under src/)
npx vitest run src/blockly/cppGenerator.test.js   # single test file
npm run lint      # eslint src
```

### Backend (`backend/`)
```bash
node server.js          # API process (Express + BullMQ producer)
node worker.js           # compile worker (separate process, consumes the queue)
node --check server.js   # syntax check only — this is what CI runs, there is no backend test suite
```
Backend needs Redis running locally (`REDIS_URL`) and a `.env` copied from
`.env.example` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ARDUINO_CLI` path,
`FQBN`). `docker compose up -d --build` runs Redis + API + worker together for
local end-to-end testing (see `docker-compose.yml`, `backend/Dockerfile`).

### CI (`.github/workflows/ci.yml`)
Two independent jobs: `frontend` (npm ci → lint → test → build, with placeholder
`VITE_*` env vars) and `backend` (npm ci → `node --check` on both entry points —
no live Redis/Supabase in CI, so this only catches syntax errors, not runtime bugs).

## Architecture

**Product-first onboarding, no auth wall.** Guests land directly in the full IDE
and can build, simulate, and save — everything persists to `localStorage` via
`frontend/src/lib/localProjects.js` in the same shape as the cloud rows. Only the
cloud compiler requires an account. `frontend/src/auth/AuthProvider.jsx` exposes
`requireAuth(reason, resume)`: call it before a gated action, it raises the
sign-in modal (`AuthModal.jsx`) if needed and resumes the pending action
automatically after sign-in. On first sign-in, guest projects migrate into the
account.

**AI program schema is a safety boundary, not free-form generation.**
`frontend/src/ai/program.js` defines a small whitelisted JSON dialect (statement
forms like `digital_write`, `pwm_write`, `repeat`, `if`; value forms like
`math`, `compare`, `analog_read`). An AI assistant emits this JSON — never
Blockly XML directly — and `program.js` validates it (whitelisted ops,
board-legal pins, statement count and nesting-depth caps) before deterministically
compiling it to Blockly XML. A malformed/oversized program is rejected with a
reason; it can never load garbage into a student's workspace. Read the header
comment in that file before extending the schema.

**Two simulation engines share one contract.** `components/Simulator.jsx` drives
whichever engine is selected; both emit `{ pins: {name: 0-255}, serial, running,
txCount }`:
| engine | file | notes |
|---|---|---|
| Blocks | `simulator/interpreter.js` | instant block interpreter, live feedback while editing, works for all boards |
| Firmware | `simulator/engines/avrEngine.js` | [avr8js](https://github.com/wokwi/avr8js) executing the **real compiled .hex** on a simulated ATmega328P (Uno only) — timers, USART serial, ADC, cycle-integrated PWM duty |

There is no open-source ESP32 core to embed, so the block interpreter is
intentionally the only ESP32 engine. Adding a board = an entry in
`boards/boards.js` + an SVG render (see `boards/ArduinoUnoSVG.jsx` /
`Esp32DevkitSVG.jsx`); adding an engine = a class honoring the contract above.
The concrete instance-method contract (see `avrEngine.js` header) is
`.start() .stop() .setDigitalInput(pin, 0|1) .setAnalogInput(pin, raw)
.clearSerial()`, constructed as `new AvrRunner(hexText, board, onUpdate)`.
The firmware engine runs on the main thread with a 6ms/slice budget by
design (not yet Worker-offloaded) — see `docs/AUDIT.md` for this and other
open/deliberate trade-offs.

**Real USB flashing, no drivers/installs.** `hooks/useWebSerial.js` wraps
esptool-js for the ESP32. `hooks/useAvrFlash.js` is a hand-rolled STK500v1
implementation straight to the Uno's optiboot bootloader (DTR auto-reset,
signature check, 128-byte page writes) — there was no suitable JS library, so
don't assume one exists if this needs changes. Browsers without Web Serial fall
back to a `.hex`/`.bin` download.

**Deliberate deviation from a naive flashing approach:** the backend/worker
exports all four ESP32 artifacts (`bootloader@0x1000`, `partitions@0x8000`,
`boot_app0@0xE000`, `app@0x10000`), not just the app binary at `0x10000`.
Flashing only the app binary boot-loops a factory-fresh or erased board because
it lacks a bootloader/partition table already in flash.

**Backend is two processes sharing a BullMQ queue, not a monolith.**
`server.js` is the HTTP API: verifies the Supabase JWT (`requireUser`), applies
a per-user fixed-window rate limit plus a global queue-depth cap, enqueues a
`compile-sketch` job, and serves the resulting artifacts as short-lived static
files (10-min TTL, `Cache-Control: no-store`). `worker.js` is a separate process
that consumes the queue and shells out to `arduino-cli`. Jobs are private to
their submitter (`job.data.userId` checked against the requester on every status
poll). Board keys (`esp32`, `uno`) are whitelisted client-side identifiers
mapped server-side to FQBNs — the client can never pass an arbitrary FQBN.

**Supabase is Auth + Postgres + RLS**, schema in
`supabase/migrations/001_init.sql`. Cross-account isolation is enforced by RLS,
not application code — verify policy changes at the database level, not just
by testing the UI.

## Key files
```
frontend/src/auth/AuthProvider.jsx          Session context + requireAuth + guest→cloud migration
frontend/src/auth/AuthModal.jsx             On-demand sign-in modal (never a wall)
frontend/src/lib/localProjects.js           Guest persistence (localStorage, cloud-shaped rows)
frontend/src/lib/supabaseClient.js          Supabase client + auth/project helpers
frontend/src/lib/share.js                   Share-by-URL codec
frontend/src/ai/program.js                  AI JSON program schema, validator, → Blockly XML compiler
frontend/src/blockly/cppGenerator.js         Custom Blockly → C++ generator core
frontend/src/blockly/esp32Blocks.js         Board-aware block defs + generators
frontend/src/simulator/interpreter.js       Blocks engine (instant, all boards)
frontend/src/simulator/engines/avrEngine.js  Firmware engine (avr8js, Uno only)
frontend/src/simulator/hex.js               Intel HEX parser (used by engine + flasher)
frontend/src/hooks/useWebSerial.js          ESP32 flashing (esptool-js)
frontend/src/hooks/useAvrFlash.js           Uno flashing (hand-rolled STK500v1)
frontend/src/boards/boards.js               Board registry (data-driven, add boards here)
frontend/src/design/                        Design tokens, ThemeToggle, shared shells (Modal/Empty/Skeleton/Spinner)
backend/server.js                           Express API: JWT auth, rate limit, queue producer, artifact serving
backend/worker.js                           BullMQ consumer → arduino-cli
supabase/migrations/001_init.sql            Tables + RLS
docs/AUDIT.md                               Point-in-time audit log — open items and deliberate trade-offs
```

## Conventions worth knowing before editing

- ESLint's React-Compiler-preview rules (`set-state-in-effect`, `immutability`,
  `refs`) are deliberately **off** in `frontend/eslint.config.js` — they
  conflict with intentional imperative patterns in Blockly workspace mounting
  and hardware protocol loops. Don't re-enable them without checking those
  call sites.
- Vitest runs in `environment: 'node'` (see `frontend/vite.config.js`), not
  jsdom — tests that need a DOM must mock it themselves.
- `backend/server.js` loads `.env` from the module's own path, not `cwd`, so it
  works the same under pm2/systemd and bare `node`. Under Docker no `.env`
  exists — values come from compose `env_file`.
