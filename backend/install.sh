#!/usr/bin/env bash
# ============================================================
# Aurigen compile-service provisioning script — fresh Ubuntu 22.04/24.04 box.
# Idempotent: safe to re-run after a git pull to pick up dependency changes.
#
# Usage:
#   git clone <your-repo-url> aurigen && cd aurigen/backend
#   chmod +x install.sh && ./install.sh
# ============================================================
set -euo pipefail

echo "== Aurigen backend setup =="

# ---- 0. Swap file ------------------------------------------------------
# arduino-cli's ESP32 compile can spike memory well past what the free-tier
# micro shapes (1 GB RAM) offer. A swap file costs nothing and turns an OOM
# kill into a slow-but-successful compile instead. Harmless on bigger boxes.
if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 4000 ]; then
  echo "-- Low-memory host detected — adding a 4G swap file --"
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # Prefer keeping the process working set in RAM; only swap under real pressure.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/60-aurigen-swap.conf >/dev/null
  sudo sysctl -p /etc/sysctl.d/60-aurigen-swap.conf
fi

# ---- 1. System packages ----------------------------------------------
sudo apt-get update -y
sudo apt-get install -y redis-server curl git build-essential

sudo systemctl enable --now redis-server

if ! command -v node >/dev/null; then
  echo "-- Installing Node.js 20.x --"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null; then
  sudo npm install -g pm2
fi

# ---- 2. arduino-cli + board cores --------------------------------------
if ! command -v arduino-cli >/dev/null; then
  echo "-- Installing arduino-cli --"
  curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh \
    | sudo BINDIR=/usr/local/bin sh
fi

arduino-cli config init --overwrite
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32   # ESP32 DevKit V1
arduino-cli core install arduino:avr   # Arduino Uno R3

# ---- 3. App dependencies -----------------------------------------------
cd "$(dirname "$0")"
npm install --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  # A 1 GB micro instance can't safely run two arduino-cli compiles at once —
  # drop concurrency to 1 there so the swap file above stays a rare fallback,
  # not the normal path.
  if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2000 ]; then
    sed -i 's/^CONCURRENCY=.*/CONCURRENCY=1/' .env
  fi
  echo ""
  echo "!! Created backend/.env from the template — edit it now and set:"
  echo "   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CORS_ORIGIN"
  echo "   (find the service role key in Supabase → Project Settings → API Keys)"
fi

mkdir -p artifacts jobs

# ---- 4. Start under pm2, survive reboots -------------------------------
pm2 start ecosystem.config.cjs
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | bash || true

echo ""
echo "== Done =="
echo "Edit backend/.env if you haven't, then: pm2 restart all"
echo "Check status:  pm2 status | pm2 logs aurigen-api | pm2 logs aurigen-worker"
echo "Next: put Caddy in front (see ../Caddyfile) for HTTPS on your domain."
