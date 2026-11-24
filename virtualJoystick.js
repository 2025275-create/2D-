/**
 * バーチャルジョイスティック (src/game/input/virtualJoystick.js)
 *
 * - 画面左下に固定配置（セーフエリア対応）。DOM 要素として #stage に重ねる。
 * - Pointer Events。最初に触れた指の pointerId だけを追跡し、他の指では解除されない。
 * - value.x / value.y は -1〜1、value.strength は 0〜1（中心からの距離）。
 * - pointercancel・lostpointercapture・画面非表示・ページ離脱・回転で入力を安全に解除する。
 * - 設定画面から setSize() / setOpacity() で見た目を変更できる。
 */

const DEFAULTS = Object.freeze({
  size: 168,        // CSS px（iPad で親指が収まる大きさ）
  knobRatio: 0.42,  // ノブの直径 / 土台の直径
  opacity: 0.6,
  margin: 28,       // 画面端からの余白 CSS px
  deadZone: 0.12,   // これ未満の strength は「入力なし」とみなす
});

export class VirtualJoystick {
  /**
   * @param {HTMLElement} host 追加先（#stage）
   * @param {Partial<typeof DEFAULTS>} [options]
   */
  constructor(host, options = {}) {
    this.host = host;
    this.options = { ...DEFAULTS, ...options };
    this.value = { x: 0, y: 0, strength: 0, active: false };
    this.pointerId = null;
    this.cx = 0;
    this.cy = 0;
    this.travel = 1; // ノブが動ける最大距離（CSS px）
    this.disposers = [];
    this.root = null;
    this.knob = null;
    this.build();
    this.bind();
  }

  build() {
    const root = document.createElement('div');
    root.setAttribute('aria-hidden', 'true');
    root.dataset.role = 'virtual-joystick';
    const knob = document.createElement('div');
    root.appendChild(knob);
    this.root = root;
    this.knob = knob;
    this.applyStyle();
    this.host.appendChild(root);
    this.measure();
  }

  applyStyle() {
    const { size, knobRatio, opacity, margin } = this.options;
    const knobSize = Math.round(size * knobRatio);
    this.root.style.cssText = [
      'position:absolute', 'z-index:5',
      `left:calc(env(safe-area-inset-left, 0px) + ${margin}px)`,
      `bottom:calc(env(safe-area-inset-bottom, 0px) + ${margin}px)`,
      `width:${size}px`, `height:${size}px`, 'border-radius:50%', 'box-sizing:border-box',
      'border:2px solid rgba(201,211,227,0.8)',
      'background:radial-gradient(circle, rgba(159,216,255,0.22) 0%, rgba(16,28,70,0.45) 100%)',
      'box-shadow:inset 0 0 18px rgba(159,216,255,0.25), 0 0 14px rgba(159,216,255,0.15)',
      `opacity:${opacity}`,
      'touch-action:none', 'user-select:none', '-webkit-user-select:none', '-webkit-touch-callout:none',
      '-webkit-tap-highlight-color:transparent',
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

  /** 土台の中心と、ノブの移動範囲を計測する（回転・リサイズ後にも呼ぶ）。 */
  measure() {
    const rect = this.root.getBoundingClientRect();
    this.cx = rect.left + rect.width / 2;
    this.cy = rect.top + rect.height / 2;
    const knobSize = Math.round(this.options.size * this.options.knobRatio);
    this.travel = Math.max(1, rect.width / 2 - knobSize / 2);
  }

  setSize(px) {
    this.options.size = Math.max(80, Math.min(320, px));
    this.applyStyle();
    this.measure();
  }

  setOpacity(alpha) {
    this.options.opacity = Math.max(0.1, Math.min(1, alpha));
    this.root.style.opacity = String(this.options.opacity);
  }

  on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  bind() {
    this.on(this.root, 'pointerdown', (e) => this.onDown(e), { passive: false });
    // 指が土台の外へ出ても追えるよう、move / up は window で受ける（pointerId で絞り込む）
    this.on(window, 'pointermove', (e) => this.onMove(e), { passive: true });
    this.on(window, 'pointerup', (e) => this.onEnd(e));
    this.on(window, 'pointercancel', (e) => this.onEnd(e));
    this.on(this.root, 'lostpointercapture', (e) => this.onEnd(e));
    this.on(this.root, 'contextmenu', (e) => e.preventDefault());
    // 安全側のリセット
    this.on(window, 'blur', () => this.reset());
    this.on(window, 'pagehide', () => this.reset());
    this.on(window, 'orientationchange', () => { this.reset(); setTimeout(() => this.measure(), 250); });
    this.on(window, 'resize', () => this.measure());
    this.on(document, 'visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  onDown(e) {
    if (this.pointerId !== null) return; // すでに別の指が操作中
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try { this.root.setPointerCapture(e.pointerId); } catch (_) { /* 失敗しても window で追跡する */ }
    this.measure();
    this.update(e);
  }

  onMove(e) {
    if (e.pointerId !== this.pointerId) return;
    this.update(e);
  }

  onEnd(e) {
    if (e.pointerId !== this.pointerId) return;
    this.reset();
  }

  update(e) {
    let dx = e.clientX - this.cx;
    let dy = e.clientY - this.cy;
    const dist = Math.hypot(dx, dy);
    if (dist > this.travel) { dx = (dx / dist) * this.travel; dy = (dy / dist) * this.travel; }
    const v = this.value;
    v.x = dx / this.travel;
    v.y = dy / this.travel;
    v.strength = Math.min(1, dist / this.travel);
    v.active = true;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** 入力を解除して停止状態に戻す。 */
  reset() {
    const id = this.pointerId;
    this.pointerId = null;
    const v = this.value;
    v.x = 0; v.y = 0; v.strength = 0; v.active = false;
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    if (id !== null && this.root) {
      try { if (this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id); } catch (_) { /* 無視 */ }
    }
  }

  dispose() {
    this.reset();
    for (const off of this.disposers) off();
    this.disposers = [];
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this.knob = null;
  }
}
