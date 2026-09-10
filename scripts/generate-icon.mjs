// T039 — 生成应用图标 resources/icon.ico
//
// Windows .ico 支持内嵌 PNG（Vista+）。本脚本用纯 Node（zlib）生成一个
// 256×256 PNG（蓝色背景 + 白色圆），再包装为单图 .ico，避免引入图像依赖。
//
// 用法: node scripts/generate-icon.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(projectRoot, 'resources', 'icon.ico');

const SIZE = 256;

// ---- 画像素：蓝色背景 #1677FF + 居中白色圆（半径 88，2px 蓝色描边留白） ----
const pixels = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2;
const cy = SIZE / 2;
const R = 88;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const d = Math.hypot(x - cx, y - cy);
    let r;
    let g;
    let b;
    if (d <= R) {
      r = 255;
      g = 255;
      b = 255;
    } else {
      r = 0x16;
      g = 0x77;
      b = 0xff;
    }
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
}

// ---- PNG 编码 ----
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
// 原始扫描线：每行前加 filter byte 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ---- ICO 容器：头部 + 单条目目录 + PNG 数据 ----
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count
const dir = Buffer.alloc(16);
dir[0] = 0; // width 0 = 256
dir[1] = 0; // height 0 = 256
dir[2] = 0; // palette
dir[3] = 0; // reserved
dir.writeUInt16LE(1, 4); // color planes
dir.writeUInt16LE(32, 6); // bit count
dir.writeUInt32LE(png.length, 8); // data size
dir.writeUInt32LE(22, 12); // data offset (6 + 16)
const ico = Buffer.concat([header, dir, png]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, ico);
console.log(`[generate-icon] wrote ${outPath} (${ico.length} bytes)`);
