/**
 * 入力管理 (src/game/input/inputManager.js)
 *
 * ジョイスティック（iPad の主操作）とキーボード（PC での動作確認用・任意）を
 * 1つの「移動入力」にまとめる。移動方向は 8 方向に丸め、斜めは正規化済みの
 * 単位ベクトルなので、斜め移動が速くならない。
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
   * out.dir: 0〜7 または -1（入力なし）/ out.x, out.y: 単位ベクトル / out.strength: 0〜1
   */
  getMove(out) {
    let kx = 0;
    let ky = 0;
    for (const code of this.keys) { kx += KEY_AXES[code][0]; ky += KEY_AXES[code][1]; }

    const joy = this.joystick.value;
    let dir = -1;
    let strength = 0;
    if (kx !== 0 || ky !== 0) {
      dir = snapDirection8(kx, ky);
      strength = 1;
    } else if (joy.active && joy.strength >= this.joystick.options.deadZone) {
      dir = snapDirection8(joy.x, joy.y);
      strength = joy.strength;
    }
    out.dir = dir;
    out.strength = strength;
    out.x = dir >= 0 ? DIRECTIONS_8[dir].x : 0;
    out.y = dir >= 0 ? DIRECTIONS_8[dir].y : 0;
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
