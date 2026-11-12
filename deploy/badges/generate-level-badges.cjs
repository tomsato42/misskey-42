/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// "Lv.N" のドット絵バッジを SVG で作る。
// - 高さ 32px: グリフの 1 ドットを 4x4 にして数字 28px、縁取り 1px、上下の余白 1px
// - 色: 0 はコメントのグレー、1〜2 は通常の文字の白、3 からは 3 レベルごと、21 は root のプロンプトの赤 (ターミナルの xterm-256 の色)
// - 塗り: 左下が暗く右上が明るい斜めのグラデーションを、4x4 の Bayer 行列のディザで表す
// - 縁取り: 黒だけ
// - グロー: 文字の色をぼかして下に敷く
const D = { // 5x7
  0: ['01110','10001','10011','10101','11001','10001','01110'],
  1: ['00100','01100','00100','00100','00100','00100','01110'],
  2: ['01110','10001','00001','00010','00100','01000','11111'],
  3: ['11110','00001','00001','01110','00001','00001','11110'],
  4: ['00010','00110','01010','10010','11111','00010','00010'],
  5: ['11111','10000','11110','00001','00001','10001','01110'],
  6: ['00110','01000','10000','11110','10001','10001','01110'],
  7: ['11111','00001','00010','00100','01000','01000','01000'],
  8: ['01110','10001','10001','01110','10001','10001','01110'],
  9: ['01110','10001','10001','01111','00001','00010','01100'],
};
const SMALL = { // 3x5
  L: ['100','100','100','100','111'],
  v: ['000','101','101','101','010'],
  '.': ['0','0','0','0','1'],
};
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function colorFor(level) {
  if (level === 0) return '#808080';
  if (level <= 2) return '#e4e4e4';
  if (level >= 21) return '#ff5f5f';
  const TIERS = ['#5f87ff', '#00d7ff', '#5fff5f', '#ffd75f', '#ff5fff', '#ff8700'];
  return TIERS[Math.floor((level - 3) / 3)];
}
function hexToRgb(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function rgbToHex(c) { return '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, f) { return a.map((v, i) => v + (b[i] - v) * f); }

function badgeSvg(level, S = 4) {
  const MARGIN = 1, OUTLINE = 1;
  const top = MARGIN + OUTLINE, H = 7 * S;
  const glyphs = [];
  let x = MARGIN + OUTLINE;
  for (const ch of ['L', 'v', '.']) { glyphs.push({ rows: SMALL[ch], x, y: top + (H - 5 * S) }); x += (SMALL[ch][0].length + 1) * S; }
  for (const ch of String(level)) { glyphs.push({ rows: D[ch], x, y: top }); x += 6 * S; }
  const width = x - S + OUTLINE + MARGIN, height = H + 2 * (OUTLINE + MARGIN);

  const on = new Set();
  for (const g of glyphs) g.rows.forEach((row, dy) => [...row].forEach((b, dx) => {
    if (b !== '1') return;
    for (let sx = 0; sx < S; sx++) for (let sy = 0; sy < S; sy++) on.add(`${g.x + dx * S + sx},${g.y + dy * S + sy}`);
  }));
  const outline = new Set();
  for (const k of on) {
    const [px, py] = k.split(',').map(Number);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const kk = `${px + ox},${py + oy}`; if (!on.has(kk)) outline.add(kk); }
  }

  const base = hexToRgb(colorFor(level));
  const tones = [mix(base, [255, 255, 255], 0.55), base, mix(base, [0, 0, 0], 0.45)];
  // 暗さ t: 左ほど・下ほど暗い (右上が最も明るい)
  const toneAt = (px, py) => {
    const t = Math.min(1, Math.max(0, (1 - px / width) * 0.65 + (py / height) * 0.35)) * (tones.length - 1);
    const i = Math.floor(t);
    const pick = (t - i) * 16 > BAYER[py % 4][px % 4] + 0.5 ? i + 1 : i;
    return rgbToHex(tones[Math.min(pick, tones.length - 1)]);
  };
  const rect = (px, py, fill) => `<rect x="${px}" y="${py}" width="1" height="1" fill="${fill}"/>`;
  const outlineRects = [], fillRects = [], flatRects = [];
  for (const k of outline) { const [px, py] = k.split(",").map(Number); outlineRects.push(rect(px, py, "#000000")); }
  for (const k of on) {
    const [px, py] = k.split(",").map(Number);
    fillRects.push(rect(px, py, toneAt(px, py)));
    flatRects.push(rect(px, py, rgbToHex(base)));
  }
  const defs = [];
  const layers = [];
  // グロー: 文字の色をぼかして下に敷き、光っているように見せる
  defs.push(`<filter id="glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="1.6"/></filter>`);
  layers.push(`<g filter="url(#glow)" opacity="0.9">${flatRects.join("")}</g>`);
  layers.push(outlineRects.join(""), fillRects.join(""));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${layers.join("")}</svg>`;
}
module.exports = { badgeSvg, colorFor };

// node deploy/badges/generate-level-badges.cjs [出力先] で、Lv.0〜30 の SVG を書き出す
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const outDir = process.argv[2] ?? path.join(__dirname, "..", "instance-assets", "badges");
  fs.mkdirSync(outDir, { recursive: true });
  for (let level = 0; level <= 30; level++) fs.writeFileSync(path.join(outDir, `lv-${level}.svg`), badgeSvg(level));
  console.log(`wrote 31 badges to ${outDir}`);
}
