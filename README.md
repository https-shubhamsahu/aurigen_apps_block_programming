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

## 2. Flashing note (deviation from spec, on purpose)

The spec asks to flash a single app binary at `0x10000`. That only works on a board
that already has a compatible bootloader + partition table in flash. A factory-fresh
or previously-erased DevKit will boot-loop. The worker therefore exports **all four
artifacts** (`bootloader @ 0x1000`, `partitions @ 0x8000`, `boot_app0 @ 0xE000`,
`app @ 0x10000`) and the frontend flashes them together. This makes first-day
classroom experience deterministic at the cost of ~3 s extra flash time.

## 3. Repo layout

```
frontend/src/lib/supabaseClient.js     Supabase client + auth helpers
frontend/src/auth/AuthGate.jsx         Login / register (yellow-white theme)
frontend/src/blockly/cppGenerator.js   Custom Blockly → C++ generator core
frontend/src/blockly/esp32Blocks.js    ESP32-safe block defs + generators
frontend/src/components/BlocklyWorkspace.jsx
frontend/src/hooks/useWebSerial.js     esptool-js flash hook
backend/server.js                      Express API + BullMQ producer
backend/worker.js                      BullMQ consumer → arduino-cli
supabase/migrations/001_init.sql       Tables + RLS
```
