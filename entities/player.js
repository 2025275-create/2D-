/**
 * プレイヤー (src/game/entities/player.js)
 *
 * 位置・向き・移動状態・ステータスを管理する。見た目は playerSprite.js に分離しており、
 * スプライト画像や 4 方向アニメーションへ差し替えるときは Player を変更しない。
 * 将来の攻撃・回避・スキルは state / update に追加する。
 */

import { DIRECTIONS_8 } from '../input/inputManager.js';
import { moveBody } from '../world/collision.js';

export const PLAYER_DEFAULTS = Object.freeze({
  speed: 120, // px/秒
  hw: 8,      // 当たり判定の半幅
  hh: 8,      // 当たり判定の高さ（足元から）
});

export class Player {
  constructor({ x, y, speed = PLAYER_DEFAULTS.speed } = {}) {
    this.body = { x, y, hw: PLAYER_DEFAULTS.hw, hh: PLAYER_DEFAULTS.hh, blockedX: false, blockedY: false };
    this.speed = speed;
    this.stats = {
      level: 1,
      hp: 300, maxHp: 300,
      mp: 60, maxMp: 60,
      stamina: 100, maxStamina: 100,
    };

    // 向き：最後に入力した方向を保持する（停止しても変わらない）
    this.facing8 = 2;       // 0〜7（DIRECTIONS_8 の index）。初期は下向き
    this.facing = 'down';   // 'up' | 'down' | 'left' | 'right'（4 方向スプライト用）
    this.dirX = 0;
    this.dirY = 1;

    this.moving = false;    // 実際に動いたか（壁に押し付けているだけなら false）
    this.state = 'idle';    // 'idle' | 'walk'（将来 'attack' / 'dodge' などを追加）
    this.walkTime = 0;      // 歩いた距離（px）。歩行アニメーションの位相に使う
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }

  /** 描画順（Y ソート）用 */
  get sortY() { return this.body.y; }

  setPosition(x, y) {
    this.body.x = x;
    this.body.y = y;
  }

  /**
   * @param {number} dt 秒
   * @param {{dir:number}} move InputManager.getMove の結果
   * @param {import('../world/collision.js').CollisionGrid} collision
   * @param {number} mapW
   * @param {number} mapH
   */
  update(dt, move, collision, mapW, mapH) {
    const b = this.body;
    const px = b.x;
    const py = b.y;

    if (move.dir >= 0) {
      const d = DIRECTIONS_8[move.dir];
      this.facing8 = move.dir;
      this.dirX = d.x;
      this.dirY = d.y;
      this.facing = Math.abs(d.y) > Math.abs(d.x) ? (d.y > 0 ? 'down' : 'up') : (d.x > 0 ? 'right' : 'left');
      const dist = this.speed * dt;
      moveBody(collision, b, d.x * dist, d.y * dist, mapW, mapH);
    }

    const moved = Math.hypot(b.x - px, b.y - py);
    this.moving = moved > 0.01;
    this.state = this.moving ? 'walk' : 'idle';
    if (this.moving) this.walkTime += moved;
  }
}
