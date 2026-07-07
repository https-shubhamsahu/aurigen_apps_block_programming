# Aurigen — Browser-Based ESP32 Visual Programming Platform

Blockly → C++ → cloud compile (arduino-cli) → Web Serial flash. No local toolchain.

```
┌────────────┐   XML/C++    ┌──────────────┐   BullMQ    ┌─────────────┐
│  React +   │ ───────────▶ │ Express API  │ ──────────▶ │   Worker    │
│  Blockly   │ ◀─────────── │  (VPS)       │ ◀────────── │ arduino-cli │
└─────┬──────┘   .bin URL   └──────┬───────┘    Redis    └─────────────┘
      │ Web Serial (esptool-js)    │ Supabase JWT verify
      ▼                            ▼
  ESP32 DevKit V1              Supabase (Auth + Postgres + RLS)
```

## 1. Scaffolding

### Frontend
```bash
npm create vite@latest aurigen-frontend -- --template react
cd aurigen-frontend
npm install @supabase/supabase-js blockly esptool-js
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_COMPILE_API
npm run dev
```

### Backend (on the VPS)
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
node worker.js         # compile worker (separate process)
```

### Database
Apply `supabase/migrations/001_init.sql` in the Supabase SQL editor (or `supabase db push`).

## 1a. Free hosting for the backend (no VPS bill)

The commands above assume a rented VPS. If you don't want to pay for one yet,
two paths get the compile service running at **$0**:

### Option A — run it on your own machine, right now (Docker)

No signup, no card, works immediately if Docker is installed:

```bash
cp backend/.env.example backend/.env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
docker compose up -d --build           # builds arduino-cli + both cores into the image
docker compose logs -f                 # watch server.js + worker.js
```

This runs Redis + the API + the worker in containers (see `docker-compose.yml`,
`backend/Dockerfile`). `VITE_COMPILE_API` on the frontend should point at
`http://localhost:4000` for local testing.

To let people outside your LAN reach it, add a **Cloudflare Tunnel** (free,
no account payment, gives you a real HTTPS URL without port-forwarding):

```bash
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/
winget install --id Cloudflare.cloudflared   # or: choco install cloudflared
cloudflared tunnel --url http://localhost:4000
```

That prints a `https://<random>.trycloudflare.com` URL immediately — set it as
`VITE_COMPILE_API` in the frontend and you're live. Trade-off: the backend is
only reachable while your PC is on and the tunnel is running. Good for testing,
demos, and small-scale real use; not for guaranteed uptime.

For a **persistent free URL** on your own domain instead of a random
`trycloudflare.com` one, use a *named* tunnel (`cloudflared tunnel create`,
`cloudflared tunnel route dns`) — still free, just a few more one-time steps
in Cloudflare's dashboard.

### Option B — a real always-free VPS (Oracle Cloud "Always Free")

Unlike AWS/GCP's 12-month trials, Oracle's Always Free tier does not expire:
1 GB new tier VM or the ARM Ampere shape at **4 vCPU / 24 GB RAM**, free
forever. Requires a card on file for identity verification, but the free-tier
resources are never billed as long as you stay within them.

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (free tier).
2. Create a Compute instance → shape **VM.Standard.A1.Flex** (Ampere/ARM,
   Always Free) → image **Ubuntu 22.04** → add your SSH key.
3. In the instance's subnet **Security List**, add an ingress rule for
   TCP port 443 (and 80, for the Let's Encrypt HTTP challenge).
4. SSH in, then run the provisioning script committed in this repo:
   ```bash
   git clone <your-repo-url> aurigen && cd aurigen/backend
   chmod +x install.sh && ./install.sh
   ```
   This installs Redis, Node 20, arduino-cli + the ESP32 and AVR cores,
   `npm install`s the backend, and starts `server.js` + `worker.js` under
   **pm2** (`ecosystem.config.js`), surviving reboots.
5. Edit `backend/.env` (the script copies `.env.example` for you) with your
   real `SUPABASE_SERVICE_ROLE_KEY` and `CORS_ORIGIN`, then `pm2 restart all`.
6. Point a subdomain's DNS at the instance's public IP, then front it with
   Caddy for automatic HTTPS (config committed at `Caddyfile`):
   ```bash
   sudo apt install caddy   # see comment at the top of Caddyfile for the repo setup
   sudo cp Caddyfile /etc/caddy/Caddyfile   # edit api.yourdomain.com first
   sudo systemctl reload caddy
   ```

**No domain yet?** Skip step 6 (Caddy) and use a Cloudflare Tunnel instead —
it gives real HTTPS with no domain purchase and no port 80/443 exposure:
```bash
curl -fsSL https://pkg.cloudflare.com/cloudflared-linux-arm64 -o cloudflared  # Oracle A1 is ARM
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
sudo cp cloudflared.service.example /etc/systemd/system/cloudflared.service
sudo systemctl daemon-reload && sudo systemctl enable --now cloudflared
sudo journalctl -u cloudflared -f   # prints your https://<random>.trycloudflare.com URL
```
Set that URL as `VITE_COMPILE_API` in the frontend. It stays stable as long as
the service keeps running (survives reboots via systemd); it only changes if
the tunnel process itself restarts. For a URL that never changes, add a free
domain later — e.g. a [js.org](https://js.org) subdomain for open-source JS
projects, or a free Namecheap `.me` domain via the
[GitHub Student Developer Pack](https://education.github.com/pack) if you
qualify — and switch to a Cloudflare *named* tunnel.

## 2. Flashing note (deviation from spec, on purpose)

The spec asks to flash a single app binary at `0x10000`. That only works on a board
that already has a compatible bootloader + partition table in flash. A factory-fresh
or previously-erased DevKit will boot-loop. The worker therefore exports **all four
artifacts** (`bootloader @ 0x1000`, `partitions @ 0x8000`, `boot_app0 @ 0xE000`,
`app @ 0x10000`) and the frontend flashes them together. This makes first-day
classroom experience deterministic at the cost of ~3 s extra flash time.

## 3. Architecture

**Product-first onboarding.** Nothing is auth-gated at the door: guests land in
the full IDE, build, simulate, and save to `localStorage` (`lib/localProjects.js`).
`auth/AuthProvider.jsx` exposes `requireAuth(reason, resume)` — the only feature
that raises the sign-in modal is the cloud compiler, and the pending action
resumes automatically after sign-in. Guest projects migrate into the account on
first sign-in.

**Two simulation engines, one contract.** `components/Simulator.jsx` drives
whichever engine is selected; both emit the same
`{ pins: {name: 0–255}, serial, running, txCount }` shape:

| engine | file | what it is |
|---|---|---|
| ⚡ Blocks | `simulator/interpreter.js` | Instant block interpreter — live feedback while editing, all boards |
| 🔬 Firmware | `simulator/engines/avrEngine.js` | [avr8js](https://github.com/wokwi/avr8js) (MIT, the core Wokwi builds on) executing the **real compiled .hex** on a simulated ATmega328P — timers, USART serial, ADC, and *measured* PWM duty (cycle-integrated, not guessed) |

Adding a board = a `boards/boards.js` entry + an SVG render; adding an engine =
one class honoring the contract above.

**Real USB programming for both boards, no installs.**
`hooks/useWebSerial.js` (esptool-js, ESP32) and `hooks/useAvrFlash.js`
(hand-rolled STK500v1 straight to the Uno's optiboot bootloader — DTR
auto-reset, signature check, 128-byte page writes). Browsers without Web
Serial fall back to a `.hex` download.

## 4. Repo layout

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
