// ============================================================
// STACK LAYER: Frontend / Visual Logic Engine
// Block definitions + C++ generators for BOTH board targets.
// Pin dropdowns are DYNAMIC: they read the active board config
// (set via setActiveBoard before Blockly.inject), so the same
// block types serve the ESP32 DevKit V1 and the Arduino Uno R3.
//
// Per-board rules encoded here:
//  * ESP32 — strapping pins (0,2,5,12,15) never offered; ADC is
//    ADC1-only (GPIO 32–39, 12-bit 0–4095) because ADC2 clashes
//    with WiFi; PWM = LEDC peripheral (no analogWrite on core 2.x).
//  * Uno — D0/D1 reserved for hardware serial; PWM only on the
//    ~ pins (3,5,6,9,10,11) via analogWrite; ADC A0–A5, 0–1023.
//  * Block type names keep the legacy esp32_ prefix so projects
//    saved before multi-board support still load.
// ============================================================
import * as Blockly from 'blockly/core';
import { cppGenerator, Order } from './cppGenerator';
import { BOARDS, getBoard, DEFAULT_BOARD_ID } from '../boards/boards';

let activeBoard = BOARDS[DEFAULT_BOARD_ID];
export function setActiveBoard(boardId) { activeBoard = getBoard(boardId); }
export function getActiveBoard() { return activeBoard; }

// MakeCode-style category palette (block chrome stays colorful;
// app chrome stays yellow/white per brand).
export const CAT = {
  basic: '#1E90FF',
  pins: '#E8590C',
  connectivity: '#E3008C',
  loops: '#107C10',
  logic: '#006970',
  variables: '#DC143C',
  math: '#712672',
};

// LEDC has 16 channels; hand them out per unique pin, deterministically.
const ledcChannelForPin = (() => {
  const map = new Map();
  return (pin) => {
    if (!map.has(pin)) map.set(pin, map.size % 16);
    return map.get(pin);
  };
})();

// ---- Hardware blocks (dynamic dropdowns → JS-style definitions) ----

Blockly.Blocks['esp32_digital_write'] = {
  init() {
    this.appendDummyInput()
      .appendField('set pin')
      .appendField(new Blockly.FieldDropdown(() => activeBoard.digitalPins), 'PIN')
      .appendField('to')
      .appendField(new Blockly.FieldDropdown([['HIGH', 'HIGH'], ['LOW', 'LOW']]), 'STATE');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(CAT.pins);
    this.setTooltip('Write HIGH or LOW to a safe pin. Boot/serial-critical pins are not listed.');
  },
};

Blockly.Blocks['esp32_digital_read'] = {
  init() {
    this.appendDummyInput()
      .appendField('read pin')
      .appendField(new Blockly.FieldDropdown(() => activeBoard.digitalPins), 'PIN');
    this.setOutput(true, 'Boolean');
    this.setColour(CAT.pins);
    this.setTooltip('Reads HIGH/LOW (pin is configured as INPUT_PULLUP: idle HIGH, pressed LOW).');
  },
};

Blockly.Blocks['esp32_analog_read'] = {
  init() {
    this.appendDummyInput()
      .appendField('analog value of')
      .appendField(new Blockly.FieldDropdown(() => activeBoard.adcPins), 'PIN');
    this.setOutput(true, 'Number');
    this.setColour(CAT.pins);
    this.setTooltip(() => `Reads 0–${activeBoard.adcMax} (${activeBoard.name} ADC).`);
  },
};

Blockly.Blocks['esp32_pwm_write'] = {
  init() {
    this.appendValueInput('DUTY')
      .setCheck('Number')
      .appendField('set PWM on pin')
      .appendField(new Blockly.FieldDropdown(() => activeBoard.pwmPins), 'PIN')
      .appendField('to');
    this.appendDummyInput().appendField('(0–255)');
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(CAT.pins);
    this.setTooltip(() =>
      activeBoard.short === 'uno'
        ? 'Hardware PWM via analogWrite on the ~ pins.'
        : 'Hardware PWM via the ESP32 LEDC peripheral (5 kHz, 8-bit).');
  },
};

// ---- Simple blocks (JSON definitions) -----------------------------

