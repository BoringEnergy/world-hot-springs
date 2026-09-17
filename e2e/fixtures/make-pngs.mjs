/**
 * Writes the two PNG fixtures the offline harness serves. Run once; the PNGs
 * are committed.
 *
 *   node e2e/fixtures/make-pngs.mjs
 *
 * terrarium-flat.png  256x256, every pixel RGB (128, 0, 0). Terrarium encodes
 *                     elevation as R*256 + G + B/256 - 32768, so this is a
 *                     tile of sea level everywhere: terrain switches on and
 *                     draws nothing. It stands in for the satellite imagery
 *                     too, which only has to decode.
 * sprite.png          1x1 transparent. The style's sprite sheet, with an
 *                     empty index beside it: no icon is ever looked up.
 *
 * A PNG is a signature and three chunks, so this needs zlib and nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 8-bit truecolour (with alpha when `pixel` has four channels), filter 0. */
function png(width, height, pixel) {
  const channels = pixel.length;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(pixel).flat())]);
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.writeFileSync(path.join(HERE, 'terrarium-flat.png'), png(256, 256, [128, 0, 0]));
fs.writeFileSync(path.join(HERE, 'sprite.png'), png(1, 1, [0, 0, 0, 0]));
