/**
 * カメラ (src/game/camera.js)
 *
 * ワールド座標（マップ上の px）と画面座標（論理 px）を分離する。
 * 敵・NPC・ミニマップは worldToScreen / isVisible を使えば同じカメラに乗せられる。
 * x, y は表示領域の左上のワールド座標。描画には整数化した renderX / renderY を使い、
 * ドット絵が揺れないようにする。
 */
export class Camera {
  /**
   * @param {object} options
   * @param {number} options.mapWidth
   * @param {number} options.mapHeight
   * @param {number} [options.smoothing=10] 大きいほど素早く追従する（毎秒）
   */
  constructor({ mapWidth, mapHeight, smoothing = 10 }) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.smoothing = smoothing;
    this.viewWidth = 1;
    this.viewHeight = 1;
    this.x = 0;
    this.y = 0;
  }

  get renderX() { return Math.round(this.x); }
  get renderY() { return Math.round(this.y); }

  setViewport(width, height) {
    this.viewWidth = width;
    this.viewHeight = height;
    this.clamp();
  }

  /** 目標（ワールド座標）を画面中央に置いたときの左上座標を、マップ内に収めて返す。 */
  desired(targetX, targetY) {
    return [this.limit(targetX - this.viewWidth / 2, this.mapWidth, this.viewWidth),
      this.limit(targetY - this.viewHeight / 2, this.mapHeight, this.viewHeight)];
  }

  limit(value, mapSize, viewSize) {
    if (mapSize <= viewSize) return (mapSize - viewSize) / 2; // マップが画面より小さければ中央寄せ
    return Math.max(0, Math.min(mapSize - viewSize, value));
  }

  /** 即座に目標へ移動する（開始時・シーン切替時）。 */
  snapTo(targetX, targetY) {
    [this.x, this.y] = this.desired(targetX, targetY);
  }

  /** 滑らかに追従する（フレームレートに依存しない指数補間）。 */
  follow(targetX, targetY, dt) {
    const [dx, dy] = this.desired(targetX, targetY);
    const k = 1 - Math.exp(-this.smoothing * dt);
    this.x += (dx - this.x) * k;
    this.y += (dy - this.y) * k;
    if (Math.abs(dx - this.x) < 0.01) this.x = dx;
    if (Math.abs(dy - this.y) < 0.01) this.y = dy;
  }

  clamp() {
    this.x = this.limit(this.x, this.mapWidth, this.viewWidth);
    this.y = this.limit(this.y, this.mapHeight, this.viewHeight);
  }

  worldToScreen(wx, wy, out) {
    out.x = wx - this.renderX;
    out.y = wy - this.renderY;
    return out;
  }

  screenToWorld(sx, sy, out) {
    out.x = sx + this.renderX;
    out.y = sy + this.renderY;
    return out;
  }

  /** ワールド座標の矩形が画面に入るか（画面外の描画省略に使う）。 */
  isVisible(l, t, r, b) {
    const ox = this.renderX;
    const oy = this.renderY;
    return r >= ox && l <= ox + this.viewWidth && b >= oy && t <= oy + this.viewHeight;
  }
}
