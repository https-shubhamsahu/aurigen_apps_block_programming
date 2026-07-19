# Aurigen — Browser-Based ESP32 Visual Programming Platform

Blockly → C++ → cloud compile (arduino-cli) → Web Serial flash. No local toolchain required.

![React](https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=flat-square&logo=node.js&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth_%2B_Postgres-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)

## Overview

Aurigen lets students and hobbyists program an ESP32 (or Arduino Uno R3) entirely from the browser: drag Blockly blocks, watch it run in a live simulator, then flash the real board over Web Serial — with zero local toolchain install. Compilation happens in the cloud via `arduino-cli`, queued through Redis/BullMQ and gated behind Supabase auth + Row-Level Security.

```
┌────────────┐   XML/C++    ┌──────────────┐   BullMQ    ┌─────────────┐
│  React +   │ ───────────▶ │ Express API  │ ──────────▶ │   Worker    │
│  Blockly   │ ◀─────────── │  (VPS)       │ ◀────────── │ arduino-cli │
└─────┬──────┘   .bin URL   └──────┬───────┘    Redis    └─────────────┘
      │ Web Serial (esptool-js)    │ Supabase JWT verify
      ▼                            ▼
  ESP32 DevKit V1              Supabase (Auth + Postgres + RLS)
```

## Features

- **Visual programming** — Blockly-based block editor that generates real C++ (`blockly/cppGenerator.js`), board-aware (`blockly/esp32Blocks.js`)
- **Product-first onboarding** — nothing is auth-gated up front; guests build, simulate, and save to `localStorage`, with cloud migration on first sign-in (`auth/AuthProvider.jsx`)
- **Dual simulation engines** — an instant block interpreter for live feedback, and a firmware-accurate engine (`avr8js`, the core Wokwi builds on) executing the real compiled `.hex` on a simulated ATmega328P
- **Real USB flashing, no installs** — ESP32 via `esptool-js` (Web Serial), Arduino Uno via a hand-rolled STK500v1 implementation straight to the optiboot bootloader
- **Cloud compilation pipeline** — Express API + BullMQ-queued `arduino-cli` worker, JWT-verified against Supabase
- **Deterministic flashing** — exports all four ESP32 flash artifacts (bootloader, partitions, boot_app0, app) so a factory-fresh board never boot-loops

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), Blockly, esptool-js |
| Backend | Node.js, Express, BullMQ |
| Compile worker | `arduino-cli` (ESP32 + AVR cores) |
| Queue | Redis |
| Auth / DB | Supabase (Auth, Postgres, Row-Level Security) |
| Simulation | Custom interpreter + avr8js (AVR firmware simulation) |

## Getting Started

### Frontend

```bash
npm create vite@latest aurigen-frontend -- --template react
cd aurigen-frontend
npm install @supabase/supabase-js blockly esptool-js
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_COMPILE_API
npm run dev
```

### Backend (on a VPS)

```bash
# Redis
sudo apt install redis-server && sudo systemctl enable --now redis-server

# arduino-cli + ESP32 core (one-time, ~10 min)
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
export PATH=$PATH:$PWD/bin
arduino-cli config init
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32
arduino-cli core install arduino:avr   # Arduino Uno R3 target

# App
cd backend
npm install
cp .env.example .env   # fill in secrets
node server.js         # API (use pm2/systemd in production)
node worker.js          # compile worker (separate process)
```

### Database

Apply `supabase/migrations/001_init.sql` in the Supabase SQL editor (or `supabase db push`).

### Free hosting for the backend (no VPS bill)

**Option A — run it locally with Docker** (no signup, no card):

```bash
cp backend/.env.example backend/.env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
docker compose up -d --build           # builds arduino-cli + both cores into the image
docker compose logs -f                 # watch server.js + worker.js
```

Runs Redis + the API + the worker in containers (`docker-compose.yml`, `backend/Dockerfile`). Point `VITE_COMPILE_API` at `http://localhost:4000` for local testing, or expose it via a free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/):

