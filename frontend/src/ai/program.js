// ============================================================
// STACK LAYER: Frontend / AI — Program Schema
// The safety boundary between the model and the workspace.
// AI never writes Blockly XML: it emits this small JSON dialect,
// we VALIDATE it (whitelisted ops, board-legal pins, depth and
// size caps) and compile it to Blockly XML deterministically.
// A bad program is rejected with a reason — it can never load
// garbage into a student's workspace.
//
// Statement forms (all validated):
//   {"block":"digital_write","pin":"13","state":"HIGH"}
//   {"block":"pwm_write","pin":"9","duty":<value>}
//   {"block":"delay","ms":500}
//   {"block":"serial_print","value":<value>}
//   {"block":"set_var","name":"x","value":<value>}
//   {"block":"change_var","name":"x","by":<value>}
//   {"block":"repeat","times":<value>,"do":[...]}
//   {"block":"while","mode":"WHILE"|"UNTIL","cond":<value>,"do":[...]}
//   {"block":"if","branches":[{"cond":<value>,"do":[...]}],"else":[...]}
//   {"block":"wifi_connect","ssid":"...","pass":"..."}   (ESP32 only)
//
// Value forms:
//   42 | true | "text"
//   {"var":"x"} | {"analog_read":"A0"} | {"digital_read":"4"}
//   {"math":{"op":"ADD|MINUS|MULTIPLY|DIVIDE","a":<v>,"b":<v>}}
//   {"compare":{"op":"EQ|NEQ|LT|LTE|GT|GTE","a":<v>,"b":<v>}}
//   {"logic":{"op":"AND|OR","a":<v>,"b":<v>}} | {"not":<v>}
// ============================================================
import { getBoard } from '../boards/boards';

const MAX_STATEMENTS = 120;
const MAX_DEPTH = 6;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

class Ctx {
  constructor(board) {
    this.board = board;
    this.count = 0;
    this.vars = new Set();
    this.digital = new Set(board.digitalPins.map(([, v]) => v));
    this.pwm = new Set(board.pwmPins.map(([, v]) => v));
    this.adc = new Set(board.adcPins.map(([, v]) => v));
  }
  bump() {
    if (++this.count > MAX_STATEMENTS) throw new Error(`Program too long (max ${MAX_STATEMENTS} blocks).`);
  }
}

/**
 * Validate + compile an AI-emitted program to Blockly workspace XML.
 * @returns {{ xml: string, varCount: number, blockCount: number }}
 * @throws  Error with a human-readable reason when the program is invalid.
 */
export function compileProgram(json, boardId) {
  const board = getBoard(boardId);
  if (!json || !Array.isArray(json.program)) {
    throw new Error('Expected { "program": [ ...blocks ] }.');
  }
  const ctx = new Ctx(board);
  const body = chain(json.program, ctx, 0);

  const varsXml = [...ctx.vars]
    .map((v) => `<variable id="${esc(v)}">${esc(v)}</variable>`)
    .join('');
  const xml =
    `<xml xmlns="https://developers.google.com/blockly/xml">` +
    (varsXml ? `<variables>${varsXml}</variables>` : '') +
    (body ? wrapAt(body, 40, 40) : '') +
    `</xml>`;
  return { xml, varCount: ctx.vars.size, blockCount: ctx.count };
}

// Position only the first block of the top-level chain.
function wrapAt(blockXml, x, y) {
  return blockXml.replace('<block ', `<block x="${x}" y="${y}" `);
}

/**
 * Splice `<next>` in before a block's OWN closing tag.
 * Must anchor on the last `</block>`, not the first: a block carrying nested
 * children (an `if` with a `<statement>`, or any block with a `<value>`) closes
 * those children first, so the first `</block>` belongs to a descendant. Hanging
 * the chain there attaches it to something with no next connection — Blockly
 * fails the load outright with "Next statement does not exist."
 * Field text is XML-escaped upstream, so a literal `</block>` can't appear.
 */
