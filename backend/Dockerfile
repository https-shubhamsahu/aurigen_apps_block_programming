# Compile worker/API image — bundles arduino-cli + both board cores so the
# container is self-sufficient (no host-level arduino-cli install needed).
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh \
      | BINDIR=/usr/local/bin sh \
    && arduino-cli config init --overwrite \
    && arduino-cli config add board_manager.additional_urls \
         https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json \
    && arduino-cli core update-index \
    && arduino-cli core install esp32:esp32 \
    && arduino-cli core install arduino:avr

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV ARDUINO_CLI=arduino-cli \
    ARTIFACT_DIR=/data/artifacts \
    JOB_DIR=/data/jobs
RUN mkdir -p /data/artifacts /data/jobs

# server.js and worker.js are launched as separate containers (see
# docker-compose.yml) — this image serves both, selected by CMD override.
CMD ["node", "server.js"]
