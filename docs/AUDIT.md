# Codebase audit — 2026-07-08

Full end-to-end review of frontend, backend, and database. Each finding is
tagged with its resolution; anything not marked **open** was fixed and
verified the same day (see commit history around this date).

## Working features (verified)

- Guest-first flow: land in IDE signed out, build/simulate/save locally,
  auth modal only for cloud compile, guest→account project migration
- Blockly editor: board-aware toolbox + search, live C++ panel, undo/redo,
  autosave (cloud + local), Ctrl/Cmd+S, share-by-URL round-trip
- Simulation: block interpreter (all boards) + avr8js firmware engine
  (Uno, real compiled hex at ~16 MHz real-time; serial + measured PWM duty)
- Compile pipeline: JWT auth → BullMQ queue → arduino-cli → tokenized
  artifacts; per-user rate limit; queue-depth cap; 10-min TTL sweeps
- Flashing: ESP32 esptool-js (verified on-air), Uno STK500v1 (protocol
  implementation complete; awaiting physical-hardware confirmation)
- Auth: sign in/up, password reset request + recovery screen
- Persistence: Supabase Postgres + RLS (cross-account isolation verified)

## Findings & resolutions

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | P0 | Editing blocks after a successful build left the Download button "ready" → could deliver stale firmware | **Fixed**: job resets to idle on any program edit; sim keeps the hex flagged stale |
| 2 | P0 | LEDC channel allocator was module-global → ESP32 codegen nondeterministic across a session | **Fixed**: allocation lives on the generator, reset per generation; regression-tested |
| 3 | P0 | Expired artifacts (10-min TTL) surfaced as cryptic fetch errors | **Fixed**: friendly "build expired — compile again" path |
| 4 | P1 | No staleness signal on the firmware sim engine after edits | **Fixed**: • badge + tooltip when blocks changed since the build |
| 5 | P1 | index.html lacked meta description/OG; title omitted Arduino | **Fixed** |
| 6 | P1 | boards.js comment claimed Uno browser flashing was future work (it shipped) | **Fixed** |
| 7 | P2 | No tests, no linting, no CI | **Fixed**: vitest (19 tests: hex parser, share codec, guest store, C++ generator via headless Blockly), ESLint 9 flat config, GitHub Actions (lint+test+build+backend syntax) |
| 8 | P2 | 1.17 MB initial JS bundle | **Fixed**: esptool-js + avr8js now dynamic imports; Blockly in its own cacheable chunk → 437 KB main (126 KB gzip) |
| 9 | P3 | Redis 6.0.16 on the VPS (BullMQ recommends ≥ 6.2) | **Open**: works today; upgrade to Redis 7 when convenient (`sudo add-apt-repository ppa:redislabs/redis` or Docker) |
| 10 | P3 | Supabase "leaked password protection" toggle | **Open (dashboard-only)**: Authentication → Sign In / Providers → Passwords |
| 11 | P3 | trycloudflare tunnel URL changes if the cloudflared process restarts | **Open by design**: migrate to Caddy + owned domain (config committed: `Caddyfile`), or a named tunnel |
| 12 | P3 | Uno STK500 flasher untested on physical hardware | **Open**: needs a real board on USB; protocol is the standard optiboot handshake |

## Architectural notes

- Engine contract (`{start, stop, speed, setDigitalInput, setAnalogInput,
  clearSerial}` emitting `{pins, serial, running, txCount}`) is the plugin
  seam for future engines/boards; boards are data rows in `boards/boards.js`.
- The block interpreter intentionally remains the ESP32 engine — no
  open-source ESP32 core exists to embed (Wokwi's is closed).
- Known deliberate trade-offs: firmware engine runs on the main thread with
  a 6 ms/slice budget (Worker offload is the natural upgrade); guest
  projects are per-browser by definition.
