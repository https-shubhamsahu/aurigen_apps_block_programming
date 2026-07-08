// ============================================================
// STACK LAYER: Frontend / Board Catalog
// Everything board-specific lives here: pin menus for the block
// dropdowns, ADC resolution, compile FQBN, and how the compiled
// program reaches the chip. Blocks, codegen, the simulator and
// the backend request all read from this one table.
// ============================================================

export const BOARDS = {
  esp32_devkit_v1: {
    id: 'esp32_devkit_v1',
    short: 'esp32',
    name: 'ESP32 DevKit V1',
    chip: 'ESP-WROOM-32',
    fqbn: 'esp32:esp32:esp32',
    // Strapping pins (0,2,5,12,15) intentionally absent; ADC2 pins
    // excluded because they clash with the WiFi radio.
    digitalPins: [16, 17, 25, 26, 27, 32, 33].map((p) => [`GPIO ${p}`, String(p)]),
    pwmPins: [16, 17, 25, 26, 27, 32, 33].map((p) => [`GPIO ${p}`, String(p)]),
    adcPins: [
      ['GPIO 32', '32'], ['GPIO 33', '33'],
      ['GPIO 34 (input only)', '34'], ['GPIO 35 (input only)', '35'],
      ['GPIO 36 (input only)', '36'], ['GPIO 39 (input only)', '39'],
    ],
    adcMax: 4095,
    hasWifi: true,
    flashMethod: 'esptool',   // true browser flashing over Web Serial
    pinLabel: (pin) => `GPIO ${pin}`,
  },

  arduino_uno_r3: {
    id: 'arduino_uno_r3',
    short: 'uno',
    name: 'Arduino Uno R3',
    chip: 'ATmega328P',
    fqbn: 'arduino:avr:uno',
    // D0/D1 are the hardware serial pins — off the menu on purpose.
    digitalPins: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((p) => [`D${p}`, String(p)]),
    pwmPins: [3, 5, 6, 9, 10, 11].map((p) => [`D${p} (PWM)`, String(p)]),
    adcPins: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map((p) => [p, p]),
    adcMax: 1023,
    hasWifi: false,
    flashMethod: 'hex',       // STK500v1 over Web Serial (useAvrFlash); .hex download fallback
    pinLabel: (pin) => (String(pin).startsWith('A') ? String(pin) : `D${pin}`),
  },
};

export const DEFAULT_BOARD_ID = 'esp32_devkit_v1';

export function getBoard(id) {
  return BOARDS[id] ?? BOARDS[DEFAULT_BOARD_ID];
}
