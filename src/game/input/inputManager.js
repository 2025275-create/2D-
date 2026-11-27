/**
 * 入力管理 (src/game/input/inputManager.js)
 *
 * ジョイスティック（iPad の主操作）とキーボード（PC での動作確認用・任意）を
 * 1つの「移動入力」にまとめる。移動方向はジョイスティックのアナログ入力をそのまま使う
 * 360 度の単位ベクトル（x, y）で、どの角度でも長さが 1 なので速度は一定。倒し具合は
 * speed（0〜1）で渡す。8 方向（dir）は、キャラクターの向き・スプライトなど「表示用」にだけ使う。
 * 攻撃・回避などのボタン入力は将来ここへ追加する。
 */

import { VirtualJoystick } from './virtualJoystick.js';

const S = Math.SQRT1_2;

/** 画面座標（Y が下向き）での 8 方向。index = round(atan2(y, x) / 45°) を 0〜7 に畳んだ値。 */
export const DIRECTIONS_8 = Object.freeze([
  { name: 'right', x: 1, y: 0 },
  { name: 'down-right', x: S, y: S },
  { name: 'down', x: 0, y: 1 },
  { name: 'down-left', x: -S, y: S },
  { name: 'left', x: -1, y: 0 },
  { name: 'up-left', x: -S, y: -S },
  { name: 'up', x: 0, y: -1 },
  { name: 'up-right', x: S, y: -S },
]);

/** ベクトル (x, y) に最も近い 8 方向の index を返す。 */
export function snapDirection8(x, y) {
  const index = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return ((index % 8) + 8) % 8;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const KEY_AXES = Object.freeze({
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
});

export class InputManager {
  /**
   * @param {object} options
   * @param {HTMLElement} options.host ジョイスティックの追加先
   * @param {object} [options.joystick] VirtualJoystick のオプション
   */
  constructor({ host, joystick = {} }) {
    this.joystick = new VirtualJoystick(host, joystick);
    this.keys = new Set();
    this.disposers = [];
    this.on(window, 'keydown', (e) => { if (KEY_AXES[e.code]) this.keys.add(e.code); });
    this.on(window, 'keyup', (e) => this.keys.delete(e.code));
    this.on(window, 'blur', () => this.keys.clear());
  }

  on(target, type, handler) {
    target.addEventListener(type, handler);
    this.disposers.push(() => target.removeEventListener(type, handler));
  }

  /**
   * 現在の移動入力を out に書き込む（オブジェクトを生成しない）。
   *   out.x, out.y : 移動方向の単位ベクトル（アナログ。8 方向に丸めない）。入力なしは 0, 0
   *   out.speed    : 基本速度に掛ける倍率 0〜1（スティックの倒し具合。デッドゾーン分を差し引いて 0 から連続）
   *   out.strength : スティックの生の強度 0〜1（キーボードは 1）
   *   out.dir      : 0〜7 または -1（入力なし）。向き・スプライト用の 8 方向。移動には使わない
   */
  getMove(out) {
    let kx = 0;
    let ky = 0;
    for (const code of this.keys) { kx += KEY_AXES[code][0]; ky += KEY_AXES[code][1]; }

    const joy = this.joystick.value;
    const dead = this.joystick.options.deadZone;
    let dir = -1;
    let strength = 0;
    let speed = 0;
    let ux = 0;
    let uy = 0;
    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      ux = kx / len;
      uy = ky / len;
      dir = snapDirection8(kx, ky);
      strength = 1;
      speed = 1;
    } else if (joy.active && joy.strength >= dead) {
      const len = Math.hypot(joy.x, joy.y);
      const s = dead < 1 ? clamp01((joy.strength - dead) / (1 - dead)) : 0;
      if (len > 1e-6 && s > 0) {
        ux = joy.x / len;
        uy = joy.y / len;
        dir = snapDirection8(joy.x, joy.y);
        strength = joy.strength;
        speed = s;
      }
    }
    out.dir = dir;
    out.strength = strength;
    out.speed = speed;
    out.x = ux;
    out.y = uy;
    return out;
  }

  /** すべての入力を解除する（画面非表示・シーン切替時など）。 */
  reset() {
    this.keys.clear();
    this.joystick.reset();
  }

  dispose() {
    this.reset();
    for (const off of this.disposers) off();
    this.disposers = [];
    this.joystick.dispose();
  }
}
