/**
 * プレイヤー (src/game/entities/player.js)
 *
 * 位置・向き・移動状態・ステータスに加えて、通常攻撃（5 段コンボ）と回避（無敵時間つき）の
 * 状態を管理する。見た目は playerSprite.js に分離している。
 *
 * 戦闘の入力は FieldScene が CombatInput のイベントを渡す:
 *   attack: { type, combo, comboMax, continued } -> startAttack(event)
 *   dodge : { type, invulnerableSeconds, canceledCombo } -> startDodge(event)
 *
 * 状態（state）の優先順位: dodge > attack > walk > idle
 *   コンボ番号（combo）と攻撃状態（attackTimer）は別々に持つ。コンボ番号は CombatInput から受け取った
 *   値をそのまま使い、Player 側では数え上げない（二重カウントしない）。comboTimer は
 *   「受け取った番号をいつ捨てるか」だけを持つ。
 * ダメージ・当たり判定（攻撃範囲）・敵への処理は未実装。
 */

import { DIRECTIONS_8 } from '../input/inputManager.js';
import { moveBody } from '../world/collision.js';

export const PLAYER_DEFAULTS = Object.freeze({
  speed: 120, // px/秒
  hw: 8,      // 当たり判定の半幅
  hh: 8,      // 当たり判定の高さ（足元から）
});

/** 戦闘の数値（秒 / 倍率） */
export const PLAYER_COMBAT = Object.freeze({
  comboMax: 5,               // 最大コンボ段数
  comboWindow: 1.2,          // コンボ受付時間（最後の攻撃入力から）
  attackDuration: 0.36,      // 1 段あたりの攻撃時間
  dodgeDuration: 0.45,       // 回避時間
  dodgeInvulnerable: 0.3,    // 回避開始からの無敵時間
  dodgeSpeedMultiplier: 2.8, // 回避速度 = 通常移動速度 × 2.8
});

