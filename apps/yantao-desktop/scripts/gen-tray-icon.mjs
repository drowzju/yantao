/**
 * One-off generator for the tray/window icon: rasterizes the YT monogram
 * (white badge, ink letters) and emits base64 PNG data URLs ready to paste
 * into `src/main.ts`.
 *
 * Why a badge and not the bare glyph: the Windows tray sits on dark taskbars
 * by default but light ones exist, so ink-on-nothing disappears on one of the
 * two. A white tile with ink letters and a hairline ink rim reads on both.
 *
 * Pure Node: analytic shape tests with 16× supersampling for the antialiased
 * edges, PNG encoded with node:zlib. No canvas, no image library.
 *
 * Run: node apps/yantao-desktop/scripts/gen-tray-icon.mjs
 * @module gen-tray-icon
 */
import { deflateSync } from 'node:zlib'

/** Ink of the yantao world (`--yt-ink`). */
const INK = [0x2e, 0x2b, 0x26]
/** The badge's white ground. */
const PAPER = [0xff, 0xff, 0xff]
/** Rim ink alpha (0..1) — enough to define the tile on a light taskbar. */
const RIM_ALPHA = 0.55

/** Supersamples per pixel edge. */
const SS = 16

// --- geometry (unit space: the letters' ink box is x 1.5..33.5, y 2.5..21.5) --

/** Distance from point (px,py) to the segment (ax,ay)-(bx,by). */
function distToSegment(ax, ay, bx, by, px, py) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The letter strokes: two arms and a stem for Y, a bar and a stem for T. */
const STROKES = [
  [3, 4, 9.5, 12.5],    // Y left arm
  [16, 4, 9.5, 12.5],   // Y right arm
  [9.5, 12.5, 9.5, 20], // Y stem
  [20, 5.5, 32, 5.5],   // T bar
  [26, 5.5, 26, 20],    // T stem
]
const STROKE_HALF = 1.5

/** Ink-box extents of the strokes above (for centring). */
const INK_X = 1.5
const INK_Y = 2.5
const INK_W = 32
const INK_H = 19

/** The YT letters: any stroke within reach. */
function insideGlyph(px, py) {
  return STROKES.some(([ax, ay, bx, by]) => distToSegment(ax, ay, bx, by, px, py) <= STROKE_HALF)
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** @param {string} type @param {Uint8Array} data */
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crc = crc32(out.subarray(4, 8 + data.length))
  new DataView(out.buffer).setUint32(8 + data.length, crc)
  return out
}

/**
 * Encode RGBA pixels as a PNG.
 * @param {number} size square edge
 * @param {Uint8Array} rgba length size*size*4
 */
function encodePng(size, rgba) {
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, size)
  new DataView(ihdr.buffer).setUint32(4, size)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  const raw = new Uint8Array(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0 // filter: none
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (1 + size * 4) + 1)
  }
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    ...chunk('IEND', new Uint8Array(0)),
  ])
}

// --- rasterizer --------------------------------------------------------------

/**
 * Render the badged mark at `size` px.
 * @param {number} size square edge
 * @returns {Uint8Array} RGBA pixels
 */
function render(size) {
  const rgba = new Uint8Array(size * size * 4)
  // Badge geometry in pixel space: 1px inset at 16, 2px at 32 (scaled).
  const inset = Math.max(1, Math.round(size / 16))
  const badge = { x: inset, y: inset, w: size - 2 * inset, h: size - 2 * inset }
  const radius = badge.w * 0.25
  // Glyph box: the letters' ink box scaled to fill ~84% of the badge width,
  // centred both ways.
  const scale = (badge.w * 0.84) / INK_W
  const gx = badge.x + (badge.w - INK_W * scale) / 2 - INK_X * scale
  const gy = badge.y + (badge.h - INK_H * scale) / 2 - INK_Y * scale
  const rimHalf = 0.5 // px, centred on the badge edge

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS
          const fy = py + (sy + 0.5) / SS
          const ux = (fx - gx) / scale
          const uy = (fy - gy) / scale
          // Signed distance to the badge edge (negative inside).
          const bcx = badge.x + badge.w / 2
          const bcy = badge.y + badge.h / 2
          const dx = Math.abs(fx - bcx) - (badge.w / 2 - radius)
          const dy = Math.abs(fy - bcy) - (badge.h / 2 - radius)
          const sd = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
          let cr, cg, cb, ca
          if (sd <= 0 && insideGlyph(ux, uy)) {
            ;[cr, cg, cb] = INK; ca = 1
          } else if (sd <= 0) {
            ;[cr, cg, cb] = PAPER; ca = 1
          } else if (sd <= rimHalf) {
            ;[cr, cg, cb] = INK; ca = RIM_ALPHA * (1 - sd / rimHalf)
          } else {
            cr = cg = cb = 0; ca = 0
          }
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca
        }
      }
      const samples = SS * SS
      const o = (py * size + px) * 4
      rgba[o] = a > 0 ? Math.round(r / a) : 0
      rgba[o + 1] = a > 0 ? Math.round(g / a) : 0
      rgba[o + 2] = a > 0 ? Math.round(b / a) : 0
      rgba[o + 3] = Math.round((a / samples) * 255)
    }
  }
  return rgba
}

// --- self-check + output ------------------------------------------------------

for (const size of [16, 32, 64]) {
  const rgba = render(size)
  // Coverage sanity: the badge must occupy most of the canvas, the letters a visible share.
  let opaque = 0, ink = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 200) opaque++
    if (rgba[i + 3] > 200 && rgba[i] < 0x60) ink++
  }
  const png = encodePng(size, rgba)
  const b64 = Buffer.from(png).toString('base64')
  console.log(`--- ${size}x${size}: ${png.length} bytes, opaque ${(opaque / (size * size) * 100).toFixed(0)}%, ink ${(ink / (size * size) * 100).toFixed(0)}%`)
  console.log(`const TRAY_ICON_${size} = 'data:image/png;base64,${b64}'`)
}
