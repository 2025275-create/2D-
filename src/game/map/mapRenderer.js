/**
 * マップ描画 (src/game/map/mapRenderer.js)
 *
 * - 地面は読み込み時に 1 枚のオフスクリーン Canvas へ描き込み、毎フレームは見える範囲だけ転写する。
 * - 建物・木・街灯などは小さなスプライト Canvas に 1 回だけ描き、毎フレームは drawImage するだけ。
 * - 画面外の物は描画を省略する。Y ソートで手前・奥の重なりを決める（動くものは entities で渡す）。
 * - すべて fillRect で描く仮素材。画像素材に置き換えるときは buildSprites() の中身だけ差し替える。
 */

import { GROUND, hash2 } from './asteriaMap.js';

const rect = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

/** アンチエイリアスなしの楕円塗り（ドット絵の見た目を保つ）。 */
function ellipse(g, c, cx, cy, rx, ry) {
  g.fillStyle = c;
  for (let dy = -ry; dy <= ry; dy += 1) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    g.fillRect(cx - half, cy + dy, half * 2, 1);
  }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/* ---------- 地面タイル ---------- */

function paintGrass(g, px, py, tx, ty) {
  const h = hash2(tx, ty, 1);
  rect(g, h < 0.34 ? '#3a7841' : h < 0.67 ? '#36723e' : '#3e7f45', px, py, 32, 32);
  for (let i = 0; i < 6; i += 1) {
    const x = px + Math.floor(hash2(tx, ty, 20 + i) * 30);
    const y = py + Math.floor(hash2(tx, ty, 40 + i) * 30);
    rect(g, i & 1 ? '#4d9254' : '#2b5e33', x, y, 2, i % 3 === 0 ? 3 : 2);
  }
}

function paintPlaza(g, px, py, tx, ty, map) {
  rect(g, (tx + ty) & 1 ? '#a4aec2' : '#a9b3c7', px, py, 32, 32);
  const joint = '#838da4';
  rect(g, joint, px, py, 32, 1);
  rect(g, joint, px, py + 16, 32, 1);
  rect(g, joint, px + 8, py + 1, 1, 15);
  rect(g, joint, px + 24, py + 1, 1, 15);
  rect(g, joint, px, py + 17, 1, 15);
  rect(g, joint, px + 16, py + 17, 1, 15);
  for (let i = 0; i < 4; i += 1) {
    rect(g, i & 1 ? '#c4cddd' : '#8e98ae', px + 2 + Math.floor(hash2(tx, ty, 60 + i) * 26), py + 2 + Math.floor(hash2(tx, ty, 70 + i) * 26), 3, 1);
  }
  // 草地に接する縁（銀の縁石）
  const edge = (dx, dy, x, y, w, h, x2, y2, w2, h2) => {
    if (map.tileAt(tx + dx, ty + dy) === GROUND.GRASS) { rect(g, '#dfe6f2', px + x, py + y, w, h); rect(g, '#6f7a92', px + x2, py + y2, w2, h2); }
  };
  edge(0, -1, 0, 0, 32, 3, 0, 3, 32, 1);
  edge(0, 1, 0, 29, 32, 3, 0, 28, 32, 1);
  edge(-1, 0, 0, 0, 3, 32, 3, 0, 1, 32);
  edge(1, 0, 29, 0, 3, 32, 28, 0, 1, 32);
}

function paintRoad(g, px, py, tx, ty, map) {
  rect(g, '#8a8377', px, py, 32, 32);
  for (let i = 0; i < 7; i += 1) {
    const x = px + Math.floor(hash2(tx, ty, 80 + i) * 26);
    const y = py + Math.floor(hash2(tx, ty, 90 + i) * 28);
    rect(g, i & 1 ? '#9d968a' : '#756f64', x, y, 5, 3);
  }
  const curb = (dx, dy, x, y, w, h, x2, y2, w2, h2) => {
    if (map.tileAt(tx + dx, ty + dy) === GROUND.GRASS) { rect(g, '#5d584f', px + x, py + y, w, h); rect(g, '#a59e91', px + x2, py + y2, w2, h2); }
  };
  curb(0, -1, 0, 0, 32, 3, 0, 3, 32, 1);
  curb(0, 1, 0, 29, 32, 3, 0, 28, 32, 1);
  curb(-1, 0, 0, 0, 3, 32, 3, 0, 1, 32);
  curb(1, 0, 29, 0, 3, 32, 28, 0, 1, 32);
}