const EPS = 1e-9;
const settle = (t) => (t < EPS ? 0 : t); // 浮動小数点の誤差で「0.0000…1 秒残る」のを防ぐ

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
    this.state = 'idle';    // 'dodge' > 'attack' > 'walk' > 'idle'
    this.walkTime = 0;      // 動いた距離（px）。歩行アニメーションの位相に使う

    // 通常攻撃
    this.combo = 0;         // 現在のコンボ番号（0 = コンボ中ではない）。CombatInput の値を保持する
    this.comboTimer = 0;    // コンボ受付の残り秒（表示・参照用。失効の判定は comboElapsed）
    this.comboElapsed = 0;  // 最後の攻撃入力からの経過秒。CombatInput と同じ加算で数え、失効のタイミングを一致させる
    this.attackTimer = 0;   // 攻撃状態の残り秒（0 = 攻撃していない）

    // 回避
    this.dodgeTimer = 0;       // 回避状態の残り秒（0 = 回避していない）
    this.invulnerableTimer = 0; // 無敵の残り秒
    this.dodgeDirX = 0;        // 回避方向（開始時点の向き。回避中は変わらない）
    this.dodgeDirY = 0;
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }

  /** 描画順（Y ソート）用 */
  get sortY() { return this.body.y; }

  get attacking() { return this.attackTimer > 0; }
  get dodging() { return this.dodgeTimer > 0; }
  /** 無敵中か（ダメージ処理側が参照する） */
  get invulnerable() { return this.invulnerableTimer > 0; }

  setPosition(x, y) {
    this.body.x = x;
    this.body.y = y;
  }

  /* ---------- 戦闘 ---------- */

  /**
   * 通常攻撃を開始する。
   * @param {{type?: string, combo: number}} event CombatInput の attack イベント
   * @returns {boolean} 受け付けたか（不正なイベント・回避中は false）
   */
  startAttack(event) {
    if (!event || typeof event !== 'object') return false;
    if (event.type !== undefined && event.type !== 'attack') return false;
    const { combo } = event;
    if (!Number.isInteger(combo) || combo < 1 || combo > PLAYER_COMBAT.comboMax) return false;
    if (this.dodging) return false; // 回避が優先。回避中の攻撃入力は受け付けない

    this.combo = combo;                              // 番号は CombatInput の値を使う
    this.comboTimer = PLAYER_COMBAT.comboWindow;
    this.comboElapsed = 0;
    this.attackTimer = PLAYER_COMBAT.attackDuration;
    this.state = 'attack';
    return true;
  }

  /**
   * 回避を開始する。攻撃状態とコンボを解除し、開始時点の向きへ移動する。
   * @param {{type?: string, invulnerableSeconds?: number}} event CombatInput の dodge イベント
   * @returns {boolean} 受け付けたか（不正なイベント・回避中は false）
   */
  startDodge(event) {
    if (!event || typeof event !== 'object') return false;
    if (event.type !== undefined && event.type !== 'dodge') return false;
    if (this.dodging) return false; // 回避の連続入力で回避が延長されない

    // 攻撃とコンボを解除
    this.attackTimer = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboElapsed = 0;

    const inv = Number.isFinite(event.invulnerableSeconds) && event.invulnerableSeconds > 0
      ? event.invulnerableSeconds
      : PLAYER_COMBAT.dodgeInvulnerable;
    this.dodgeTimer = PLAYER_COMBAT.dodgeDuration;
    this.invulnerableTimer = Math.min(inv, PLAYER_COMBAT.dodgeDuration);
    this.dodgeDirX = this.dirX;
    this.dodgeDirY = this.dirY;
    this.state = 'dodge';
    return true;
  }

  /* ---------- 更新 ---------- */

  /**
   * @param {number} dt 秒
   * @param {{dir:number, x?:number, y?:number, speed?:number}} move InputManager.getMove の結果。
   *   x, y（単位ベクトル）と speed（0〜1）があれば、その 360 度の方向・強度で動く。
   *   dir（8 方向）は向き・スプライト用。x, y が無い呼び出し（従来の { dir } だけ）は dir の方向へ速度 1 で動く。
   * @param {import('../world/collision.js').CollisionGrid} collision
   * @param {number} mapW
   * @param {number} mapH
   */
  update(dt, move, collision, mapW, mapH) {
    const b = this.body;
    const px = b.x;
    const py = b.y;

    // 回避：開始時点の向きへ通常の 2.8 倍の速度。同じ CollisionGrid・マップ境界で判定する。
    // 回避が途中のフレームで終わる場合、残りの時間は通常移動に使う。
    const dodgeTime = this.dodgeTimer > 0 ? Math.min(dt, this.dodgeTimer) : 0;
    if (dodgeTime > 0) {
      const dist = this.speed * PLAYER_COMBAT.dodgeSpeedMultiplier * dodgeTime;
      moveBody(collision, b, this.dodgeDirX * dist, this.dodgeDirY * dist, mapW, mapH);
    }
    const walkTime = dt - dodgeTime;

    // 通常移動：入力の 360 度の方向へ、倒し具合（speed）に応じた速度で動く。
    // 8 方向（dir）は表示用の向きにだけ使い、移動ベクトルは丸めない。
    if (walkTime > EPS && move.dir >= 0) {
      const d = DIRECTIONS_8[move.dir];
      this.facing8 = move.dir;
      this.facing = Math.abs(d.y) > Math.abs(d.x) ? (d.y > 0 ? 'down' : 'up') : (d.x > 0 ? 'right' : 'left');

      let ux = d.x;
      let uy = d.y;
      const len = Math.hypot(move.x, move.y); // x, y が無ければ NaN（従来の { dir } 呼び出しは dir の方向へ）
      if (len > 1e-6) { ux = move.x / len; uy = move.y / len; }
      const k = Number.isFinite(move.speed) ? Math.max(0, Math.min(1, move.speed)) : 1;
      this.dirX = ux; // 最後に動いた方向（連続値）。回避はこの方向へ進む
      this.dirY = uy;

      const dist = this.speed * walkTime * k;
      if (dist > 0) moveBody(collision, b, ux * dist, uy * dist, mapW, mapH);
    }

    // タイマーを進める
    this.dodgeTimer = settle(this.dodgeTimer - dt);
    this.invulnerableTimer = settle(this.invulnerableTimer - dt);
    this.attackTimer = settle(this.attackTimer - dt);
    if (this.combo > 0) {
      // 受付時間（1.2 秒）を「超えたら」コンボ番号を捨てる。CombatInput（sinceAttack += dt、> 1.2）と
      // 同じ加算・同じ比較にして、浮動小数点の誤差でも 1 フレームもずれないようにする。
      this.comboElapsed += dt;
      this.comboTimer = Math.max(0, PLAYER_COMBAT.comboWindow - this.comboElapsed);
      if (this.comboElapsed > PLAYER_COMBAT.comboWindow) {
        this.combo = 0;
        this.comboElapsed = 0;
        this.comboTimer = 0;
      }
    }

    const moved = Math.hypot(b.x - px, b.y - py);
    this.moving = moved > 0.01;
    if (this.moving) this.walkTime += moved;

    // 状態：dodge > attack > walk > idle
    if (this.dodgeTimer > 0) this.state = 'dodge';
    else if (this.attackTimer > 0) this.state = 'attack';
    else this.state = this.moving ? 'walk' : 'idle';
  }
}
