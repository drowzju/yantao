/**
 * One-off generator for the tray icon: rasterizes the PARAP monogram
 * (the same geometry as `packages/client/ui-yantao/src/client/brand/YantaoMark.tsx`)
 * onto a paper badge and emits base64 PNG data URLs ready to paste into
 * `src/main.ts`.
 *
 * Why a badge and not the bare glyph: the Windows tray sits on dark taskbars
 * by default but light ones exist, so ink-on-nothing disappears on one of the
 * two. A paper tile with an ink glyph and a hairline ink rim reads on both.
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
/** Warm paper of the yantao world (`--yt-paper`). */
const PAPER = [0xfb, 0xfa, 0xf7]
/** Rim ink alpha (0..1) — enough to define the tile on a light taskbar. */
const RIM_ALPHA = 0.55

/** Supersamples per pixel edge. */
const SS = 16

// --- geometry (unit space: the 24×24 viewBox of YantaoMark) -----------------

/** Rounded rectangle: x,y corner, w,h extents, r corner radius. */
function insideRoundedRect(x, y, w, h, r, px, py) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  const cx = x + w / 2
  const cy = y + h / 2
  const dx = Math.abs(px - cx) - (w / 2 - r)
  const dy = Math.abs(py - cy) - (h / 2 - r)
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.hypot(ox, oy) <= r
}

/** Half disc bulging to +x from centre (cx,cy) with radius r. */
function insideHalfDisc(cx, cy, r, px, py) {
  if (px < cx) return false
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

/** The P: stem plus bowl, counter knocked out (even-odd, as in YantaoMark). */
function insideGlyph(px, py) {
  const stem = insideRoundedRect(5, 4, 3.4, 16, 1.7, px, py)
  const bowlOuter = insideRoundedRect(8.4, 4, 5.1, 10, 0, px, py)
    || insideHalfDisc(13.5, 9, 5, px, py)
  const counter = insideRoundedRect(11.8, 7.1, 1.3, 3.8, 0, px, py)
    || insideHalfDisc(13.1, 9, 1.9, px, py)
  return (stem || bowlOuter) && !counter
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
  // Glyph box: the mark's ink bounding box (x 5..18.5, y 4..20 in the 24-unit
  // viewBox) scaled to fill ~72% of the badge height, centred.
  const glyphHeight = badge.w * 0.72
  const scale = glyphHeight / 16
  const gx = badge.x + (badge.w - 13.5 * scale) / 2 - 5 * scale
  const gy = badge.y + (badge.h - glyphHeight) / 2 - 4 * scale
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

for (const size of [16, 32]) {
  const rgba = render(size)
  // Coverage sanity: the badge must occupy most of the canvas, the glyph a third-ish of the badge.
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