function spliceNext(blockXml, nextXml) {
  const close = blockXml.lastIndexOf('</block>');
  return `${blockXml.slice(0, close)}<next>${nextXml}</next>${blockXml.slice(close)}`;
}

/** Compile a statement list into a nested <block>…<next>…</next></block> chain. */
function chain(list, ctx, depth) {
  if (depth > MAX_DEPTH) throw new Error(`Nesting too deep (max ${MAX_DEPTH}).`);
  if (!Array.isArray(list)) throw new Error('Statement list must be an array.');
  let out = '';
  for (let i = list.length - 1; i >= 0; i--) {
    const inner = statement(list[i], ctx, depth);
    out = out ? spliceNext(inner, out) : inner;
  }
  return out;
}

function statement(s, ctx, depth) {
  if (!s || typeof s !== 'object' || typeof s.block !== 'string') {
    throw new Error(`Not a valid block: ${JSON.stringify(s).slice(0, 80)}`);
  }
  ctx.bump();
  switch (s.block) {
    case 'digital_write': {
      const pin = pinCheck(s.pin, ctx.digital, 'digital', ctx);
      const state = s.state === 'LOW' ? 'LOW' : 'HIGH';
      return `<block type="esp32_digital_write"><field name="PIN">${esc(pin)}</field><field name="STATE">${state}</field></block>`;
    }
    case 'pwm_write': {
      const pin = pinCheck(s.pin, ctx.pwm, 'PWM', ctx);
      return `<block type="esp32_pwm_write"><field name="PIN">${esc(pin)}</field><value name="DUTY">${value(s.duty ?? 128, ctx, depth)}</value></block>`;
    }
    case 'delay': {
      const ms = Math.max(0, Math.min(600_000, Math.round(Number(s.ms))));
      if (!Number.isFinite(ms)) throw new Error('delay needs a numeric "ms".');
      return `<block type="esp32_delay"><field name="MS">${ms}</field></block>`;
    }
    case 'serial_print':
      return `<block type="esp32_serial_print"><value name="TEXT">${value(s.value ?? '', ctx, depth)}</value></block>`;
    case 'set_var': {
      const name = varCheck(s.name, ctx);
      return `<block type="variables_set"><field name="VAR" id="${esc(name)}">${esc(name)}</field><value name="VALUE">${value(s.value ?? 0, ctx, depth)}</value></block>`;
    }
    case 'change_var': {
      const name = varCheck(s.name, ctx);
      return `<block type="math_change"><field name="VAR" id="${esc(name)}">${esc(name)}</field><value name="DELTA">${value(s.by ?? 1, ctx, depth)}</value></block>`;
    }
    case 'repeat':
      return `<block type="controls_repeat_ext"><value name="TIMES">${value(s.times ?? 1, ctx, depth)}</value>` +
        stmtInput('DO', s.do, ctx, depth) + `</block>`;
    case 'while': {
      const mode = s.mode === 'UNTIL' ? 'UNTIL' : 'WHILE';
      return `<block type="controls_whileUntil"><field name="MODE">${mode}</field>` +
        `<value name="BOOL">${value(s.cond ?? true, ctx, depth)}</value>` +
        stmtInput('DO', s.do, ctx, depth) + `</block>`;
    }
    case 'if': {
      const branches = Array.isArray(s.branches) && s.branches.length ? s.branches : null;
      if (!branches) throw new Error('if needs a non-empty "branches" array.');
      const extra = branches.length - 1;
      const hasElse = Array.isArray(s.else) && s.else.length > 0;
      let xml = `<block type="controls_if">`;
      if (extra > 0 || hasElse) {
        xml += `<mutation elseif="${extra}" else="${hasElse ? 1 : 0}"></mutation>`;
      }
      branches.forEach((b, i) => {
        xml += `<value name="IF${i}">${value(b.cond ?? true, ctx, depth)}</value>`;
        xml += stmtInput(`DO${i}`, b.do, ctx, depth);
      });
      if (hasElse) xml += stmtInput('ELSE', s.else, ctx, depth);
      return xml + `</block>`;
    }
    case 'wifi_connect': {
      if (!ctx.board.hasWifi) throw new Error(`${ctx.board.name} has no WiFi — drop the wifi_connect block.`);
      return `<block type="esp32_wifi_connect"><field name="SSID">${esc(s.ssid ?? 'WiFi')}</field><field name="PASS">${esc(s.pass ?? '')}</field></block>`;
    }
    default:
      throw new Error(`Unknown block type "${s.block}".`);
  }
}

