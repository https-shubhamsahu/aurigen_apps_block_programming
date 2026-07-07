// ============================================================
// STACK LAYER: Frontend / Simulator UI — ESP32 DevKit V1 render
// Top-down SVG of the 30-pin DevKit V1: black PCB, shielded
// ESP-WROOM-32 module with meander antenna, CP2102 bridge,
// EN/BOOT buttons, micro-USB, true header pin ordering.
// Live behavior mirrors the Uno component: written pins glow,
// read pins are clickable, power LED lights while running, the
// antenna pulses when WiFi is (virtually) connected.
// ============================================================

// True DevKit V1 header order, top → bottom.
const LEFT = ['3V3', 'GND', 'D15', 'D2', 'D4', 'RX2', 'TX2', 'D5', 'D18', 'D19', 'D21', 'RX0', 'TX0', 'D22', 'D23'];
const RIGHT = ['VIN', 'GND', 'D13', 'D12', 'D14', 'D27', 'D26', 'D25', 'D33', 'D32', 'D35', 'D34', 'VN', 'VP', 'EN'];
// Silk label → GPIO number used by the blocks.
const LABEL_TO_GPIO = {
  D2: '2', D4: '4', D5: '5', D12: '12', D13: '13', D14: '14', D15: '15', D18: '18', D19: '19',
  D21: '21', D22: '22', D23: '23', D25: '25', D26: '26', D27: '27', D32: '32', D33: '33',
  D34: '34', D35: '35', RX2: '16', TX2: '17', VN: '39', VP: '36',
};

export const ESP32_PIN_POS = {};
LEFT.forEach((label, i) => {
  const g = LABEL_TO_GPIO[label];
  if (g) ESP32_PIN_POS[g] = [34, 66 + i * 23];
});
RIGHT.forEach((label, i) => {
  const g = LABEL_TO_GPIO[label];
  if (g) ESP32_PIN_POS[g] = [226, 66 + i * 23];
});

