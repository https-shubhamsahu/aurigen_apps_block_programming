#!/usr/bin/env python3
"""Build the README SVGs in assets/readme/.

Run from anywhere:  python3 scripts/build_readme_assets.py

Colours come from the app itself: frontend/src/design/global.css (chrome,
brand yellow, terminal) and the Blockly category palette in
frontend/src/blockly/esp32Blocks.js. The C++ in the hero is the exact
output of cppGenerator.js for the "Blink" example in lib/examples.js
(minus the generated header comment).
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "readme"

# ---- palette (app tokens) -------------------------------------------------
BG = "#18181B"        # --chrome-bg
PANEL = "#101012"     # --terminal-bg
LANE = "#1F1F23"
NODE = "#27272C"
LINE = "#3A3A40"
TEXT = "#F4F4F5"      # --chrome-text
MUTED = "#A2A2AA"     # --chrome-text-muted
BRAND = "#FFD400"     # --brand
GLOW = "#FFE45C"      # simulator "pin is HIGH" glow
INK = "#17171A"       # --brand-ink
PINS = "#E8590C"      # Blockly "Pins" category
BASIC = "#1E90FF"     # Blockly "Basic" category
LED_OFF = "#4A431C"

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Noto Sans Mono', monospace"

BASE_CSS = f"""
    .s {{ font-family: {SANS}; }}
    .m {{ font-family: {MONO}; }}
    .b {{ font-weight: 700; }}
    .xb {{ font-weight: 800; }}"""

REDUCED = """
    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; }
    }"""


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size, fill, cls="s", anchor="start", extra=""):
    a = f' text-anchor="{anchor}"' if anchor != "start" else ""
    return f'<text x="{x}" y="{y}" class="{cls}" font-size="{size}" fill="{fill}"{a}{extra}>{esc(s)}</text>'


# Rough advance widths (Noto Sans, the widest fallback we preview with).
def tw(s, size, mono=False, bold=False):
    if mono:
        return len(s) * size * 0.6
    w = 0.0
    for ch in s:
        if ch in "il.,:;'|!()[]{} ":
            w += 0.30
        elif ch in "mwMW":
            w += 0.86
        elif ch.isupper() or ch.isdigit():
            w += 0.64
        else:
            w += 0.55
    return w * size * (1.07 if bold else 1.0)


def block_path(x, y, w, h, nx=16, nw=32, d=7, r=6):
    """Blockly statement block: notch on top, tab underneath."""
    return (
        f"M{x+r},{y} H{x+nx} L{x+nx+7},{y+d} H{x+nx+nw-7} L{x+nx+nw},{y} "
        f"H{x+w-r} Q{x+w},{y} {x+w},{y+r} V{y+h-r} Q{x+w},{y+h} {x+w-r},{y+h} "
        f"H{x+nx+nw} L{x+nx+nw-7},{y+h+d} H{x+nx+7} L{x+nx},{y+h} "
        f"H{x+r} Q{x},{y+h} {x},{y+h-r} V{y+r} Q{x},{y} {x+r},{y} Z"
    )


def darker(hex_colour, f=0.78):
    v = [int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{int(c * f):02X}" for c in v)


def blockly_block(x, y, parts, colour, size=21, h=46):
    """parts: ('t', label) | ('dd', dropdown) | ('num', number field)."""
    out = []
    cx = x + 14
    items = []
    for kind, s in parts:
        if kind == "t":
            items.append(text(cx, y + h / 2 + size * 0.36, s, size, "#FFFFFF", "s b"))
            cx += tw(s, size, bold=True) + 10
        elif kind == "dd":
            fw = tw(s, size) + 40
            items.append(f'<rect x="{cx}" y="{y+7}" width="{fw:.0f}" height="{h-14}" rx="8" fill="#000000" fill-opacity="0.22"/>')
            items.append(text(cx + 10, y + h / 2 + size * 0.36, s, size, "#FFFFFF", "s"))
            tx = cx + fw - 20
            ty = y + h / 2 - 2
            items.append(f'<path d="M{tx:.0f},{ty} h10 l-5,6 z" fill="#FFFFFF"/>')
            cx += fw + 10
        elif kind == "num":
            fw = tw(s, size) + 22
            items.append(f'<rect x="{cx}" y="{y+7}" width="{fw:.0f}" height="{h-14}" rx="8" fill="#FFFFFF"/>')
            items.append(text(cx + 11, y + h / 2 + size * 0.36, s, size, INK, "s"))
            cx += fw + 10
    w = cx - x + 4
    out.append(f'<path d="{block_path(x, y, w, h)}" fill="{colour}" stroke="{darker(colour)}" stroke-width="1.5"/>')
    out.extend(items)
    return "\n    ".join(out), w


def svg_open(w, h, title, desc, css):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'role="img" aria-labelledby="title desc">\n'
        f'  <title id="title">{esc(title)}</title>\n'
        f'  <desc id="desc">{esc(desc)}</desc>\n'
        f'  <style>{css}\n  </style>\n'
    )


# =========================================================================
# 1. HERO (animated): the Blink program as blocks, as C++, and on the board.
#    One 4 s loop, four 1 s phases; each phase is a pixel-still hold.
# =========================================================================
def hero():
    W, H = 1200, 560
    dur = "4s"

    def phase_kf(name, on_from, on_to):
        """opacity 1 inside [on_from, on_to) percent, 0 elsewhere, 2% fades."""
        if on_from == 0:
            return (f"@keyframes {name} {{ 0%, {on_to-2}% {{ opacity: 1; }} {on_to}%, 98% {{ opacity: 0; }} "
                    f"100% {{ opacity: 1; }} }}")
        return (f"@keyframes {name} {{ 0%, {on_from-2}% {{ opacity: 0; }} {on_from}%, {on_to-2}% {{ opacity: 1; }} "
                f"{on_to}%, 100% {{ opacity: 0; }} }}") if on_to < 100 else (
                f"@keyframes {name} {{ 0%, {on_from-2}% {{ opacity: 0; }} {on_from}%, 98% {{ opacity: 1; }} "
                f"100% {{ opacity: 0; }} }}")

    css = BASE_CSS + f"""
    .hl1, .hl2, .hl3, .hl4, .on, .off {{ animation-duration: {dur}; animation-iteration-count: infinite; animation-timing-function: linear; }}
    .hl1 {{ animation-name: p1; }}
    .hl2 {{ opacity: 0; animation-name: p2; }}
    .hl3 {{ opacity: 0; animation-name: p3; }}
    .hl4 {{ opacity: 0; animation-name: p4; }}
    .on  {{ animation-name: ledon; }}
    .off {{ visibility: hidden; animation-name: ledoff; }}
    {phase_kf('p1', 0, 25)}
    {phase_kf('p2', 25, 50)}
    {phase_kf('p3', 50, 75)}
    {phase_kf('p4', 75, 100)}
    /* the LED switches instantly, like the pin; visibility also keeps the glow off a compositor layer */
    @keyframes ledon {{ 0%, 49.9% {{ visibility: visible; }} 50%, 99.9% {{ visibility: hidden; }} 100% {{ visibility: visible; }} }}
    @keyframes ledoff {{ 0%, 49.9% {{ visibility: hidden; }} 50%, 99.9% {{ visibility: visible; }} 100% {{ visibility: hidden; }} }}""" + REDUCED

    s = [svg_open(W, H,
                  "Aurigen: drag blocks in a browser tab, flash a real ESP32 over USB",
                  "The Blink example three ways. Left: four Blockly blocks, set pin GPIO 16 to HIGH, wait 500 "
                  "milliseconds, set pin GPIO 16 to LOW, wait 500 milliseconds. Middle: the Arduino C++ you "
                  "get from them. Right: an ESP32 DevKit V1 with an LED on GPIO 16. The highlighted "
                  "block, the matching C++ line and the LED state step through the program together.",
                  css)]
    s.append(f'  <defs>\n    <radialGradient id="glow"><stop offset="0" stop-color="{GLOW}" stop-opacity="0.95"/>'
             f'<stop offset="1" stop-color="{BRAND}" stop-opacity="0"/></radialGradient>\n'
             f'    <linearGradient id="shield" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D7DBE0"/>'
             f'<stop offset="0.5" stop-color="#AEB4BB"/><stop offset="1" stop-color="#878D95"/></linearGradient>\n  </defs>')
    s.append(f'  <rect width="{W}" height="{H}" rx="28" fill="{BG}"/>')

    # ---- title block ----
    s.append('  <g id="title-block">')
    s.append(f'    <text x="56" y="116" class="s xb" font-size="76" fill="{TEXT}" letter-spacing="-1">Aurigen<tspan fill="{BRAND}">.</tspan></text>')
    s.append("    " + text(56, 166, "Drag blocks in a browser tab. Flash a real ESP32 over USB.", 30, TEXT, "s b"))
    s.append("    " + text(56, 206, "Blockly → Arduino C++ → arduino-cli in the cloud → Web Serial", 21, MUTED, "m"))
    s.append("    " + text(1144, 72, "aurigen-apps.vercel.app", 19, MUTED, "m", "end"))
    s.append('  </g>')

    # ---- panels ----
    top, bot = 240, 528
    panels = [(56, 404, "Blocks", "Blink example"),
              (480, 320, "Generated C++", ""),
              (820, 324, "ESP32 DevKit V1", "")]
    for px, pw, head, note in panels:
        s.append(f'  <rect x="{px}" y="{top}" width="{pw}" height="{bot-top}" rx="18" fill="{PANEL}"/>')
        s.append("  " + text(px + 20, top + 34, head, 20, TEXT, "s b"))
        if note:
            s.append("  " + text(px + pw - 20, top + 34, note, 18, MUTED, "m", "end"))
    # flow chevrons between panels
    for gx in (460 + 10, 800 + 10):
        s.append(f'  <path d="M{gx-5},{384-9} l9,9 l-9,9" fill="none" stroke="{BRAND}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>')

    # ---- blocks ----
    bx, by, bh = 76, 296, 46
    prog = [
        ([("t", "set pin"), ("dd", "GPIO 16"), ("t", "to"), ("dd", "HIGH")], PINS),
        ([("t", "wait"), ("num", "500"), ("t", "milliseconds")], BASIC),
        ([("t", "set pin"), ("dd", "GPIO 16"), ("t", "to"), ("dd", "LOW")], PINS),
        ([("t", "wait"), ("num", "500"), ("t", "milliseconds")], BASIC),
    ]
    s.append('  <g id="blocks">')
    widths = []
    for i, (parts, col) in enumerate(prog):
        g, w = blockly_block(bx, by + i * bh, parts, col, h=bh)
        widths.append(w)
        s.append("    " + g)
    for i, w in enumerate(widths):
        s.append(f'    <path class="hl{i+1}" d="{block_path(bx, by + i * bh, w, bh)}" fill="none" stroke="{BRAND}" stroke-width="4" stroke-linejoin="round"/>')
    s.append('  </g>')

    # ---- code ----
    code = ["void setup() {", "  Serial.begin(115200);", "  pinMode(16, OUTPUT);", "}",
            "void loop() {", "  digitalWrite(16, HIGH);", "  delay(500);", "  digitalWrite(16, LOW);",
            "  delay(500);", "}"]
    cx, cy0, lh = 496, 302, 22
    s.append('  <g id="code">')
    for k, line_no in enumerate((5, 6, 7, 8)):
        y = cy0 + line_no * lh
        s.append(f'    <g class="hl{k+1}"><rect x="{cx-4}" y="{y-17}" width="298" height="{lh}" rx="4" fill="{BRAND}" fill-opacity="0.16"/>'
                 f'<rect x="{cx-4}" y="{y-17}" width="4" height="{lh}" fill="{BRAND}"/></g>')
    for i, line in enumerate(code):
        y = cy0 + i * lh
        if line.startswith("void"):
            rest = line[4:]
            s.append(f'    <text x="{cx+8}" y="{y}" class="m" font-size="19" fill="{MUTED}">void<tspan fill="{TEXT}">{esc(rest)}</tspan></text>')
        else:
            ind = len(line) - len(line.lstrip(" "))
            s.append("    " + text(cx + 8 + ind * 19 * 0.6, y, line.lstrip(" "), 19, TEXT, "m"))
    s.append('  </g>')

    # ---- board + LED ----
    s.append('  <g id="board">')
    pcb_x, pcb_y, pcb_w, pcb_h = 1004, 290, 116, 222
    s.append(f'    <rect x="{pcb_x}" y="{pcb_y}" width="{pcb_w}" height="{pcb_h}" rx="10" fill="#16161F" stroke="#000000" stroke-width="2"/>')
    s.append(f'    <rect x="{pcb_x+24}" y="{pcb_y+10}" width="{pcb_w-48}" height="74" rx="4" fill="url(#shield)" stroke="#6E747B"/>')
    s.append(f'    <rect x="{pcb_x+46}" y="{pcb_y+150}" width="24" height="24" rx="3" fill="#0C0C12" stroke="#2E2E3E"/>')
    s.append(f'    <rect x="{pcb_x+40}" y="{pcb_y+pcb_h-16}" width="36" height="22" rx="4" fill="url(#shield)" stroke="#6E747B"/>')
    pin_y = [pcb_y + 12 + 14 * i for i in range(15)]
    for yy in pin_y:
        s.append(f'    <circle cx="{pcb_x+11}" cy="{yy}" r="3.4" fill="#C7A24C" stroke="#8A6D2B"/>')
        s.append(f'    <circle cx="{pcb_x+pcb_w-11}" cy="{yy}" r="3.4" fill="#C7A24C" stroke="#8A6D2B"/>')
    rx2_y = pin_y[5]  # true DevKit V1 header order: 3V3, GND, D15, D2, D4, RX2 (GPIO 16)
    gx = pcb_x + 11
    # wire: pin -> resistor -> LED anode
    led_x, led_y = 884, 352  # dome centre
    s.append(f'    <path d="M{gx},{rx2_y} H{led_x+6} V{led_y+40}" fill="none" stroke="#6E747B" stroke-width="3" stroke-linejoin="round"/>')
    s.append(f'    <rect x="{930}" y="{rx2_y-7}" width="36" height="14" rx="5" fill="#D8C49A" stroke="#9C8A62"/>')
    for bxk, bc in ((938, "#8B4513"), (946, "#111111"), (954, "#8B4513")):
        s.append(f'    <rect x="{bxk}" y="{rx2_y-7}" width="4" height="14" fill="{bc}"/>')
    # cathode leg to ground symbol
    s.append(f'    <path d="M{led_x-6},{led_y+40} V{led_y+78}" fill="none" stroke="#6E747B" stroke-width="3"/>')
    gy = led_y + 78
    s.append(f'    <path d="M{led_x-20},{gy} h28 M{led_x-15},{gy+6} h18 M{led_x-10},{gy+12} h8" stroke="#6E747B" stroke-width="3" stroke-linecap="round"/>')
    # LED body (off), then on-layer
    dome = f"M{led_x-15},{led_y+34} V{led_y} A15,15 0 0 1 {led_x+15},{led_y} V{led_y+34} Z"
    s.append(f'    <path d="{dome}" fill="{LED_OFF}" stroke="#2A2610" stroke-width="2"/>')
    s.append(f'    <rect x="{led_x-19}" y="{led_y+32}" width="38" height="8" rx="2" fill="{LED_OFF}" stroke="#2A2610" stroke-width="2"/>')
    s.append(f'    <g class="on"><circle cx="{led_x}" cy="{led_y+8}" r="54" fill="url(#glow)"/>'
             f'<path d="{dome}" fill="{GLOW}" stroke="#C9A800" stroke-width="2"/>'
             f'<rect x="{led_x-19}" y="{led_y+32}" width="38" height="8" rx="2" fill="{GLOW}" stroke="#C9A800" stroke-width="2"/>'
             f'<circle cx="{gx}" cy="{rx2_y}" r="13" fill="url(#glow)"/></g>')
    # labels
    s.append("    " + text(964, rx2_y - 16, "GPIO 16", 19, TEXT, "m", "middle"))
    s.append(f'    <g class="on">{text(led_x, 486, "HIGH", 24, GLOW, "m b", "middle")}</g>')
    s.append(f'    <g class="off">{text(led_x, 486, "LOW", 24, MUTED, "m b", "middle")}</g>')
    s.append('  </g>')
    s.append("</svg>\n")
    return "\n".join(s)


# =========================================================================
# 2. PIPELINE (animated): where the program goes between the click and the chip.
#    10 s loop: steps light in order, the board LED turns on, a 2 s still hold.
# =========================================================================
def pipeline():
    W, H = 1200, 772
    L = (56, 584)
    R = (616, 1144)
    node_h, pitch, y0 = 70, 90, 150
    steps = [
        (L, "Blocks become Arduino C++", "cppGenerator.js, pins checked per board", False),
        (R, "POST /api/compile", "Supabase JWT, 6 a minute, 202 + jobId", False),
        (R, "Job joins a BullMQ queue", "Redis, capped at 50 waiting or running", False),
        (R, "arduino-cli builds it", "esp32:esp32:esp32, 180 s timeout", True),
        (L, "Browser fetches the images", "polls /api/status every 1.5 s", True),
    ]
    lit = [3, 15, 27, 39, 51, 63]
    led_at = 71
    hold_end, fade_end = 92, 97

    kf = []
    for i, t in enumerate(lit):
        kf.append(f"@keyframes n{i} {{ 0%, {t-1}% {{ opacity: 0; }} {t}%, {hold_end}% {{ opacity: 1; }} {fade_end}%, 100% {{ opacity: 0; }} }}")
    for i in range(5):
        a, b = lit[i] + 2, lit[i + 1] - 1
        kf.append(f"@keyframes c{i} {{ 0%, {a}% {{ stroke-dashoffset: 100; opacity: 1; }} {b}%, {hold_end}% {{ stroke-dashoffset: 0; opacity: 1; }} "
                  f"{fade_end}% {{ stroke-dashoffset: 0; opacity: 0; }} 98% {{ stroke-dashoffset: 100; opacity: 0; }} 99%, 100% {{ stroke-dashoffset: 100; opacity: 1; }} }}")
    kf.append(f"@keyframes led {{ 0%, {led_at-1}% {{ opacity: 0; }} {led_at}%, {hold_end}% {{ opacity: 1; }} {fade_end}%, 100% {{ opacity: 0; }} }}")
    anim = "animation-duration: 10s; animation-iteration-count: infinite; animation-timing-function: linear;"
    css = BASE_CSS + "\n    " + "\n    ".join(
        [f".n{i} {{ {anim} animation-name: n{i}; }}" for i in range(6)] +
        [f".c{i} {{ {anim} animation-name: c{i}; animation-timing-function: ease-out; }}" for i in range(5)] +
        [f".led {{ {anim} animation-name: led; }}"] + kf) + REDUCED

    s = [svg_open(W, H,
                  "From block to board: the six steps of one compile and flash",
                  "Two lanes, Browser and Compile service, with a USB lane below. 1, in the browser: blocks become "
                  "Arduino C++ in cppGenerator.js. 2, on the compile service: POST /api/compile checks the Supabase "
                  "JWT, allows 6 compiles a minute and answers 202 with a job id. 3: the job joins a BullMQ queue on "
                  "Redis, capped at 50. 4: arduino-cli compiles it with a 180 second timeout. 5, back in your "
                  "browser: it polls /api/status every 1.5 seconds and downloads the images. 6, over USB: "
                  "esptool-js writes four images over Web Serial and resets the ESP32, whose LED turns on.",
                  css)]
    s.append(f'  <defs><radialGradient id="glow"><stop offset="0" stop-color="{GLOW}" stop-opacity="0.95"/>'
             f'<stop offset="1" stop-color="{BRAND}" stop-opacity="0"/></radialGradient></defs>')
    s.append(f'  <rect width="{W}" height="{H}" rx="28" fill="{BG}"/>')

    # lane headers + bands
    band_top, band_bot = 124, y0 + 4 * pitch + node_h + 16
    for (x0, x1), head, sub in ((L, "Browser", "React + Blockly, hosted on Vercel"),
                                (R, "Compile service", "Express, Redis, arduino-cli in Docker or on a VPS")):
        s.append("  " + text(x0 + 4, 66, head, 26, TEXT, "s b"))
        s.append("  " + text(x0 + 4, 98, sub, 19, MUTED, "s"))
        s.append(f'  <rect x="{x0}" y="{band_top}" width="{x1-x0}" height="{band_bot-band_top}" rx="20" fill="{LANE}"/>')

    # connectors (grey base, yellow overlay that draws in)
    def cy(i):
        return y0 + i * pitch + node_h / 2

    def ytop(i):
        return y0 + i * pitch

    def ybot(i):
        return y0 + i * pitch + node_h

    lx1, rx0 = L[1] - 16, R[0] + 16
    midx = (L[1] + R[0]) / 2
    rmid = (R[0] + R[1]) / 2
    lmid = (L[0] + L[1]) / 2
    usb_top = band_bot + 24
    conns = [
        f"M{lx1},{cy(0)} H{midx} V{cy(1)} H{rx0}",
        f"M{rmid},{ybot(1)} V{ytop(2)}",
        f"M{rmid},{ybot(2)} V{ytop(3)}",
        f"M{rx0},{cy(3)} H{midx} V{cy(4)} H{lx1}",
        f"M{lmid},{ybot(4)} V{usb_top}",
    ]
    for d in conns:
        s.append(f'  <path d="{d}" fill="none" stroke="{LINE}" stroke-width="4" stroke-linejoin="round"/>')
    # what actually travels over the wire (server.js req.body, worker.js return value)
    s.append("  " + text(L[1] - 40, cy(1) + 7, "{ cpp, board }", 20, MUTED, "m", "end"))
    s.append("  " + text(L[1] - 40, cy(3) + 7, "[{ offset, url }, ...]", 20, MUTED, "m", "end"))
    for i, d in enumerate(conns):
        s.append(f'  <path class="c{i}" d="{d}" pathLength="100" stroke-dasharray="100" fill="none" stroke="{BRAND}" stroke-width="4" stroke-linejoin="round"/>')

    def node(i, x0, x1, y, h, title, detail, mono):
        out = [f'  <g id="step-{i+1}">',
               f'    <rect x="{x0}" y="{y}" width="{x1-x0}" height="{h}" rx="14" fill="{NODE}" stroke="{LINE}" stroke-width="2"/>',
               f'    <circle cx="{x0+36}" cy="{y+h/2}" r="18" fill="{LINE}"/>',
               "    " + text(x0 + 36, y + h / 2 + 7, str(i + 1), 20, TEXT, "s b", "middle"),
               f'    <g class="n{i}"><rect x="{x0}" y="{y}" width="{x1-x0}" height="{h}" rx="14" fill="none" stroke="{BRAND}" stroke-width="3"/>'
               f'<circle cx="{x0+36}" cy="{y+h/2}" r="18" fill="{BRAND}"/>'
               + text(x0 + 36, y + h / 2 + 7, str(i + 1), 20, INK, "s b", "middle") + '</g>',
               "    " + text(x0 + 70, y + 30, title, 22, TEXT, "m b" if title.startswith("POST") else "s b"),
               "    " + text(x0 + 70, y + 56, detail, 19, MUTED, "m" if mono else "s"),
               "  </g>"]
        for (lbl, size, m, b) in ((title, 22, title.startswith("POST"), True), (detail, 19, mono, False)):
            if tw(lbl, size, mono=m, bold=b) > (x1 - x0) - 86:
                print(f"  ! pipeline step {i+1} text may overflow: {lbl!r} ~{tw(lbl, size, mono=m, bold=b):.0f}px")
        return out

    for i, ((x0, x1), title, detail, mono) in enumerate(steps):
        s.extend(node(i, x0 + 16, x1 - 16, ytop(i), node_h, title, detail, mono))

    # USB lane: step 6 + the board
    uy, uh = usb_top, 132
    s.append(f'  <rect x="{L[0]}" y="{uy}" width="{R[1]-L[0]}" height="{uh}" rx="20" fill="{LANE}"/>')
    s.extend(node(5, L[0] + 16, 820, uy + 16, uh - 32,
                  "esptool-js flashes over Web Serial",
                  "DTR/RTS enter download mode, 4 images, then reset", False))
    # mini DevKit, lying flat, with the USB cable coming in from the left
    bx, by, bw, bh = 900, uy + 20, 210, 68
    s.append('  <g id="devkit">')
    s.append(f'    <path d="M820,{uy+uh/2} H{bx-14}" stroke="{LINE}" stroke-width="6" stroke-linecap="round"/>')
    s.append(f'    <rect x="{bx-18}" y="{by+bh/2-11}" width="22" height="22" rx="3" fill="#AEB4BB" stroke="#6E747B"/>')
    s.append(f'    <rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="8" fill="#16161F" stroke="#000000" stroke-width="2"/>')
    s.append(f'    <rect x="{bx+bw-78}" y="{by+12}" width="64" height="{bh-24}" rx="3" fill="#AEB4BB" stroke="#6E747B"/>')
    for k in range(13):
        px = bx + 14 + k * 14
        s.append(f'    <circle cx="{px}" cy="{by+8}" r="3" fill="#C7A24C"/><circle cx="{px}" cy="{by+bh-8}" r="3" fill="#C7A24C"/>')
    pin16 = (bx + 14 + 5 * 14, by + 8)
    s.append(f'    <g class="led"><circle cx="{pin16[0]}" cy="{pin16[1]}" r="22" fill="url(#glow)"/></g>')
    s.append('  </g>')
    s.append("  " + text(1005, uy + uh - 14, "ESP32 DevKit V1", 18, MUTED, "s", "middle"))
    s.append("</svg>\n")
    return "\n".join(s)


# =========================================================================
# 3. FLASH MAP (static): the four ESP32 images, stacked like blocks.
# =========================================================================
def flash_map():
    W, H = 1200, 452
    s = [svg_open(W, H,
                  "ESP32 flash map: four images in one write",
                  "The worker stages four images and esptool-js writes them together: bootloader at 0x1000, "
                  "partition table at 0x8000, boot_app0 at 0xE000 and your program at 0x10000. "
                  "If you write only your program at 0x10000, a blank or erased board boot-loops.",
                  BASE_CSS)]
    s.append(f'  <rect width="{W}" height="{H}" rx="28" fill="{BG}"/>')
    s.append("  " + text(56, 74, "ESP32: four images, one write", 32, TEXT, "s b"))
    s.append("  " + text(56, 110, "worker.js stages them, hooks/useWebSerial.js writes them with esptool-js", 20, MUTED, "s"))
    rows = [
        ("0x1000", "bootloader", "job_N.ino.bootloader.bin", False),
        ("0x8000", "partition table", "job_N.ino.partitions.bin", False),
        ("0xE000", "boot_app0", "boot_app0.bin, from the core", False),
        ("0x10000", "app: the blocks you wrote", "job_N.ino.bin", True),
    ]
    y, h = 146, 50
    for i, (addr, name, fname, app) in enumerate(rows):
        yy = y + i * h
        s.append("  " + text(216, yy + 33, addr, 24, BRAND, "m b", "end"))
        fill = BRAND if app else "#3A3A40"
        stroke = "#C9A800" if app else "#2A2A2F"
        s.append(f'  <path d="{block_path(240, yy, 500, h)}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    # labels after shapes so tabs never cover text
    for i, (addr, name, fname, app) in enumerate(rows):
        yy = y + i * h
        s.append("  " + text(262, yy + 33, name, 21, INK if app else TEXT, "s b"))
        s.append("  " + text(768, yy + 33, fname, 19, MUTED, "m"))
    s.append(f'  <line x1="56" y1="{y+4*h+30}" x2="1144" y2="{y+4*h+30}" stroke="{LINE}" stroke-width="2"/>')
    s.append("  " + text(56, y + 4 * h + 72, "If you write only the app at 0x10000, a blank or erased board boot-loops. All four go together.", 21, TEXT, "s"))
    s.append("</svg>\n")
    return "\n".join(s)


# =========================================================================
# 4. STK500v1 (static): the bytes the browser and optiboot exchange.
# =========================================================================
def stk500():
    rows = [
        ("Reset into the bootloader", "DTR/RTS pulse", "optiboot starts"),
        ("Sync, up to 8 tries", "30 20", "14 10"),
        ("Check the chip is an ATmega328P", "75 20", "14 1E 95 0F 10"),
        ("Enter programming mode", "50 20", "14 10"),
        ("Load the word address", "55 lo hi 20", "14 10"),
        ("Write one 128-byte page", "64 00 80 46 [page] 20", "14 10"),
        ("Leave programming mode", "51 20", "14 10"),
    ]
    W = 1200
    y0, pitch = 196, 50
    H = y0 + len(rows) * pitch + 96
    s = [svg_open(W, H,
                  "Arduino Uno flashing: STK500v1 written in JavaScript",
                  "The byte exchange useAvrFlash.js runs with the Uno's optiboot bootloader over Web Serial: "
                  "reset with DTR and RTS, sync 30 20 answered by 14 10, read signature 75 20 answered by "
                  "14 1E 95 0F 10 (ATmega328P), enter programming mode 50 20, then for every page load the "
                  "address 55 lo hi 20 and write 128 bytes with 64 00 80 46, and finally leave programming "
                  "mode with 51 20 so the sketch starts.",
                  BASE_CSS)]
    s.append(f'  <rect width="{W}" height="{H}" rx="28" fill="{BG}"/>')
    s.append("  " + text(56, 74, "Arduino Uno: STK500v1, written in JavaScript", 32, TEXT, "s b"))
    s.append("  " + text(56, 110, "hooks/useAvrFlash.js talks to optiboot directly. You don't need avrdude or a helper app.", 20, MUTED, "s"))
    c1, c2, c3 = 56, 500, 860
    s.append("  " + text(c1 + 52, 160, "Step", 19, MUTED, "s"))
    s.append("  " + text(c2, 160, "Browser sends", 19, MUTED, "s"))
    s.append("  " + text(c3, 160, "optiboot answers", 19, MUTED, "s"))
    for i, (step, sent, reply) in enumerate(rows):
        y = y0 + i * pitch
        if i % 2 == 0:
            s.append(f'  <rect x="40" y="{y-6}" width="1120" height="{pitch-4}" rx="10" fill="{LANE}"/>')
        mid = y + (pitch - 4) / 2 - 6
        s.append(f'  <circle cx="{c1+20}" cy="{mid}" r="15" fill="{LINE}"/>')
        s.append("  " + text(c1 + 20, mid + 6, str(i + 1), 18, TEXT, "s b", "middle"))
        s.append("  " + text(c1 + 52, mid + 7, step, 21, TEXT, "s"))
        s.append("  " + text(c2, mid + 7, sent, 21, BRAND, "m b"))
        s.append(f'  <path d="M{c3-58},{mid} h34 m-8,-7 l8,7 l-8,7" fill="none" stroke="{MUTED}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>')
        s.append("  " + text(c3, mid + 7, reply, 21, TEXT, "m"))
    # bracket for the per-page loop (rows 5 and 6)
    ya, yb = y0 + 4 * pitch - 2, y0 + 6 * pitch - 10
    s.append(f'  <path d="M1040,{ya} h12 V{yb} h-12" fill="none" stroke="{BRAND}" stroke-width="2.5"/>')
    s.append("  " + text(1066, (ya + yb) / 2 - 4, "repeat", 18, MUTED, "s"))
    s.append("  " + text(1066, (ya + yb) / 2 + 18, "per page", 18, MUTED, "s"))
    s.append(f'  <line x1="56" y1="{H-70}" x2="1144" y2="{H-70}" stroke="{LINE}" stroke-width="2"/>')
    s.append("  " + text(56, H - 32, "If the signature isn't 1E 95 0F, the upload stops before a single page is written.", 21, TEXT, "s"))
    s.append("</svg>\n")
    return "\n".join(s)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in (("hero.svg", hero), ("pipeline.svg", pipeline),
                     ("flash-map.svg", flash_map), ("stk500.svg", stk500)):
        (OUT / name).write_text(fn(), encoding="utf-8")
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
