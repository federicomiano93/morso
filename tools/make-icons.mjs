// Generates the app icons (a round plate with a bite taken out of it) as PNG files, no dependencies.
// Run with: npm run icons
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BG = [42, 115, 74];
const FG = [255, 255, 255];
const SS = 3; // supersampling per axis, for smooth edges

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.31;
  const bite = { x: cx + size * 0.19, y: cy - size * 0.17, r: size * 0.13 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          const inDisc = Math.hypot(fx - cx, fy - cy) <= R;
          const inBite = Math.hypot(fx - bite.x, fy - bite.y) <= bite.r;
          if (inDisc && !inBite) cover++;
        }
      }
      const a = cover / (SS * SS);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
      px[i + 3] = 255;
    }
  }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const px = render(size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), png(192));
writeFileSync(join(out, 'icon-512.png'), png(512));
writeFileSync(join(out, 'apple-touch-icon.png'), png(180));
console.log('icons written to', out);
