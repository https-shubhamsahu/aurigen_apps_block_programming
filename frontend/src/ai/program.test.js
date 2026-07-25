import { describe, it, expect } from 'vitest';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as en from 'blockly/msg/en';
import { cppGenerator } from '../blockly/cppGenerator.js';
import { setActiveBoard } from '../blockly/esp32Blocks.js';
import { compileProgram, extractProgramJson } from './program.js';

Blockly.setLocale(en);

/** Full pipeline: AI JSON → our XML → real Blockly workspace → C++. */
function toCpp(json, boardId) {
  setActiveBoard(boardId);
  const { xml } = compileProgram(json, boardId);
  const ws = new Blockly.Workspace();
  try {
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
    return cppGenerator.workspaceToCode(ws);
  } finally {
    ws.dispose();
  }
}

describe('AI program compiler', () => {
  it('compiles a blink program that loads into Blockly and generates C++', () => {
    const cpp = toCpp({
      program: [
        { block: 'digital_write', pin: '13', state: 'HIGH' },
        { block: 'delay', ms: 500 },
        { block: 'digital_write', pin: '13', state: 'LOW' },
        { block: 'delay', ms: 500 },
      ],
    }, 'arduino_uno_r3');
    expect(cpp).toContain('digitalWrite(13, HIGH);');
    expect(cpp).toContain('delay(500);');
    expect(cpp).toContain('pinMode(13, OUTPUT);');
  });

  it('compiles nested control flow with variables and sensors', () => {
    const cpp = toCpp({
      program: [
        { block: 'set_var', name: 'level', value: { analog_read: 'A0' } },
        {
          block: 'if',
          branches: [{
            cond: { compare: { op: 'GT', a: { var: 'level' }, b: 500 } },
            do: [{ block: 'pwm_write', pin: '9', duty: { math: { op: 'DIVIDE', a: { var: 'level' }, b: 4 } } }],
          }],
          else: [{ block: 'digital_write', pin: '13', state: 'LOW' }],
        },
      ],
    }, 'arduino_uno_r3');
    expect(cpp).toContain('float level = 0;');
    expect(cpp).toContain('level = analogRead(A0);');
    expect(cpp).toContain('if (level > 500)');
    expect(cpp).toContain('analogWrite(9,');
  });

  it('rejects pins that do not exist on the board', () => {
    expect(() => compileProgram({ program: [{ block: 'digital_write', pin: '99', state: 'HIGH' }] }, 'arduino_uno_r3'))
      .toThrow(/not a valid digital pin/i);
    // GPIO 2 is a strapping pin — deliberately not offered on our ESP32 menus
    expect(() => compileProgram({ program: [{ block: 'digital_write', pin: '2', state: 'HIGH' }] }, 'esp32_devkit_v1'))
      .toThrow(/not a valid digital pin/i);
  });

  it('rejects WiFi on the Uno, unknown blocks, and bad variable names', () => {
    expect(() => compileProgram({ program: [{ block: 'wifi_connect', ssid: 'x', pass: 'y' }] }, 'arduino_uno_r3'))
      .toThrow(/no WiFi/i);
    expect(() => compileProgram({ program: [{ block: 'rm_rf' }] }, 'arduino_uno_r3'))
      .toThrow(/Unknown block/i);
    expect(() => compileProgram({ program: [{ block: 'set_var', name: '1; system("x")', value: 1 }] }, 'arduino_uno_r3'))
      .toThrow(/not a valid variable name/i);
  });

  it('enforces size and depth caps', () => {
    const many = { program: Array.from({ length: 200 }, () => ({ block: 'delay', ms: 1 })) };
    expect(() => compileProgram(many, 'arduino_uno_r3')).toThrow(/too long/i);

    let nested = [{ block: 'delay', ms: 1 }];
    for (let i = 0; i < 10; i++) nested = [{ block: 'repeat', times: 2, do: nested }];
    expect(() => compileProgram({ program: nested }, 'arduino_uno_r3')).toThrow(/too deep/i);
  });

  it('contains XML-hostile text inside one field instead of letting it inject blocks', () => {
    const PAYLOAD = '</field><script>alert(1)</script>';
    setActiveBoard('arduino_uno_r3');
    const { xml, blockCount } = compileProgram({
      program: [{ block: 'serial_print', value: PAYLOAD }],
    }, 'arduino_uno_r3');

    // The payload must be escaped, never present as live markup.
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
    expect(blockCount).toBe(1);

    // Structural proof it didn't break out: exactly the two blocks we asked
    // for (serial_print + its text operand), and the field round-trips whole.
    const ws = new Blockly.Workspace();
    try {
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), ws);
      const types = ws.getAllBlocks(false).map((b) => b.type).sort();
      expect(types).toEqual(['esp32_serial_print', 'text']);
      expect(ws.getAllBlocks(false).find((b) => b.type === 'text').getFieldValue('TEXT'))
        .toBe(PAYLOAD);
    } finally {
      ws.dispose();
    }

    // The payload surviving into the generated C++ is correct, not a leak: it
    // is a string literal printed over a serial cable, not markup in a DOM.
    // What matters is that it stays one quoted argument to one println.
    const cpp = toCpp({
      program: [{ block: 'serial_print', value: PAYLOAD }],
    }, 'arduino_uno_r3');
    expect(cpp).toContain(`Serial.println("${PAYLOAD}");`);
  });

  it('extractProgramJson digs JSON out of fenced and prose-wrapped replies', () => {
    const fenced = 'Here you go!\n```aurigen-program\n{"program":[{"block":"delay","ms":10}]}\n```\nEnjoy!';
    expect(extractProgramJson(fenced).program[0].ms).toBe(10);
    const prose = 'Sure: {"program":[{"block":"delay","ms":7}]} — that waits 7ms.';
    expect(extractProgramJson(prose).program[0].ms).toBe(7);
    expect(() => extractProgramJson('no json here')).toThrow();
  });
});
