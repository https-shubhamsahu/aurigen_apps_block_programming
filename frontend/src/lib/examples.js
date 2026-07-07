// ============================================================
// STACK LAYER: Frontend / Starter Examples
// MakeCode-style gallery cards: each opens the editor preloaded
// with a small program. XML uses the shared block types, so an
// example only lists boards whose pins it references.
// ============================================================

const X = (inner) => `<xml xmlns="https://developers.google.com/blockly/xml">${inner}</xml>`;

export const EXAMPLES = [
  {
    id: 'esp32_blink',
    title: 'Blink',
    emoji: '💡',
    blurb: 'The hardware hello-world: LED on GPIO 16.',
    board: 'esp32_devkit_v1',
    xml: X(
      '<block type="esp32_digital_write" x="30" y="30"><field name="PIN">16</field><field name="STATE">HIGH</field>' +
      '<next><block type="esp32_delay"><field name="MS">500</field>' +
      '<next><block type="esp32_digital_write"><field name="PIN">16</field><field name="STATE">LOW</field>' +
      '<next><block type="esp32_delay"><field name="MS">500</field></block></next></block></next></block></next></block>'
    ),
  },
  {
    id: 'esp32_button',
    title: 'Push the button',
    emoji: '🔘',
    blurb: 'Button on GPIO 17 lights the LED on GPIO 16.',
    board: 'esp32_devkit_v1',
    xml: X(
      '<block type="controls_if" x="30" y="30"><mutation else="1"></mutation>' +
      '<value name="IF0"><block type="logic_negate"><value name="BOOL"><block type="esp32_digital_read"><field name="PIN">17</field></block></value></block></value>' +
      '<statement name="DO0"><block type="esp32_digital_write"><field name="PIN">16</field><field name="STATE">HIGH</field></block></statement>' +
      '<statement name="ELSE"><block type="esp32_digital_write"><field name="PIN">16</field><field name="STATE">LOW</field></block></statement>' +
      '</block>'
    ),
  },
  {
    id: 'esp32_breathe',
    title: 'Breathing LED',
    emoji: '🌬️',
    blurb: 'PWM fades GPIO 25 up and down with a variable.',
    board: 'esp32_devkit_v1',
    xml: X(
      '<variables><variable id="lvl">level</variable></variables>' +
      '<block type="variables_set" x="30" y="30"><field name="VAR" id="lvl">level</field>' +
      '<value name="VALUE"><block type="math_number"><field name="NUM">0</field></block></value>' +
      '<next><block type="controls_repeat_ext"><value name="TIMES"><shadow type="math_number"><field name="NUM">25</field></shadow></value>' +
      '<statement name="DO"><block type="math_change"><field name="VAR" id="lvl">level</field>' +
      '<value name="DELTA"><shadow type="math_number"><field name="NUM">10</field></shadow></value>' +
      '<next><block type="esp32_pwm_write"><field name="PIN">25</field>' +
      '<value name="DUTY"><block type="variables_get"><field name="VAR" id="lvl">level</field></block></value>' +
      '<next><block type="esp32_delay"><field name="MS">40</field></block></next></block></next></block></statement>' +
      '</block></next></block>'
    ),
  },
  {
    id: 'esp32_wifi',
    title: 'WiFi hello',
    emoji: '📶',
    blurb: 'Join the classroom network, then report over serial.',
    board: 'esp32_devkit_v1',
    xml: X(
      '<block type="esp32_wifi_connect" x="30" y="30"><field name="SSID">ClassroomWiFi</field><field name="PASS">password</field>' +
      '<next><block type="esp32_serial_print"><value name="TEXT"><shadow type="text"><field name="TEXT">still alive!</field></shadow></value>' +
      '<next><block type="esp32_delay"><field name="MS">1000</field></block></next></block></next></block>'
    ),
  },
  {
    id: 'uno_blink',
    title: 'Blink the L LED',
    emoji: '💡',
    blurb: 'D13 drives the on-board L LED — no wiring needed.',
    board: 'arduino_uno_r3',
    xml: X(
      '<block type="esp32_digital_write" x="30" y="30"><field name="PIN">13</field><field name="STATE">HIGH</field>' +
      '<next><block type="esp32_delay"><field name="MS">500</field>' +
      '<next><block type="esp32_digital_write"><field name="PIN">13</field><field name="STATE">LOW</field>' +
      '<next><block type="esp32_delay"><field name="MS">500</field></block></next></block></next></block></next></block>'
    ),
  },
  {
    id: 'uno_button',
    title: 'Push the button',
    emoji: '🔘',
    blurb: 'Button on D2 lights the L LED on D13.',
    board: 'arduino_uno_r3',
    xml: X(
      '<block type="controls_if" x="30" y="30"><mutation else="1"></mutation>' +
      '<value name="IF0"><block type="logic_negate"><value name="BOOL"><block type="esp32_digital_read"><field name="PIN">2</field></block></value></block></value>' +
      '<statement name="DO0"><block type="esp32_digital_write"><field name="PIN">13</field><field name="STATE">HIGH</field></block></statement>' +
      '<statement name="ELSE"><block type="esp32_digital_write"><field name="PIN">13</field><field name="STATE">LOW</field></block></statement>' +
      '</block>'
    ),
  },
  {
    id: 'uno_fade',
    title: 'Knob → brightness',
    emoji: '🎛️',
    blurb: 'A0 reading (0–1023) dims the LED on D9 with PWM.',
    board: 'arduino_uno_r3',
    xml: X(
      '<block type="esp32_pwm_write" x="30" y="30"><field name="PIN">9</field>' +
      '<value name="DUTY"><block type="math_arithmetic"><field name="OP">DIVIDE</field>' +
      '<value name="A"><block type="esp32_analog_read"><field name="PIN">A0</field></block></value>' +
      '<value name="B"><block type="math_number"><field name="NUM">4</field></block></value></block></value>' +
      '<next><block type="esp32_delay"><field name="MS">20</field></block></next></block>'
    ),
  },
];
