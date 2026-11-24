/**
 * 星環都市アステリア ― マップデータ (src/game/map/asteriaMap.js)
 *
 * 描画・DOM には依存しない純粋なデータ生成。80×60 タイル（1タイル=32px）。
 * 描画は mapRenderer.js、当たり判定は world/collision.js が担当する。
 * 将来の別エリアは、同じ形式（cols/rows/ground/props/colliders/spawn）を返す関数を追加する。
 */

export const MAP_COLS = 80;
export const MAP_ROWS = 60;

export const GROUND = Object.freeze({ GRASS: 0, PLAZA: 1, ROAD: 2 });

// レイアウト（タイル単位）
const PLAZA = Object.freeze({ x: 28, y: 21, w: 24, h: 18 });
const ROAD_H = Object.freeze({ y: 28, h: 4 });
const ROAD_V = Object.freeze({ x: 38, w: 4 });
const FOUNTAIN_TILE = Object.freeze({ x: 40, y: 30 }); // 噴水の中心（タイル境界）
const SPAWN_TILE = Object.freeze({ x: 40, y: 35 });    // 中央広場・噴水の南

// [x, y, w, h, style]
const BUILDINGS = [
  [4, 4, 9, 6, 0], [16, 5, 8, 5, 1], [26, 6, 7, 6, 2], [4, 15, 8, 6, 3], [15, 16, 7, 5, 4],
  [48, 5, 7, 6, 1], [57, 4, 9, 7, 3], [68, 6, 8, 6, 0], [56, 16, 8, 6, 2], [68, 17, 7, 5, 4],
  [4, 36, 8, 6, 2], [15, 35, 8, 6, 0], [4, 46, 9, 7, 4], [17, 47, 7, 6, 1], [28, 44, 8, 6, 3],
  [45, 43, 8, 6, 4], [56, 36, 8, 6, 1], [67, 37, 8, 6, 3], [57, 47, 8, 7, 0], [68, 48, 7, 6, 2],
];

// [x, y, 幅(タイル)] 広場の花壇
const PLANTERS = [[30, 22, 4], [46, 22, 4], [30, 37, 4], [46, 37, 4]];

// 広場内の街灯（タイル）
const PLAZA_LAMPS = [[29, 22], [50, 22], [29, 37], [50, 37], [36, 26], [43, 26], [36, 33], [43, 33]];

/** 座標から 0〜1 の決定的な擬似乱数を返す（マップ・見た目が毎回同じになる）。 */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * @param {number} [tileSize=32] 見た目（ドット絵）は 32px 前提
 */