function stmtInput(name, list, ctx, depth) {
  const inner = Array.isArray(list) && list.length ? chain(list, ctx, depth + 1) : '';
  return inner ? `<statement name="${name}">${inner}</statement>` : '';
}

function value(v, ctx, depth) {
  if (depth > MAX_DEPTH) throw new Error(`Expression nesting too deep (max ${MAX_DEPTH}).`);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Numbers must be finite.');
    return `<block type="math_number"><field name="NUM">${v}</field></block>`;
  }
  if (typeof v === 'boolean') {
    return `<block type="logic_boolean"><field name="BOOL">${v ? 'TRUE' : 'FALSE'}</field></block>`;
  }
  if (typeof v === 'string') {
    return `<block type="text"><field name="TEXT">${esc(v)}</field></block>`;
  }
  if (v && typeof v === 'object') {
    if (typeof v.var === 'string') {
      const name = varCheck(v.var, ctx);
      return `<block type="variables_get"><field name="VAR" id="${esc(name)}">${esc(name)}</field></block>`;
    }
    if (v.analog_read !== undefined) {
      const pin = pinCheck(v.analog_read, ctx.adc, 'analog', ctx);
      return `<block type="esp32_analog_read"><field name="PIN">${esc(pin)}</field></block>`;
    }
    if (v.digital_read !== undefined) {
      const pin = pinCheck(v.digital_read, ctx.digital, 'digital', ctx);
      return `<block type="esp32_digital_read"><field name="PIN">${esc(pin)}</field></block>`;
    }
    if (v.math) return binary('math_arithmetic', 'OP', ['ADD', 'MINUS', 'MULTIPLY', 'DIVIDE'], v.math, ctx, depth);
    if (v.compare) return binary('logic_compare', 'OP', ['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE'], v.compare, ctx, depth);
    if (v.logic) return binary('logic_operation', 'OP', ['AND', 'OR'], v.logic, ctx, depth);
    if (v.not !== undefined) {
      return `<block type="logic_negate"><value name="BOOL">${value(v.not, ctx, depth + 1)}</value></block>`;
    }
  }
  throw new Error(`Not a valid value: ${JSON.stringify(v).slice(0, 80)}`);
}

function binary(type, opField, ops, spec, ctx, depth) {
  const op = ops.includes(spec.op) ? spec.op : ops[0];
  return `<block type="${type}"><field name="${opField}">${op}</field>` +
    `<value name="A">${value(spec.a ?? 0, ctx, depth + 1)}</value>` +
    `<value name="B">${value(spec.b ?? 0, ctx, depth + 1)}</value></block>`;
}

function pinCheck(pin, allowed, kind, ctx) {
  const p = String(pin);
  if (!allowed.has(p)) {
    throw new Error(`Pin "${p}" is not a valid ${kind} pin on the ${ctx.board.name}. Valid: ${[...allowed].join(', ')}.`);
  }
  return p;
}

function varCheck(name, ctx) {
  const n = String(name ?? '').trim().slice(0, 30);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
    throw new Error(`"${name}" is not a valid variable name (letters, digits, _).`);
  }
  ctx.vars.add(n);
  return n;
}

/** Pull the first JSON object out of a model reply (handles code fences). */
export function extractProgramJson(text) {
  const fence = /```(?:aurigen-program|json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('No JSON found in the response.');
  // Walk to the matching close brace so trailing prose doesn't break parsing.
  let level = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') level++;
    else if (candidate[i] === '}' && --level === 0) {
      return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON in the response.');
}