Blockly.defineBlocksWithJsonArray([
  {
    type: 'esp32_wifi_connect',
    message0: 'connect to WiFi %1 network %2 %3 password %4',
    args0: [
      { type: 'input_dummy' },
      { type: 'field_input', name: 'SSID', text: 'ClassroomWiFi' },
      { type: 'input_dummy' },
      { type: 'field_input', name: 'PASS', text: 'password' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: CAT.connectivity,
    tooltip: 'ESP32 only: generates the WiFi.h boilerplate and blocks until connected.',
  },
  {
    type: 'esp32_delay',
    message0: 'wait %1 milliseconds',
    args0: [{ type: 'field_number', name: 'MS', value: 1000, min: 0 }],
    previousStatement: null,
    nextStatement: null,
    colour: CAT.basic,
  },
  {
    type: 'esp32_serial_print',
    message0: 'serial print %1',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    previousStatement: null,
    nextStatement: null,
    colour: CAT.basic,
    tooltip: 'Prints a value to the USB serial monitor (115200 baud).',
  },
]);

// ---- C++ generators ---------------------------------------------

cppGenerator.forBlock['esp32_digital_write'] = function (block, gen) {
  const pin = block.getFieldValue('PIN');
  const state = block.getFieldValue('STATE');
  gen.addSetup(`pinmode_out_${pin}`, `pinMode(${pin}, OUTPUT);`);
  return `digitalWrite(${pin}, ${state});\n`;
};

cppGenerator.forBlock['esp32_digital_read'] = function (block, gen) {
  const pin = block.getFieldValue('PIN');
  gen.addSetup(`pinmode_in_${pin}`, `pinMode(${pin}, INPUT_PULLUP);`);
  return [`digitalRead(${pin})`, Order.ATOMIC];
};

cppGenerator.forBlock['esp32_analog_read'] = function (block) {
  // ESP32: 12-bit (0–4095), Uno: 10-bit (0–1023). A0… names are
  // valid Arduino constants, so the value emits directly.
  const pin = block.getFieldValue('PIN');
  return [`analogRead(${pin})`, Order.ATOMIC];
};

cppGenerator.forBlock['esp32_pwm_write'] = function (block, gen) {
  const pin = block.getFieldValue('PIN');
  const duty = gen.valueToCode(block, 'DUTY', Order.NONE) || '0';

  if (activeBoard.short === 'uno') {
    gen.addSetup(`pinmode_out_${pin}`, `pinMode(${pin}, OUTPUT);`);
    return `analogWrite(${pin}, constrain(${duty}, 0, 255));\n`;
  }

  // ESP32: LEDC init hoisted into setup() once per pin —
  //   ledcSetup(channel, 5000 Hz, 8-bit) → duty range 0–255
  const ch = ledcChannelForPin(pin);
  gen.addSetup(
    `ledc_${pin}`,
    `ledcSetup(${ch}, 5000, 8);\nledcAttachPin(${pin}, ${ch});`
  );
  return `ledcWrite(${ch}, constrain(${duty}, 0, 255));\n`;
};

cppGenerator.forBlock['esp32_wifi_connect'] = function (block, gen) {
  // Escape quotes/backslashes so credentials can't break the sketch.
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const ssid = esc(block.getFieldValue('SSID'));
  const pass = esc(block.getFieldValue('PASS'));

  gen.addInclude('wifi', '#include <WiFi.h>');
  gen.addSetup(
    'wifi_connect',
    [
      `WiFi.begin("${ssid}", "${pass}");`,
      'Serial.print("Connecting to WiFi");',
      'unsigned long wifiStart = millis();',
      'while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 15000) {',
      '  delay(500);',
      '  Serial.print(".");',
      '}',
      'Serial.println(WiFi.status() == WL_CONNECTED ? "\\nConnected!" : "\\nWiFi failed — check credentials.");',
    ].join('\n')
  );
  return ''; // the work happens in setup(); the block itself emits no loop code
};

cppGenerator.forBlock['esp32_delay'] = function (block) {
  return `delay(${block.getFieldValue('MS')});\n`;
};

cppGenerator.forBlock['esp32_serial_print'] = function (block, gen) {
  const v = gen.valueToCode(block, 'TEXT', Order.NONE) || '""';
  return `Serial.println(${v});\n`;
};

// ---- Stock-block generators (loops / logic / vars / math / text) --

cppGenerator.forBlock['math_number'] = (block) =>
  [String(block.getFieldValue('NUM')), Order.ATOMIC];

cppGenerator.forBlock['math_arithmetic'] = function (block, gen) {
  const ops = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/' };
  const op = ops[block.getFieldValue('OP')] ?? '+';
  const order = op === '+' || op === '-' ? Order.ADDITIVE : Order.MULTIPLICATIVE;
  const a = gen.valueToCode(block, 'A', order) || '0';
  const b = gen.valueToCode(block, 'B', order) || '0';
  return [`${a} ${op} ${b}`, order];
};

cppGenerator.forBlock['logic_compare'] = function (block, gen) {
  const ops = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
  const op = ops[block.getFieldValue('OP')];
  const order = op === '==' || op === '!=' ? Order.EQUALITY : Order.RELATIONAL;
  const a = gen.valueToCode(block, 'A', order) || '0';
  const b = gen.valueToCode(block, 'B', order) || '0';
  return [`${a} ${op} ${b}`, order];
};

cppGenerator.forBlock['logic_operation'] = function (block, gen) {
  const and = block.getFieldValue('OP') === 'AND';
  const order = and ? Order.LOGICAL_AND : Order.LOGICAL_OR;
  const a = gen.valueToCode(block, 'A', order) || 'false';
  const b = gen.valueToCode(block, 'B', order) || 'false';
  return [`${a} ${and ? '&&' : '||'} ${b}`, order];
};

cppGenerator.forBlock['logic_negate'] = function (block, gen) {
  const v = gen.valueToCode(block, 'BOOL', Order.UNARY) || 'false';
  return [`!${v}`, Order.UNARY];
};

cppGenerator.forBlock['logic_boolean'] = (block) =>
  [block.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', Order.ATOMIC];

cppGenerator.forBlock['controls_if'] = function (block, gen) {
  let code = '';
  for (let n = 0; block.getInput('IF' + n); n++) {
    const cond = gen.valueToCode(block, 'IF' + n, Order.NONE) || 'false';
    const branch = gen.statementToCode(block, 'DO' + n) || '';
    code += `${n ? ' else ' : ''}if (${cond}) {\n${branch}}`;
  }
  if (block.getInput('ELSE')) {
    code += ` else {\n${gen.statementToCode(block, 'ELSE')}}`;
  }
  return code + '\n';
};

cppGenerator.forBlock['controls_repeat_ext'] = function (block, gen) {
  const times = gen.valueToCode(block, 'TIMES', Order.NONE) || '0';
  const branch = gen.statementToCode(block, 'DO') || '';
  const i = `i${gen.tmpVarCount_++}`;
  return `for (int ${i} = 0; ${i} < (int)(${times}); ${i}++) {\n${branch}}\n`;
};

cppGenerator.forBlock['controls_whileUntil'] = function (block, gen) {
  const until = block.getFieldValue('MODE') === 'UNTIL';
  const cond = gen.valueToCode(block, 'BOOL', Order.NONE) || 'false';
  const branch = gen.statementToCode(block, 'DO') || '';
  return `while (${until ? '!' : ''}(${cond})) {\n${branch}}\n`;
};

cppGenerator.forBlock['text'] = function (block) {
  const raw = block.getFieldValue('TEXT') ?? '';
  const esc = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [`"${esc}"`, Order.ATOMIC];
};

// Variables are hoisted as float globals — float covers both the
// counting and sensor-math use cases students actually hit.
function cppVarName(gen, block) {
  return gen.getVariableName(block.getFieldValue('VAR'));
}

cppGenerator.forBlock['variables_get'] = function (block, gen) {
  const name = cppVarName(gen, block);
  gen.addGlobal(`var_${name}`, `float ${name} = 0;`);
  return [name, Order.ATOMIC];
};

cppGenerator.forBlock['variables_set'] = function (block, gen) {
  const name = cppVarName(gen, block);
  const v = gen.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || '0';
  gen.addGlobal(`var_${name}`, `float ${name} = 0;`);
  return `${name} = ${v};\n`;
};

cppGenerator.forBlock['math_change'] = function (block, gen) {
  const name = cppVarName(gen, block);
  const delta = gen.valueToCode(block, 'DELTA', Order.ADDITIVE) || '0';
  gen.addGlobal(`var_${name}`, `float ${name} = 0;`);
  return `${name} += ${delta};\n`;
};

// ---- Toolbox builder (per board) ----------------------------------
const num = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });

export function buildToolbox(board) {
  return {
    kind: 'categoryToolbox',
    contents: [
      // Registered by @blockly/toolbox-search (imported in the editor shell).
      { kind: 'search', name: 'Search', contents: [] },
      {
        kind: 'category', name: 'Basic', colour: CAT.basic,
        contents: [
          { kind: 'block', type: 'esp32_delay' },
          {
            kind: 'block', type: 'esp32_serial_print',
            inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hello!' } } } },
          },
        ],
      },
      {
        kind: 'category', name: 'Pins', colour: CAT.pins,
        contents: [
          { kind: 'block', type: 'esp32_digital_write' },
          { kind: 'block', type: 'esp32_digital_read' },
          { kind: 'block', type: 'esp32_analog_read' },
          { kind: 'block', type: 'esp32_pwm_write', inputs: { DUTY: num(128) } },
        ],
      },
      // WiFi is an ESP32 capability; the Uno toolbox simply omits it.
      ...(board.hasWifi ? [{
        kind: 'category', name: 'Connectivity', colour: CAT.connectivity,
        contents: [{ kind: 'block', type: 'esp32_wifi_connect' }],
      }] : []),
      {
        kind: 'category', name: 'Loops', colour: CAT.loops,
        contents: [
          { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: num(4) } },
          { kind: 'block', type: 'controls_whileUntil' },
        ],
      },
      {
        kind: 'category', name: 'Logic', colour: CAT.logic,
        contents: [
          { kind: 'block', type: 'controls_if' },
          { kind: 'block', type: 'logic_compare', inputs: { A: num(0), B: num(0) } },
          { kind: 'block', type: 'logic_operation' },
          { kind: 'block', type: 'logic_negate' },
          { kind: 'block', type: 'logic_boolean' },
        ],
      },
      // Built-in dynamic category: "Create variable…" button + get/set/change.
      { kind: 'category', name: 'Variables', colour: CAT.variables, custom: 'VARIABLE' },
      {
        kind: 'category', name: 'Math', colour: CAT.math,
        contents: [
          { kind: 'block', type: 'math_number' },
          { kind: 'block', type: 'math_arithmetic', inputs: { A: num(1), B: num(1) } },
        ],
      },
    ],
  };
}
