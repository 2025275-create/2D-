/**
 * フローティング（ダイナミック）ジョイスティック (src/game/input/virtualJoystick.js)
 *
 * - 画面の左半分（zoneRatio、既定 0.5）のどこに触れても、その位置が基準中心になる。
 * - 外円は、画面外へはみ出さないよう表示位置だけ内側へ寄せる。入力の基準は触れた位置のまま。
 * - 指を離す / pointercancel / フォーカス喪失 / 画面非表示 / 回転で入力を解除し、外円を隠す。
 * - Pointer Events だけを使う（touch イベントとの二重処理なし）。最初に触れた指の pointerId
 *   だけを追跡し、他の指（左半分の 2 本目、右半分の指）では動かない・解除されない。
 * - 右半分には何も重ねない。右半分のタッチは Canvas へ届き、攻撃・スキル操作に使える。
 * - value.x / value.y は -1〜1、value.strength は 0〜1、value.active は操作中か。
 *   InputManager はこの value と options.deadZone だけを読む。
 * - 設定画面から setSize() / setOpacity() / setZoneRatio() で変更できる。
 */

const DEFAULTS = Object.freeze({
  size: 168,        // 外円の直径 CSS px
  knobRatio: 0.42,  // ノブの直径 / 外円の直径
  opacity: 0.6,
  edgeMargin: 8,    // 外円と画面端の最小余白 CSS px
  zoneRatio: 0.5,   // 移動入力を受ける領域（画面左からの割合）
  deadZone: 0.12,   // これ未満の strength は「入力なし」とみなす
});

export class VirtualJoystick {
  /**
   * @param {HTMLElement} host 追加先（#stage。画面全体を覆う position:fixed の要素）
   * @param {Partial<typeof DEFAULTS>} [options]
   */
  constructor(host, options = {}) {
    this.host = host;
    this.options = { ...DEFAULTS, ...options };
    this.value = { x: 0, y: 0, strength: 0, active: false };
    this.pointerId = null;
    this.startX = 0;   // 触れた位置 = 入力の基準中心（client 座標）
    this.startY = 0;
    this.travel = 1;   // ノブが動ける最大距離（CSS px）
    this.disposers = [];
    this.zone = null;
    this.base = null;
    this.knob = null;
    this.build();
    this.bind();
  }

  build() {
    const zone = document.createElement('div');
    zone.setAttribute('aria-hidden', 'true');
    zone.dataset.role = 'virtual-joystick-zone';
    const base = document.createElement('div');
    base.setAttribute('aria-hidden', 'true');
    base.dataset.role = 'virtual-joystick';
    const knob = document.createElement('div');
    base.appendChild(knob);
    this.zone = zone;
    this.base = base;
    this.knob = knob;
    this.applyStyle();
    this.host.appendChild(zone);
    this.host.appendChild(base);
  }

