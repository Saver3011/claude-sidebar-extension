/**
 * Run once with: node generate-icons.js
 * Generates icons/icon16.png, icon48.png, icon128.png
 * Uses only Node.js built-ins (no npm dependencies needed).
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

function makePNG(size) {
  // Draw a simple gradient square with "C" — encoded as raw RGBA rows
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter byte: None
    for (let x = 0; x < size; x++) {
      // Background: warm amber gradient
      const cx = x - size / 2, cy = y - size / 2;
      const r2 = (cx * cx + cy * cy) / (size * size / 4);

      // Rounded rect mask
      const rx = Math.abs(x - size / 2) / (size / 2 - size * 0.12);
      const ry = Math.abs(y - size / 2) / (size / 2 - size * 0.12);
      const inRect = Math.pow(rx, 6) + Math.pow(ry, 6) < 1;

      if (!inRect) {
        row.push(0, 0, 0, 0); // transparent
        continue;
      }

      // "C" letter mask (centered)
      const nx = (x / size) - 0.5;  // -0.5 to 0.5
      const ny = (y / size) - 0.5;
      const dist = Math.sqrt(nx * nx + ny * ny);
      const ring = dist > 0.22 && dist < 0.38;
      const cut  = nx > 0.05 && Math.abs(ny) < 0.14;
      const isC  = ring && !cut;

      if (isC) {
        row.push(255, 255, 255, 230); // white letter
      } else {
        // amber background  #D97706
        row.push(217, 119, 6, 255);
      }
    }
    rows.push(Buffer.from(row));
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function crc32(buf) {
    const table = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      return t;
    })();
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t   = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  }

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  // rest zero: compression, filter, interlace

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

for (const size of [16, 48, 128]) {
  const png = makePNG(size);
  fs.writeFileSync(path.join(dir, `icon${size}.png`), png);
  console.log(`Created icons/icon${size}.png`);
}
console.log('Done!');
