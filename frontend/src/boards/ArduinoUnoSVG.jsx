// ============================================================
// STACK LAYER: Frontend / Simulator UI — Arduino Uno R3 render
// Top-down SVG of a real Uno R3: teal PCB, USB-B, barrel jack,
// ATmega328P, 16 MHz crystal, reset button, ICSP, headers with
// true pin ordering. Live behavior:
//   * written pins glow yellow at the physical header hole
//   * D13 also drives the on-board "L" LED
//   * TX LED flashes when the program serial-prints
//   * ON LED is lit while the simulation runs
//   * digitalRead pins render as clickable pads (press = LOW)
// ============================================================

// Header hole coordinates, true Uno R3 ordering.
const TOP_A = ['SCL', 'SDA', 'AREF', 'GND', '13', '12', '11', '10', '9', '8'];
const TOP_B = ['7', '6', '5', '4', '3', '2', '1', '0'];
const BOT_PWR = ['NC', 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN'];
const BOT_ADC = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

export const UNO_PIN_POS = {};
TOP_A.forEach((p, i) => { UNO_PIN_POS[p] = [124 + i * 14, 30]; });
TOP_B.forEach((p, i) => { UNO_PIN_POS[p] = [272 + i * 14, 30]; });
BOT_ADC.forEach((p, i) => { UNO_PIN_POS[p] = [286 + i * 14, 276]; });

export default function ArduinoUnoSVG({ pins = {}, running, txFlash, usage, buttons = {}, onButtonDown, onButtonUp }) {
  const level = (p) => (pins[p] ?? 0) / 255;

  const Hole = ([cx, cy]) => (
    <>
      <rect x={cx - 5} y={cy - 5} width={10} height={10} rx={1.5} fill="#1B1B1B" />
      <circle cx={cx} cy={cy} r={2.6} fill="#3D3D3D" />
    </>
  );

  return (
    <svg viewBox="0 0 420 300" style={{ width: '100%', display: 'block' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="unoPcb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12798F" />
          <stop offset="1" stopColor="#0C5F73" />
        </linearGradient>
        <linearGradient id="unoMetal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E8E8E8" />
          <stop offset="0.5" stopColor="#B9BEC4" />
          <stop offset="1" stopColor="#8F959C" />
        </linearGradient>
        <radialGradient id="unoGlow">
          <stop offset="0" stopColor="#FFE45C" stopOpacity="0.95" />
          <stop offset="1" stopColor="#FFD400" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* PCB + mounting holes */}
      <rect x="8" y="14" width="404" height="272" rx="10" fill="url(#unoPcb)" stroke="#083B47" strokeWidth="2" />
      {[[26, 60], [398, 26], [398, 250], [180, 274]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5.5" fill="#083B47" stroke="#C9CDD1" strokeWidth="2" />
      ))}

      {/* USB-B connector (overhangs left edge) */}
      <rect x="-4" y="42" width="74" height="56" rx="4" fill="url(#unoMetal)" stroke="#6E747B" />
      <rect x="-4" y="48" width="66" height="44" rx="3" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" />
      <text x="30" y="74" fontSize="9" fill="#4A4F55" fontFamily="monospace" textAnchor="middle">USB</text>

      {/* DC barrel jack */}
      <rect x="-4" y="208" width="66" height="54" rx="6" fill="#171717" stroke="#000" />
      <circle cx="60" cy="235" r="14" fill="#0A0A0A" stroke="#2E2E2E" strokeWidth="3" />
      <circle cx="60" cy="235" r="4" fill="#2A2A2A" />

      {/* voltage regulator + caps */}
      <rect x="72" y="190" width="28" height="20" rx="2" fill="#111" />
      <rect x="76" y="182" width="20" height="8" fill="#9AA0A6" />
      <circle cx="86" cy="234" r="10" fill="#C7A24C" stroke="#8A6D2B" strokeWidth="2" />
      <circle cx="112" cy="234" r="10" fill="#C7A24C" stroke="#8A6D2B" strokeWidth="2" />

      {/* 16 MHz crystal */}
      <rect x="88" y="146" width="42" height="15" rx="7.5" fill="url(#unoMetal)" stroke="#777" />
      <text x="109" y="157" fontSize="6.5" fill="#555" textAnchor="middle" fontFamily="monospace">16.000</text>

      {/* reset button */}
      <rect x="26" y="102" width="30" height="24" rx="3" fill="#D9DDE1" stroke="#9AA0A6" />
      <circle cx="41" cy="114" r="7" fill="#C0392B" stroke="#7E241A" strokeWidth="1.5" />
      <text x="41" y="137" fontSize="6.5" fill="#FFF" textAnchor="middle" fontFamily="monospace">RESET</text>

      {/* ATmega328P */}
      <rect x="196" y="196" width="178" height="36" rx="3" fill="#141414" stroke="#000" />
      <circle cx="206" cy="214" r="4" fill="#2B2B2B" />
      {[...Array(14)].map((_, i) => (
        <g key={i}>
          <rect x={200 + i * 12.4} y="190" width="5" height="7" fill="#9AA0A6" />
          <rect x={200 + i * 12.4} y="231" width="5" height="7" fill="#9AA0A6" />
        </g>
      ))}
      <text x="285" y="217" fontSize="9" fill="#8D8D8D" textAnchor="middle" fontFamily="monospace" letterSpacing="1">ATMEGA328P-PU</text>

      {/* ICSP header */}
      {[0, 1, 2].map((c) => [0, 1].map((r) => (
        <circle key={`${c}${r}`} cx={392 + r * 11} cy={146 + c * 11} r="3.4" fill="#C7A24C" stroke="#8A6D2B" />
      )))}
      <text x="397" y="188" fontSize="6.5" fill="#FFF" textAnchor="middle" fontFamily="monospace">ICSP</text>

      {/* silkscreen brand */}
      <text x="150" y="178" fontSize="17" fill="#FFF" fontWeight="700" fontFamily="Inter, sans-serif" letterSpacing="1">ARDUINO</text>
      <text x="150" y="192" fontSize="9" fill="#CFE6EC" fontFamily="Inter, sans-serif" letterSpacing="3">UNO R3</text>

      {/* status LEDs */}
      {/* ON (green, lit while sim runs) */}
      <rect x="300" y="146" width="12" height="7" rx="1" fill={running ? '#3CE05E' : '#1E4A28'} />
      {running && <circle cx="306" cy="149" r="9" fill="#3CE05E" opacity="0.25" />}
      <text x="322" y="153" fontSize="6.5" fill="#FFF" fontFamily="monospace">ON</text>

      {/* L LED — mirrors D13 */}
      <rect x="150" y="118" width="14" height="8" rx="1" style={{ transition: 'fill 130ms' }}
            fill={`rgba(255,220,60,${0.18 + level('13') * 0.82})`} stroke="#5E5522" strokeWidth="0.8" />
      {level('13') > 0.03 && <circle cx="157" cy="122" r={10 + level('13') * 8} fill="url(#unoGlow)" />}
      <text x="140" y="126" fontSize="7" fill="#FFF" fontFamily="monospace" textAnchor="end">L</text>

      {/* TX / RX LEDs */}
      <rect x="150" y="134" width="11" height="6" rx="1" fill={txFlash ? '#FFE45C' : '#4A431C'} />
      <text x="140" y="140" fontSize="6.5" fill="#FFF" fontFamily="monospace" textAnchor="end">TX</text>
      <rect x="150" y="144" width="11" height="6" rx="1" fill="#4A431C" />
      <text x="140" y="150" fontSize="6.5" fill="#FFF" fontFamily="monospace" textAnchor="end">RX</text>

      {/* headers */}
      <rect x="116" y="20" width="144" height="20" rx="2" fill="#101010" />
      <rect x="264" y="20" width="118" height="20" rx="2" fill="#101010" />
      <rect x="128" y="266" width="116" height="20" rx="2" fill="#101010" />
      <rect x="278" y="266" width="92" height="20" rx="2" fill="#101010" />
      {Object.values(UNO_PIN_POS).map((pos, i) => <g key={i}>{Hole(pos)}</g>)}
      {['NC', 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN'].map((_, i) => (
        <g key={`pwr${i}`}>{Hole([136 + i * 14, 276])}</g>
      ))}

      {/* header labels */}
      {TOP_A.map((p, i) => (
        <text key={p + i} x={124 + i * 14} y="50" fontSize="6" fill="#FFF" textAnchor="middle" fontFamily="monospace">{p}</text>
      ))}
      {TOP_B.map((p, i) => (
        <text key={p} x={272 + i * 14} y="50" fontSize="6" fill="#FFF" textAnchor="middle" fontFamily="monospace">{p}</text>
      ))}
      {BOT_PWR.map((p, i) => (
        <text key={p + i} x={136 + i * 14} y="262" fontSize="5" fill="#FFF" textAnchor="middle" fontFamily="monospace">{p}</text>
      ))}
      {BOT_ADC.map((p, i) => (
        <text key={p} x={286 + i * 14} y="262" fontSize="6" fill="#FFF" textAnchor="middle" fontFamily="monospace">{p}</text>
      ))}
      <text x="188" y="60" fontSize="7" fill="#CFE6EC" fontFamily="monospace">DIGITAL (PWM ~)</text>
      <text x="150" y="254" fontSize="7" fill="#CFE6EC" fontFamily="monospace">POWER</text>
      <text x="300" y="254" fontSize="7" fill="#CFE6EC" fontFamily="monospace">ANALOG IN</text>

      {/* ---- live overlays ---- */}
      {Object.entries(pins).map(([pin, v]) => {
        const pos = UNO_PIN_POS[pin];
        if (!pos || v == null) return null;
        const a = v / 255;
        return (
          <g key={`glow${pin}`} style={{ transition: 'opacity 130ms' }}>
            <circle cx={pos[0]} cy={pos[1]} r={9 + a * 7} fill="url(#unoGlow)" opacity={0.25 + a * 0.75}
                    style={{ transition: 'opacity 130ms' }} />
            <text x={pos[0]} y={pos[1] - 12} fontSize="7" fill="#FFE45C" textAnchor="middle" fontFamily="monospace" fontWeight="700">
              {v === 255 ? 'HIGH' : v === 0 ? 'LOW' : v}
            </text>
          </g>
        );
      })}
      {[...(usage?.buttonPins ?? [])].map((pin) => {
        const pos = UNO_PIN_POS[String(pin)];
        if (!pos) return null;
        const pressed = buttons[pin];
        return (
          <g key={`btn${pin}`} style={{ cursor: 'pointer' }}
             onMouseDown={() => onButtonDown?.(pin)} onMouseUp={() => onButtonUp?.(pin)}
             onMouseLeave={() => pressed && onButtonUp?.(pin)}>
            <circle cx={pos[0]} cy={pos[1]} r="8" fill={pressed ? '#00E5FF' : 'transparent'}
                    fillOpacity={pressed ? 0.45 : 1} stroke="#00E5FF" strokeWidth="1.6" strokeDasharray="3 2" />
          </g>
        );
      })}
      {[...(usage?.analogPins ?? [])].map((pin) => {
        const pos = UNO_PIN_POS[String(pin)];
        return pos ? (
          <circle key={`adc${pin}`} cx={pos[0]} cy={pos[1]} r="8" fill="none"
                  stroke="#7CFC7C" strokeWidth="1.6" strokeDasharray="3 2" />
        ) : null;
      })}
    </svg>
  );
}