  applyStyle() {
    const { size, knobRatio, opacity, zoneRatio } = this.options;
    const knobSize = Math.round(size * knobRatio);
    this.travel = Math.max(1, size / 2 - knobSize / 2);

    // 触れる領域：透明。画面の左 zoneRatio 分だけ。touch-action:none でスクロール・拡大を防ぐ
    this.zone.style.cssText = [
      'position:absolute', 'z-index:5', 'left:0', 'top:0', 'bottom:0', `width:${zoneRatio * 100}%`,
      'touch-action:none', 'user-select:none', '-webkit-user-select:none', '-webkit-touch-callout:none',
      '-webkit-tap-highlight-color:transparent', 'background:transparent',
    ].join(';');

    // 外円：触れている間だけ表示。位置は show() が transform で決める
    this.base.style.cssText = [
      'position:absolute', 'z-index:6', 'left:0', 'top:0', 'display:none', 'pointer-events:none',
      `width:${size}px`, `height:${size}px`, 'border-radius:50%', 'box-sizing:border-box',
      'border:2px solid rgba(201,211,227,0.8)',
      'background:radial-gradient(circle, rgba(159,216,255,0.22) 0%, rgba(16,28,70,0.45) 100%)',
      'box-shadow:inset 0 0 18px rgba(159,216,255,0.25), 0 0 14px rgba(159,216,255,0.15)',
      `opacity:${opacity}`, 'will-change:transform', 'user-select:none', '-webkit-user-select:none',
    ].join(';');

    this.knob.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'pointer-events:none',
      `width:${knobSize}px`, `height:${knobSize}px`,
      `margin:${-knobSize / 2}px 0 0 ${-knobSize / 2}px`, 'border-radius:50%',
      'background:radial-gradient(circle at 35% 30%, #ffffff 0%, #9fd8ff 55%, #4a78c8 100%)',
      'border:2px solid rgba(242,246,252,0.9)', 'box-shadow:0 0 12px rgba(159,216,255,0.6)',
      'transform:translate(0px, 0px)', 'will-change:transform',
    ].join(';');
  }

  setSize(px) {
    this.options.size = Math.max(80, Math.min(320, px));
    this.applyStyle();
  }

  setOpacity(alpha) {
    this.options.opacity = Math.max(0.1, Math.min(1, alpha));
    this.base.style.opacity = String(this.options.opacity);
  }

  /** 移動入力を受ける領域の幅（0.2〜0.6、画面幅に対する割合）。 */
  setZoneRatio(ratio) {
    this.options.zoneRatio = Math.max(0.2, Math.min(0.6, ratio));
    this.zone.style.width = `${this.options.zoneRatio * 100}%`;
  }

  on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  bind() {
    this.on(this.zone, 'pointerdown', (e) => this.onDown(e), { passive: false });
    // 指が領域の外へ出ても追えるよう、move / up は window で受ける（pointerId で絞り込む）
    this.on(window, 'pointermove', (e) => this.onMove(e), { passive: true });
    this.on(window, 'pointerup', (e) => this.onEnd(e));
    this.on(window, 'pointercancel', (e) => this.onEnd(e));
    this.on(this.zone, 'lostpointercapture', (e) => this.onEnd(e));
    this.on(this.zone, 'contextmenu', (e) => e.preventDefault());
    // 安全側のリセット
    this.on(window, 'blur', () => this.reset());
    this.on(window, 'pagehide', () => this.reset());
    this.on(window, 'orientationchange', () => this.reset());
    this.on(document, 'visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  onDown(e) {
    if (this.pointerId !== null) return; // すでに別の指が操作中（2 本目の指は無視する）
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try { this.zone.setPointerCapture(e.pointerId); } catch (_) { /* 失敗しても window で追跡する */ }
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.show(e.clientX, e.clientY);
    const v = this.value;
    v.x = 0; v.y = 0; v.strength = 0; v.active = true;
  }

  /** 外円を (x, y) の近くに表示する。画面からはみ出す場合は内側へ寄せる（入力の基準は動かさない）。 */
  show(x, y) {
    const r = this.options.size / 2;
    const m = this.options.edgeMargin;
    const rect = this.host.getBoundingClientRect();
    const clamp = (v, min, max) => (min > max ? (min + max) / 2 : Math.max(min, Math.min(max, v)));
    const cx = clamp(x, rect.left + r + m, rect.right - r - m);
    const cy = clamp(y, rect.top + r + m, rect.bottom - r - m);
    this.base.style.transform = `translate(${cx - rect.left - r}px, ${cy - rect.top - r}px)`;
    this.base.style.display = 'block';
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  onMove(e) {
    if (e.pointerId !== this.pointerId) return;
    let dx = e.clientX - this.startX;
    let dy = e.clientY - this.startY;
    const dist = Math.hypot(dx, dy);
    if (dist > this.travel) { dx = (dx / dist) * this.travel; dy = (dy / dist) * this.travel; }
    const v = this.value;
    v.x = dx / this.travel;
    v.y = dy / this.travel;
    v.strength = Math.min(1, dist / this.travel);
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  onEnd(e) {
    if (e.pointerId !== this.pointerId) return;
    this.reset();
  }

  /** 入力を解除し、ノブを中心に戻して外円を隠す。 */
  reset() {
    const id = this.pointerId;
    this.pointerId = null;
    const v = this.value;
    v.x = 0; v.y = 0; v.strength = 0; v.active = false;
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    if (this.base) this.base.style.display = 'none';
    if (id !== null && this.zone) {
      try { if (this.zone.hasPointerCapture(id)) this.zone.releasePointerCapture(id); } catch (_) { /* 無視 */ }
    }
  }

  dispose() {
    this.reset();
    for (const off of this.disposers) off();
    this.disposers = [];
    for (const el of [this.zone, this.base]) if (el && el.parentNode) el.parentNode.removeChild(el);
    this.zone = null;
    this.base = null;
    this.knob = null;
  }
}