/** 天環をかたどった広場の象嵌（銀の輪・金の放射線）。 */
function paintRings(g, cx, cy) {
  const ring = (r, color, size) => {
    const n = Math.ceil((Math.PI * 2 * r) / 1.5);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      rect(g, color, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.82), size, size);
    }
  };
  ring(112, '#e8eef8', 3);
  ring(118, '#d6b25e', 2);
  ring(176, '#8fb8e8', 2);
  ring(182, '#e8eef8', 2);
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    for (let r = 128; r <= 164; r += 2) rect(g, '#d6b25e', Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.82), 2, 2);
  }
}

const FLOWER_COLORS = ['#ff8fb3', '#ffe27a', '#c8a8ff', '#ffffff', '#8fd8ff'];

function paintFlower(g, f) {
  rect(g, '#2f7a3a', f.x + 1, f.y + 2, 1, 3);
  const c = FLOWER_COLORS[f.color];
  rect(g, c, f.x, f.y + 1, 3, 1);
  rect(g, c, f.x + 1, f.y, 1, 3);
  rect(g, '#ffe27a', f.x + 1, f.y + 1, 1, 1);
}

/* ---------- 小物スプライト ---------- */

const STYLES = [
  { roof: '#3d5aa8', hi: '#5876c8', lo: '#2a4080', wall: '#d9d3c1', trim: '#8a7f66' },
  { roof: '#6a4f9a', hi: '#8a6fba', lo: '#4a3678', wall: '#cfd6e6', trim: '#7d88a6' },
  { roof: '#2f7a80', hi: '#48a0a6', lo: '#1f5459', wall: '#e0dccb', trim: '#8f8a73' },
  { roof: '#8a4a52', hi: '#ad6870', lo: '#62323a', wall: '#d6cdb8', trim: '#85775c' },
  { roof: '#5f6f8a', hi: '#8493ad', lo: '#435068', wall: '#e2e6ee', trim: '#8590a8' },
];

function buildingSprite(p) {
  const { w, h } = p;
  const S = STYLES[p.style];
  const [c, g] = makeCanvas(w + 8, h + 6);
  const bx = 4;
  const wallH = 44;
  const roofH = h - wallH;

  rect(g, 'rgba(0,0,0,0.22)', bx + 2, h, w, 6);
  rect(g, S.lo, 0, 0, w + 8, roofH);
  rect(g, S.roof, 2, 2, w + 4, roofH - 4);
  for (let row = 0; row * 8 < roofH - 6; row += 1) {
    const y = 4 + row * 8;
    rect(g, S.lo, 2, y + 7, w + 4, 1);
    for (let x = (row & 1) * 6; x < w + 4; x += 12) rect(g, S.lo, 2 + x, y, 1, 7);
  }
  rect(g, S.hi, 2, 2, w + 4, 3);
  if (p.style % 2 === 0) { rect(g, '#6d6a7a', bx + w - 30, 6, 10, 18); rect(g, '#4a4858', bx + w - 31, 4, 12, 3); }
  rect(g, 'rgba(0,0,0,0.28)', bx, roofH, w, 4);

  const wy = roofH + 4;
  rect(g, S.wall, bx, wy, w, wallH - 4);
  for (let y = 8; y < wallH - 4; y += 8) rect(g, 'rgba(0,0,0,0.06)', bx, wy + y, w, 1);
  rect(g, S.trim, bx, wy, w, 2);
  rect(g, S.trim, bx, h - 6, w, 6);

  const doorCx = bx + (w >> 1);
  const n = Math.max(2, Math.floor(w / 44));
  for (let i = 0; i < n; i += 1) {
    const cx = bx + Math.round(((i + 0.5) * w) / n);
    if (Math.abs(cx - doorCx) < 18) continue;
    rect(g, '#3b3f58', cx - 8, wy + 6, 16, 18);
    rect(g, '#8fcff5', cx - 7, wy + 7, 14, 16);
    rect(g, '#e8f4ff', cx - 1, wy + 7, 2, 16);
    rect(g, '#e8f4ff', cx - 7, wy + 14, 14, 2);
    rect(g, S.trim, cx - 9, wy + 24, 18, 2);
  }
  rect(g, '#3b2a20', doorCx - 11, h - 32, 22, 32);
  rect(g, '#5b3c2a', doorCx - 9, h - 30, 18, 30);
  rect(g, '#46301f', doorCx, h - 30, 1, 30);
  rect(g, '#d6b25e', doorCx + 5, h - 15, 2, 2);
  if (p.style === 0 || p.style === 3) { rect(g, '#d6b25e', doorCx + 16, wy + 8, 12, 8); rect(g, '#3b2a20', doorCx + 16, wy + 6, 12, 2); }

  p.sprite = c;
  p.drawX = p.x - bx;
  p.drawY = p.y;
}

