/**
 * 当たり判定 (src/game/world/collision.js)
 *
 * - CollisionGrid: 矩形をタイルごとに登録し、領域に重なる矩形だけを素早く取得する。
 * - moveBody: 軸ごとに移動 → 押し戻しを行い、壁沿いにスライドできるようにする。
 *
 * body = { x, y, hw, hh }  x: 中心X / y: 足元Y / hw: 半幅 / hh: 高さ（足元から上へ）
 */

const MAX_STEP = 8; // 1回に動かす最大距離（px）。すり抜け防止のため大きな移動は分割する。

export class CollisionGrid {
  /**
   * @param {number} cols
   * @param {number} rows
   * @param {number} tileSize
   * @param {{x:number,y:number,w:number,h:number}[]} rects
   */
  constructor(cols, rows, tileSize, rects) {
    this.cols = cols;
    this.rows = rows;
    this.tile = tileSize;
    this.rects = rects;
    this.cells = new Array(cols * rows).fill(null);
    this.seen = new Int32Array(rects.length);
    this.stamp = 0;
    this.hits = []; // 使い回す結果配列（毎フレームの生成を避ける）

    rects.forEach((r, i) => {
      const [x0, y0, x1, y1] = this.range(r.x, r.y, r.x + r.w, r.y + r.h);
      for (let ty = y0; ty <= y1; ty += 1) {
        for (let tx = x0; tx <= x1; tx += 1) {
          const k = ty * cols + tx;
          if (!this.cells[k]) this.cells[k] = [];
          this.cells[k].push(i);
        }
      }
    });
  }

  range(l, t, r, b) {
    const T = this.tile;
    return [
      Math.max(0, Math.floor(l / T)),
      Math.max(0, Math.floor(t / T)),
      Math.min(this.cols - 1, Math.floor((r - 1e-6) / T)),
      Math.min(this.rows - 1, Math.floor((b - 1e-6) / T)),
    ];
  }

  /** 領域 (l,t)-(r,b) に重なる可能性のある矩形を返す（戻り値は使い回しの配列）。 */
  query(l, t, r, b) {
    const out = this.hits;
    out.length = 0;
    this.stamp += 1;
    const [x0, y0, x1, y1] = this.range(l, t, r, b);
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        const cell = this.cells[ty * this.cols + tx];
        if (!cell) continue;
        for (let n = 0; n < cell.length; n += 1) {
          const i = cell[n];
          if (this.seen[i] !== this.stamp) {
            this.seen[i] = this.stamp;
            out.push(this.rects[i]);
          }
        }
      }
    }
    return out;
  }

  /** body が矩形のどれかに重なっているか（テスト・配置確認用）。 */
  overlaps(body) {
    const hits = this.query(body.x - body.hw, body.y - body.hh, body.x + body.hw, body.y);
    for (const r of hits) {
      if (body.x - body.hw < r.x + r.w && body.x + body.hw > r.x && body.y - body.hh < r.y + r.h && body.y > r.y) return true;
    }
    return false;
  }
}

function resolveAxis(grid, body, horizontal, positive, mapW, mapH) {
  let blocked = false;
  // マップ外へ出さない
  if (horizontal) {
    if (body.x - body.hw < 0) { body.x = body.hw; blocked = true; }
    else if (body.x + body.hw > mapW) { body.x = mapW - body.hw; blocked = true; }
  } else if (body.y - body.hh < 0) { body.y = body.hh; blocked = true; }
  else if (body.y > mapH) { body.y = mapH; blocked = true; }

  // 障害物から押し戻す（隣り合う矩形が連続する場合に備えて数回繰り返す）
  for (let pass = 0; pass < 4; pass += 1) {
    const hits = grid.query(body.x - body.hw, body.y - body.hh, body.x + body.hw, body.y);
    let changed = false;
    for (let i = 0; i < hits.length; i += 1) {
      const r = hits[i];
      if (body.x - body.hw < r.x + r.w && body.x + body.hw > r.x && body.y - body.hh < r.y + r.h && body.y > r.y) {
        if (horizontal) body.x = positive ? r.x - body.hw : r.x + r.w + body.hw;
        else body.y = positive ? r.y : r.y + r.h + body.hh;
        blocked = true;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return blocked;
}

/**
 * body を (dx, dy) だけ動かす。X と Y を別々に解決するので、壁に斜めにぶつかると壁沿いに滑る。
 * 結果は body.blockedX / body.blockedY に入る。
 */
export function moveBody(grid, body, dx, dy, mapW, mapH) {
  body.blockedX = false;
  body.blockedY = false;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_STEP));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i += 1) {
    if (sx !== 0) {
      body.x += sx;
      if (resolveAxis(grid, body, true, sx > 0, mapW, mapH)) body.blockedX = true;
    }
    if (sy !== 0) {
      body.y += sy;
      if (resolveAxis(grid, body, false, sy > 0, mapW, mapH)) body.blockedY = true;
    }
  }
}