```bash
winget install --id Cloudflare.cloudflared   # or: choco install cloudflared
cloudflared tunnel --url http://localhost:4000
```

That prints an `https://<random>.trycloudflare.com` URL immediately — set it as `VITE_COMPILE_API` in the frontend. Trade-off: only reachable while your machine and tunnel are running — fine for demos, not for guaranteed uptime. For a stable URL on your own domain, use a *named* tunnel (`cloudflared tunnel create` + `cloudflared tunnel route dns`) instead of the random one.

**Option B — Oracle Cloud "Always Free" VPS** (a real, non-expiring free tier — 4 vCPU / 24 GB RAM ARM Ampere shape):

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) and create a Compute instance: shape **VM.Standard.A1.Flex**, image **Ubuntu 22.04**, your SSH key.
2. Open ingress on TCP 443 (and 80 for Let's Encrypt) in the instance's Security List.
3. SSH in and run the provisioning script committed in this repo:
   ```bash
   git clone <your-repo-url> aurigen && cd aurigen/backend
   chmod +x install.sh && ./install.sh
   ```
   Installs Redis, Node 20, `arduino-cli` + ESP32/AVR cores, `npm install`s the backend, and starts `server.js` + `worker.js` under **pm2** (`ecosystem.config.js`), surviving reboots.
4. Edit `backend/.env` with your real `SUPABASE_SERVICE_ROLE_KEY` and `CORS_ORIGIN`, then `pm2 restart all`.
5. Point a subdomain at the instance's public IP and front it with Caddy for automatic HTTPS (`Caddyfile` included), or skip a domain entirely and use a Cloudflare Tunnel (systemd unit template at `cloudflared.service.example`) for real HTTPS with no port exposure.

## Design Notes

**Flashing deviation (intentional):** the spec calls for flashing a single app binary at `0x10000`, which only works if the board already has a compatible bootloader and partition table. A factory-fresh or erased DevKit would boot-loop. The worker instead exports all four artifacts (bootloader `@0x1000`, partitions `@0x8000`, boot_app0 `@0xE000`, app `@0x10000`) and the frontend flashes them together — deterministic first-boot at the cost of ~3s extra flash time.

**Simulation contract:** `components/Simulator.jsx` drives whichever engine is selected; both emit the same `{ pins: {name: 0–255}, serial, running, txCount }` shape, so adding a board is just a `boards/boards.js` entry + SVG, and adding an engine is one class honoring that contract.

## Project Structure

```
frontend/src/auth/AuthProvider.jsx     Session context + requireAuth + guest→cloud migration
frontend/src/auth/AuthModal.jsx        On-demand sign-in (never a wall)
frontend/src/lib/localProjects.js      Guest persistence (localStorage, cloud-shaped rows)
frontend/src/lib/supabaseClient.js     Supabase client + auth/project helpers
frontend/src/blockly/cppGenerator.js   Custom Blockly → C++ generator core
frontend/src/blockly/esp32Blocks.js    Board-aware block defs + generators
frontend/src/simulator/interpreter.js  Blocks engine (instant)
frontend/src/simulator/engines/avrEngine.js  Firmware engine (avr8js)
frontend/src/simulator/hex.js          Intel HEX parser (engine + flasher)
frontend/src/hooks/useWebSerial.js     ESP32 flashing (esptool-js)
frontend/src/hooks/useAvrFlash.js      Uno flashing (STK500v1 over Web Serial)
backend/server.js                      Express API + BullMQ producer + rate limits
backend/worker.js                      BullMQ consumer → arduino-cli
supabase/migrations/001_init.sql       Tables + RLS
```

## Contributing

Fork the repository, create a feature branch, and open a pull request. New board support should follow the existing `boards/boards.js` + simulator-engine contract described above.

## License

No license file is currently present in this repository.