const TREE_PALETTES = [
  ['#215a30', '#2f7a3f', '#4a9a52', '#79c070'],
  ['#1f5a45', '#2c7a5d', '#47a07e', '#7fd0aa'],
  ['#2b5a2a', '#3d7f3a', '#62a24c', '#9acb6a'],
];

function treeSprite(variant) {
  const [c, g] = makeCanvas(64, 72);
  const pal = TREE_PALETTES[variant];
  ellipse(g, 'rgba(0,0,0,0.25)', 32, 66, 18, 5);
  rect(g, '#5a3b26', 28, 48, 8, 18);
  rect(g, '#44291a', 28, 48, 2, 18);
  ellipse(g, pal[0], 32, 28, 22, 22);
  ellipse(g, pal[1], 30, 25, 19, 19);
  ellipse(g, pal[2], 26, 19, 10, 10);
  ellipse(g, pal[3], 22, 15, 4, 4);
  for (let i = 0; i < 10; i += 1) rect(g, pal[i % 2 ? 3 : 0], 14 + Math.floor(hash2(variant, i, 9) * 36), 10 + Math.floor(hash2(variant, i, 10) * 34), 2, 2);
  return c;
}

function lampSprite() {
  const [c, g] = makeCanvas(40, 60);
  ellipse(g, 'rgba(159,216,255,0.07)', 20, 16, 18, 18);
  ellipse(g, 'rgba(159,216,255,0.10)', 20, 16, 12, 12);
  ellipse(g, 'rgba(0,0,0,0.25)', 20, 56, 8, 3);
  rect(g, '#2b3350', 18, 22, 4, 34);
  rect(g, '#3a4468', 15, 50, 10, 6);
  rect(g, '#3a4468', 14, 8, 12, 16);
  rect(g, '#dff3ff', 16, 11, 8, 10);
  rect(g, '#ffffff', 18, 13, 2, 4);
  rect(g, '#c9d3e3', 13, 5, 14, 4);
  rect(g, '#d6b25e', 18, 2, 4, 3);
  return c;
}

function planterSprite(p) {
  const [c, g] = makeCanvas(p.w, 28);
  rect(g, '#8a93a8', 0, 6, p.w, 22);
  rect(g, '#c9d3e3', 0, 4, p.w, 4);
  rect(g, '#6f7a92', 0, 24, p.w, 4);
  rect(g, '#4a3626', 3, 8, p.w - 6, 12);
  for (let x = 4; x < p.w - 6; x += 5) {
    const k = Math.floor(hash2(x, p.x, 21) * 5);
    rect(g, '#2f7a3a', x + 1, 6, 1, 4);
    rect(g, FLOWER_COLORS[k], x, 3 + (x % 3), 3, 3);
    rect(g, '#ffe27a', x + 1, 4 + (x % 3), 1, 1);
  }
  return c;
}

function fountainSprite() {
  const [c, g] = makeCanvas(160, 140);
  ellipse(g, 'rgba(0,0,0,0.18)', 80, 100, 66, 40);
  ellipse(g, '#8d98ae', 80, 92, 64, 46);
  ellipse(g, '#d6b25e', 80, 88, 62, 44);
  ellipse(g, '#cfd8e8', 80, 88, 60, 42);
  ellipse(g, '#2f86c8', 80, 90, 54, 37);
  ellipse(g, '#4fb6ef', 80, 89, 50, 34);
  ellipse(g, '#cfd8e8', 80, 92, 14, 6);
  rect(g, '#e8edf6', 74, 44, 12, 48);
  rect(g, '#b8c2d6', 82, 44, 4, 48);
  ellipse(g, '#cfd8e8', 80, 50, 22, 7);
  ellipse(g, '#4fb6ef', 80, 49, 19, 5);
  rect(g, '#e8edf6', 77, 24, 6, 26);
  ellipse(g, '#cfd8e8', 80, 24, 10, 4);
  rect(g, '#d6b25e', 78, 12, 4, 10);
  rect(g, '#f6e3a8', 79, 8, 2, 6);
  return c;
}

/* ---------- 描画クラス ---------- */

