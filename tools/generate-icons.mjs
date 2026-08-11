// ---------------------------------------------------------------------------
// Generates the app icons. Run with:  node tools/generate-icons.mjs
//
// Writes real PNGs with no image library - just a hand-rolled encoder over
// zlib. The icon is the game in miniature: a serpentine maze running from a red
// breach to an amber camp.
// ---------------------------------------------------------------------------

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));

// -- minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgba length = w*h*4 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10,11,12 = compression, filter, interlace = 0

  // Each scanline gets a leading filter byte (0 = none).
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const src = y * w * 4;
    const dst = y * (w * 4 + 1);
    raw[dst] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + src, w * 4).copy(raw, dst + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -- tiny drawing surface ---------------------------------------------------

function surface(size) {
  const px = new Uint8Array(size * size * 4);
  const hex = (c) => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];

  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // simple source-over
    const sa = a / 255;
    px[i] = px[i] * (1 - sa) + r * sa;
    px[i + 1] = px[i + 1] * (1 - sa) + g * sa;
    px[i + 2] = px[i + 2] * (1 - sa) + b * sa;
    px[i + 3] = Math.max(px[i + 3], a);
  };

  const S = size / 512; // art is authored on a 512 grid
  return {
    px,
    fill(color) {
      const c = hex(color);
      for (let i = 0; i < size * size; i++) {
        px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
      }
    },
    rect(x, y, w, h, color, a = 255) {
      const c = hex(color);
      const x0 = Math.round(x * S), y0 = Math.round(y * S);
      const x1 = Math.round((x + w) * S), y1 = Math.round((y + h) * S);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) set(xx, yy, c, a);
    },
    disc(cx, cy, r, color, a = 255) {
      const c = hex(color);
      const R = r * S, CX = cx * S, CY = cy * S;
      for (let yy = Math.floor(CY - R); yy <= Math.ceil(CY + R); yy++) {
        for (let xx = Math.floor(CX - R); xx <= Math.ceil(CX + R); xx++) {
          const d = Math.hypot(xx + 0.5 - CX, yy + 0.5 - CY);
          if (d <= R - 0.5) set(xx, yy, c, a);
          else if (d <= R + 0.5) set(xx, yy, c, a * (R + 0.5 - d)); // cheap AA edge
        }
      }
    },
  };
}

// -- the artwork ------------------------------------------------------------

const BG = '#171a15';
const PATH = '#8fd94a';
const BREACH = '#e04b3a';
const CAMP = '#ffb020';
const W = 46; // stroke width on the 512 grid

function drawIcon(size) {
  const s = surface(size);
  s.fill(BG);

  // Faint grid, so it reads as a build surface rather than a plain logo.
  for (let i = 1; i < 8; i++) {
    s.rect(i * 64, 40, 2, 432, '#ffffff', 10);
    s.rect(40, i * 64, 432, 2, '#ffffff', 10);
  }

  // Serpentine route: right, down, left, down, right.
  s.rect(84, 120 - W / 2, 300, W, PATH);              // top run
  s.rect(384 - W, 120 - W / 2, W, 136 + W / 2, PATH); // down
  s.rect(128, 256 - W / 2, 256 + W, W, PATH);         // middle run (leftward)
  s.rect(128, 256 - W / 2, W, 136 + W / 2, PATH);     // down
  s.rect(128, 392 - W / 2, 300, W, PATH);             // bottom run

  // The one and only breach, and the camp it leads to.
  s.disc(96, 120, 44, BG);
  s.disc(96, 120, 38, BREACH);
  s.disc(96, 120, 20, BG);
  s.rect(392, 356, 76, 76, CAMP);
  s.rect(408, 372, 44, 44, BG, 90);

  return encodePng(s.px, size, size);
}

mkdirSync(OUT, { recursive: true });
for (const size of [32, 64, 180, 192, 256, 512, 1024]) {
  writeFileSync(join(OUT, `icon-${size}.png`), drawIcon(size));
  console.log(`  wrote icons/icon-${size}.png`);
}
console.log('done');