export default function Esp32DevkitSVG({ pins = {}, running, txFlash, wifi, usage, buttons = {}, maxH, onButtonDown, onButtonUp }) {
  return (
    <svg viewBox="0 0 260 430" style={{ width: '100%', maxHeight: maxH ?? 'min(380px, 44vh)', display: 'block', margin: '0 auto' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="espShield" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#D7DBE0" />
          <stop offset="0.5" stopColor="#AEB4BB" />
          <stop offset="1" stopColor="#878D95" />
        </linearGradient>
        <radialGradient id="espGlow">
          <stop offset="0" stopColor="#FFE45C" stopOpacity="0.95" />
          <stop offset="1" stopColor="#FFD400" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* PCB */}
      <rect x="22" y="8" width="216" height="414" rx="12" fill="#16161F" stroke="#000" strokeWidth="2" />

      {/* header pins */}
      {LEFT.map((label, i) => (
        <g key={`L${i}`}>
          <rect x="27" y={61 + i * 23} width="14" height="10" rx="1.5" fill="#0A0A0A" />
          <circle cx="34" cy={66 + i * 23} r="3.4" fill="#C7A24C" stroke="#8A6D2B" strokeWidth="1" />
          <text x="48" y={69 + i * 23} fontSize="7.5" fill="#B9BEC4" fontFamily="monospace">{label}</text>
        </g>
      ))}
      {RIGHT.map((label, i) => (
        <g key={`R${i}`}>
          <rect x="219" y={61 + i * 23} width="14" height="10" rx="1.5" fill="#0A0A0A" />
          <circle cx="226" cy={66 + i * 23} r="3.4" fill="#C7A24C" stroke="#8A6D2B" strokeWidth="1" />
          <text x="212" y={69 + i * 23} fontSize="7.5" fill="#B9BEC4" fontFamily="monospace" textAnchor="end">{label}</text>
        </g>
      ))}

      {/* ESP-WROOM-32 module */}
      <rect x="62" y="14" width="136" height="140" rx="4" fill="url(#espShield)" stroke="#6E747B" />
      {/* meander antenna */}
      <path
        d="M 72 22 h 116 M 72 30 h 116 M 72 38 h 116 M 72 22 v 8 M 188 30 v 8 M 72 38 v 6"
        stroke="#5B6168" strokeWidth="3" fill="none"
      />
      {wifi === 'connected' && (
        <>
          <path d="M 118 34 a 14 14 0 0 1 24 0" stroke="#00E5FF" strokeWidth="2.5" fill="none" opacity="0.9" />
          <path d="M 111 40 a 24 24 0 0 1 38 0" stroke="#00E5FF" strokeWidth="2.5" fill="none" opacity="0.5" />
        </>
      )}
      <rect x="74" y="52" width="112" height="92" rx="3" fill="#9BA1A8" stroke="#7A8087" />
      <text x="130" y="88" fontSize="10" fill="#3F444A" textAnchor="middle" fontFamily="monospace" fontWeight="700">ESP-WROOM-32</text>
      <text x="130" y="102" fontSize="6.5" fill="#575D64" textAnchor="middle" fontFamily="monospace">FCC ID: 2AC7Z-ESPWROOM32</text>
      <circle cx="84" cy="132" r="3" fill="#6E747B" />

      {/* silk brand */}
      <text x="130" y="176" fontSize="11" fill="#EEE" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700" letterSpacing="1.5">
        ESP32 DEVKIT V1
      </text>

      {/* power LED (red) + D2 blue LED */}
      <rect x="88" y="196" width="12" height="7" rx="1" fill={running ? '#FF5F56' : '#54211E'} />
      {running && <circle cx="94" cy="199" r="9" fill="#FF5F56" opacity="0.3" />}
      <text x="88" y="212" fontSize="6.5" fill="#B9BEC4" fontFamily="monospace">PWR</text>
      <rect x="160" y="196" width="12" height="7" rx="1" fill="#1D2B4A" />
      <text x="160" y="212" fontSize="6.5" fill="#B9BEC4" fontFamily="monospace">D2</text>
      {/* TX activity LED */}
      <rect x="124" y="196" width="12" height="7" rx="1" fill={txFlash ? '#FFE45C' : '#4A431C'} />
      <text x="124" y="212" fontSize="6.5" fill="#B9BEC4" fontFamily="monospace">TX</text>

      {/* CP2102 USB bridge */}
      <rect x="112" y="234" width="36" height="36" rx="3" fill="#0C0C12" stroke="#2E2E3E"
            transform="rotate(45 130 252)" />
      <text x="130" y="255" fontSize="6" fill="#666" textAnchor="middle" fontFamily="monospace">CP2102</text>

      {/* passives */}
      {[...Array(8)].map((_, i) => (
        <rect key={i} x={78 + (i % 4) * 28} y={292 + Math.floor(i / 4) * 14} width="12" height="6" rx="1" fill="#3A3A46" />
      ))}

      {/* EN / BOOT buttons */}
      <g>
        <rect x="40" y="352" width="34" height="26" rx="3" fill="#C9CDD1" stroke="#8F959C" />
        <circle cx="57" cy="365" r="8" fill="#26262E" stroke="#000" />
        <text x="57" y="390" fontSize="7" fill="#B9BEC4" textAnchor="middle" fontFamily="monospace">EN</text>
      </g>
      <g>
        <rect x="186" y="352" width="34" height="26" rx="3" fill="#C9CDD1" stroke="#8F959C" />
        <circle cx="203" cy="365" r="8" fill="#26262E" stroke="#000" />
        <text x="203" y="390" fontSize="7" fill="#B9BEC4" textAnchor="middle" fontFamily="monospace">BOOT</text>
      </g>

      {/* micro-USB */}
      <rect x="102" y="392" width="56" height="34" rx="4" fill="url(#espShield)" stroke="#6E747B" />
      <rect x="112" y="398" width="36" height="10" rx="3" fill="#3F444A" />

      {/* ---- live overlays ---- */}
      {Object.entries(pins).map(([pin, v]) => {
        const pos = ESP32_PIN_POS[pin];
        if (!pos || v == null) return null;
        const a = v / 255;
        const left = pos[0] < 130;
        return (
          <g key={`glow${pin}`} style={{ transition: 'opacity 130ms' }}>
            <circle cx={pos[0]} cy={pos[1]} r={8 + a * 7} fill="url(#espGlow)" opacity={0.25 + a * 0.75}
                    style={{ transition: 'opacity 130ms' }} />
            <text x={left ? pos[0] - 10 : pos[0] + 10} y={pos[1] + 3} fontSize="7.5" fill="#FFE45C"
                  textAnchor={left ? 'end' : 'start'} fontFamily="monospace" fontWeight="700">
              {v === 255 ? 'HIGH' : v === 0 ? 'LOW' : v}
            </text>
          </g>
        );
      })}
      {[...(usage?.buttonPins ?? [])].map((pin) => {
        const pos = ESP32_PIN_POS[String(pin)];
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
        const pos = ESP32_PIN_POS[String(pin)];
        return pos ? (
          <circle key={`adc${pin}`} cx={pos[0]} cy={pos[1]} r="8" fill="none"
                  stroke="#7CFC7C" strokeWidth="1.6" strokeDasharray="3 2" />
        ) : null;
      })}
    </svg>
  );
}