export class MapRenderer {
  /** @param {ReturnType<import('./asteriaMap.js').createAsteriaMap>} map */
  constructor(map) {
    this.map = map;
    this.ground = null;
    this.buildGround();
    this.buildSprites();
  }

  buildGround() {
    const { map } = this;
    const T = map.tileSize;
    const [c, g] = makeCanvas(map.width, map.height);
    for (let ty = 0; ty < map.rows; ty += 1) {
      for (let tx = 0; tx < map.cols; tx += 1) {
        const kind = map.ground[ty * map.cols + tx];
        if (kind === GROUND.PLAZA) paintPlaza(g, tx * T, ty * T, tx, ty, map);
        else if (kind === GROUND.ROAD) paintRoad(g, tx * T, ty * T, tx, ty, map);
        else paintGrass(g, tx * T, ty * T, tx, ty);
      }
    }
    paintRings(g, map.fountain.x, map.fountain.y);
    for (const f of map.flowers) paintFlower(g, f);
    this.ground = c;
  }

  buildSprites() {
    const trees = [treeSprite(0), treeSprite(1), treeSprite(2)];
    const lamp = lampSprite();
    const fountain = fountainSprite();
    for (const p of this.map.props) {
      if (p.type === 'building') buildingSprite(p);
      else if (p.type === 'tree') { p.sprite = trees[p.variant]; p.drawX = p.x - 32; p.drawY = p.y - 66; }
      else if (p.type === 'lamp') { p.sprite = lamp; p.drawX = p.x - 20; p.drawY = p.y - 56; }
      else if (p.type === 'planter') { p.sprite = planterSprite(p); p.drawX = p.x; p.drawY = p.y; }
      else if (p.type === 'fountain') { p.sprite = fountain; p.drawX = p.x - 80; p.drawY = p.y - 90; }
      p.l = p.drawX;
      p.t = p.drawY;
      p.r = p.drawX + p.sprite.width;
      p.b = p.drawY + p.sprite.height;
    }
  }

  /** 地面のうち画面に見える範囲だけを転写する。 */
  drawGround(ctx, ox, oy, viewW, viewH) {
    const sx = Math.max(0, ox);
    const sy = Math.max(0, oy);
    const sw = Math.min(this.map.width, ox + viewW) - sx;
    const sh = Math.min(this.map.height, oy + viewH) - sy;
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(this.ground, sx, sy, sw, sh, sx - ox, sy - oy, sw, sh);
  }

  /**
   * 小物と動くもの（プレイヤー・将来の敵や NPC）を Y 順に描く。
   * @param {{sortY:number, draw:(ctx:CanvasRenderingContext2D, ox:number, oy:number)=>void}[]} entities sortY の昇順
   */
  drawWorld(ctx, ox, oy, viewW, viewH, time, entities) {
    const props = this.map.props;
    const right = ox + viewW;
    const bottom = oy + viewH;
    let e = 0;
    for (let i = 0; i < props.length; i += 1) {
      const p = props[i];
      while (e < entities.length && entities[e].sortY <= p.sortY) { entities[e].draw(ctx, ox, oy); e += 1; }
      if (p.r < ox || p.l > right || p.b < oy || p.t > bottom) continue; // 画面外は描かない
      ctx.drawImage(p.sprite, p.drawX - ox, p.drawY - oy);
      if (p.type === 'fountain') this.drawFountainWater(ctx, p.drawX - ox, p.drawY - oy, time);
    }
    while (e < entities.length) { entities[e].draw(ctx, ox, oy); e += 1; }
  }

  /** 噴水の水面のきらめきと水しぶき（スプライト座標 (80, 24) が噴出口）。 */
  drawFountainWater(ctx, x, y, time) {
    ctx.fillStyle = 'rgba(232,248,255,0.65)';
    for (let k = 0; k < 7; k += 1) {
      const a = time * 0.7 + k * 1.1;
      ctx.fillRect(Math.round(x + 80 + Math.cos(a) * 40), Math.round(y + 90 + Math.sin(a) * 22), 3, 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 8; k += 1) {
      const ph = (time * 0.9 + k / 8) % 1;
      const side = k & 1 ? 1 : -1;
      const dist = ph * 34 * (0.6 + (k % 4) * 0.15);
      ctx.fillRect(Math.round(x + 80 + side * dist), Math.round(y + 24 + 88 * ph * ph - 28 * ph), 2, 2);
    }
  }

  dispose() {
    this.ground = null;
    this.map = null;
  }
}
