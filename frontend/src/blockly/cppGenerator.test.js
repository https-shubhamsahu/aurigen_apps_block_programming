import { describe, it, expect, beforeEach } from 'vitest';
import * as Blockly from 'blockly/core';
import 'blockly/blocks'; // stock block definitions (variables, text, loops…)
import * as en from 'blockly/msg/en'; // block message templates
import { cppGenerator } from './cppGenerator.js';

Blockly.setLocale(en);
import { setActiveBoard } from './esp32Blocks.js'; // side effect: registers all blocks

/** Build a headless workspace from serialization JSON and generate C++. */
function generate(blocks, boardId) {
  setActiveBoard(boardId);
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws);
    return cppGenerator.workspaceToCode(ws);
  } finally {
    ws.dispose();
  }
}

const num = (n) => ({ block: { type: 'math_number', fields: { NUM: n } } });

describe('Arduino C++ generation', () => {
  beforeEach(() => setActiveBoard('esp32_devkit_v1'));

  it('emits a complete sketch skeleton', () => {
    const code = generate([], 'esp32_devkit_v1');
    expect(code).toContain('void setup() {');
    expect(code).toContain('Serial.begin(115200);');
    expect(code).toContain('void loop() {');
  });

  it('hoists pinMode into setup() exactly once per pin', () => {
    const code = generate([{
      type: 'esp32_digital_write', fields: { PIN: '16', STATE: 'HIGH' },
      next: { block: { type: 'esp32_digital_write', fields: { PIN: '16', STATE: 'LOW' } } },
    }], 'esp32_devkit_v1');
    expect(code.match(/pinMode\(16, OUTPUT\);/g)).toHaveLength(1);
    expect(code).toContain('digitalWrite(16, HIGH);');
    expect(code).toContain('digitalWrite(16, LOW);');
  });

  it('ESP32 PWM uses LEDC; Uno PWM uses analogWrite', () => {
    const pwm = (pin) => [{ type: 'esp32_pwm_write', fields: { PIN: pin }, inputs: { DUTY: num(128) } }];
    expect(generate(pwm('25'), 'esp32_devkit_v1')).toContain('ledcSetup(0, 5000, 8);');
    expect(generate(pwm('9'), 'arduino_uno_r3')).toContain('analogWrite(9, constrain(128, 0, 255));');
  });

  it('allocates LEDC channels deterministically across regenerations', () => {
    const two = [{
      type: 'esp32_pwm_write', fields: { PIN: '25' }, inputs: { DUTY: num(10) },
      next: { block: { type: 'esp32_pwm_write', fields: { PIN: '26' }, inputs: { DUTY: num(20) } } },
    }];
    const first = generate(two, 'esp32_devkit_v1');
    const second = generate(two, 'esp32_devkit_v1'); // fresh generation, same program
    expect(first).toBe(second);
    expect(first).toContain('ledcAttachPin(25, 0);');
    expect(first).toContain('ledcAttachPin(26, 1);');
  });

  it('hoists variables as float globals and escapes text strings', () => {
    const code = generate([{
      type: 'variables_set',
      fields: { VAR: { name: 'score' } },
      inputs: { VALUE: num(5) },
      next: { block: {
        type: 'esp32_serial_print',
        inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'say "hi" \\ bye' } } } },
      } },
    }], 'arduino_uno_r3');
    expect(code).toContain('float score = 0;');
    expect(code).toContain('score = 5;');
    expect(code).toContain('Serial.println("say \\"hi\\" \\\\ bye");');
  });

  it('WiFi block generates setup-side boilerplate with escaped credentials', () => {
    const code = generate([{
      type: 'esp32_wifi_connect', fields: { SSID: 'My "Net"', PASS: 'p\\w' },
    }], 'esp32_devkit_v1');
    expect(code).toContain('#include <WiFi.h>');
    expect(code).toContain('WiFi.begin("My \\"Net\\"", "p\\\\w");');
  });
});