export function createAsteriaMap(tileSize = 32) {
  const T = tileSize;
  const cols = MAP_COLS;
  const rows = MAP_ROWS;
  const ground = new Uint8Array(cols * rows);
  const occ = new Uint8Array(cols * rows); // 建物・小物の占有（木や花の配置回避用）
  const props = [];
  const colliders = [];
  const flowers = [];

  const inMap = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const tileAt = (x, y) => (inMap(x, y) ? ground[y * cols + x] : GROUND.GRASS);
  const fill = (arr, x, y, w, h, v) => {
    for (let ty = Math.max(0, y); ty < Math.min(rows, y + h); ty += 1) {
      for (let tx = Math.max(0, x); tx < Math.min(cols, x + w); tx += 1) arr[ty * cols + tx] = v;
    }
  };

  // 地形（道路 → 広場の順に上書き）
  fill(ground, 0, ROAD_H.y, cols, ROAD_H.h, GROUND.ROAD);
  fill(ground, ROAD_V.x, 0, ROAD_V.w, rows, GROUND.ROAD);
  fill(ground, PLAZA.x, PLAZA.y, PLAZA.w, PLAZA.h, GROUND.PLAZA);

  // 噴水（中心 = 基準点）
  const fx = FOUNTAIN_TILE.x * T;
  const fy = FOUNTAIN_TILE.y * T;
  props.push({ type: 'fountain', x: fx, y: fy, sortY: fy + 40 });
  colliders.push({ x: fx - 58, y: fy - 38, w: 116, h: 78 });

  // 花壇
  for (const [tx, ty, tw] of PLANTERS) {
    props.push({ type: 'planter', x: tx * T, y: ty * T + 4, w: tw * T, sortY: ty * T + 30 });
    colliders.push({ x: tx * T + 2, y: ty * T + 12, w: tw * T - 4, h: 18 });
    fill(occ, tx, ty, tw, 1, 1);
  }

  // 建物（足元の矩形すべてを衝突対象にする）
  BUILDINGS.forEach(([bx, by, bw, bh, style]) => {
    props.push({ type: 'building', x: bx * T, y: by * T, w: bw * T, h: bh * T, style, sortY: (by + bh) * T });
    colliders.push({ x: bx * T, y: by * T, w: bw * T, h: bh * T });
    fill(occ, bx - 1, by - 1, bw + 2, bh + 2, 1);
  });

  // 街灯
  const addLamp = (tx, ty) => {
    const x = tx * T + T / 2;
    const y = ty * T + T - 4;
    props.push({ type: 'lamp', x, y, sortY: y });
    colliders.push({ x: x - 3, y: y - 6, w: 6, h: 6 });
    fill(occ, tx - 1, ty - 1, 3, 3, 1);
  };
  for (const [tx, ty] of PLAZA_LAMPS) addLamp(tx, ty);
  const lampOk = (tx, ty) => inMap(tx, ty) && tileAt(tx, ty) !== GROUND.ROAD && tileAt(tx, ty) !== GROUND.PLAZA && !occ[ty * cols + tx];
  for (let x = 2; x < cols; x += 6) {
    if (lampOk(x, ROAD_H.y - 1)) addLamp(x, ROAD_H.y - 1);
    if (lampOk(x, ROAD_H.y + ROAD_H.h)) addLamp(x, ROAD_H.y + ROAD_H.h);
  }
  for (let y = 2; y < rows; y += 6) {
    if (lampOk(ROAD_V.x - 1, y)) addLamp(ROAD_V.x - 1, y);
    if (lampOk(ROAD_V.x + ROAD_V.w, y)) addLamp(ROAD_V.x + ROAD_V.w, y);
  }

  // 街路樹
  const addTree = (tx, ty) => {
    const x = tx * T + T / 2 + Math.round((hash2(tx, ty, 3) - 0.5) * 8);
    const y = ty * T + T - 2;
    props.push({ type: 'tree', x, y, variant: Math.floor(hash2(tx, ty, 5) * 3), sortY: y });
    colliders.push({ x: x - 5, y: y - 8, w: 10, h: 8 });
    fill(occ, tx - 1, ty - 1, 3, 3, 1);
  };
  const treeOk = (tx, ty) => inMap(tx, ty) && tileAt(tx, ty) === GROUND.GRASS && !occ[ty * cols + tx];
  for (let x = 1; x < cols - 1; x += 3) {
    if (treeOk(x, ROAD_H.y - 1)) addTree(x, ROAD_H.y - 1);
    if (treeOk(x, ROAD_H.y + ROAD_H.h)) addTree(x, ROAD_H.y + ROAD_H.h);
  }
  for (let y = 1; y < rows - 1; y += 3) {
    if (treeOk(ROAD_V.x - 1, y)) addTree(ROAD_V.x - 1, y);
    if (treeOk(ROAD_V.x + ROAD_V.w, y)) addTree(ROAD_V.x + ROAD_V.w, y);
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const border = x <= 1 || y <= 1 || x >= cols - 2 || y >= rows - 2;
      if (treeOk(x, y) && hash2(x, y, 7) < (border ? 0.6 : 0.05)) addTree(x, y);
    }
  }

  // 装飾用の草花（当たり判定なし）
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (tileAt(x, y) === GROUND.GRASS && !occ[y * cols + x] && hash2(x, y, 11) < 0.06) {
        flowers.push({
          x: x * T + 4 + Math.floor(hash2(x, y, 12) * 22),
          y: y * T + 4 + Math.floor(hash2(x, y, 13) * 22),
          color: Math.floor(hash2(x, y, 14) * 5),
        });
      }
    }
  }

  props.sort((a, b) => a.sortY - b.sortY);

  return {
    name: '星環都市アステリア',
    cols,
    rows,
    tileSize: T,
    width: cols * T,
    height: rows * T,
    ground,
    tileAt,
    props,
    colliders,
    flowers,
    fountain: { x: fx, y: fy },
    spawn: { x: SPAWN_TILE.x * T, y: SPAWN_TILE.y * T + T / 2 },
  };
}
