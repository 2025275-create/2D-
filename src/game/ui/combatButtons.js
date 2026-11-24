/**
 * 右側の戦闘操作 UI (src/game/ui/combatButtons.js)
 *
 * 通常攻撃・回避・スキル・スキルページ切り替えの 4 ボタンと、スキル選択リングを DOM で描く。
 * 入力の解釈は CombatInput（combat/combatInput.js）に任せ、ここは「指の追跡」と「見た目」だけを持つ。
 *  - Pointer Events のみ（touch イベントは使わない）。ボタンごとに pointerId を管理する。
 *  - 各ボタンは touch-action:none。ボタン以外の右半分は Canvas へタッチが届く（FieldScene.onActionPress）。
 *  - 左手のフローティングジョイスティック（左半分）とは別の指・別の要素なので同時に使える。
 *  - ループは持たない。FieldScene.update から update(dt) が呼ばれる。
 */

import { SKILL_SLOTS_PER_PAGE, COMBO_MAX, RING_DIRECTIONS } from '../combat/combatInput.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 画面サイズ（CSS px）と安全領域からボタン配置を計算する（DOM に依存しない純関数）。
 * 通常攻撃：右下の大きなボタン / 回避：その左 / スキル：その上（リングが画面内に収まる位置）/
 * ページ切り替え：スキルの左。cx, cy は中心、d は直径。
 */
export function computeCombatLayout(W, H, insets = { top: 0, right: 0, bottom: 0, left: 0 }) {
  const s = Math.min(W, H);
  const A = clamp(s * 0.19, 78, 140);   // 通常攻撃
  const D = A * 0.68;                   // 回避
  const S = A * 0.62;                   // スキル
  const P = A * 0.42;                   // ページ切り替え
  const gap = Math.max(10, A * 0.1);
  const margin = Math.max(14, s * 0.03);
  const R = S * 1.2;                    // リング半径（スキル中心から各枠まで）
  const b = S * 0.36;                   // リング各枠の半径
  const xr = W - insets.right - margin;
  const yb = H - insets.bottom - margin;

  const attack = { cx: xr - A / 2, cy: yb - A / 2, d: A };
  const dodge = { cx: attack.cx - A / 2 - gap - D / 2, cy: yb - D / 2, d: D };
  const skillX = Math.min(attack.cx, xr - R - b);
  const skillY = Math.max(attack.cy - A / 2 - gap - S / 2, insets.top + margin + R + b);
  const skill = { cx: skillX, cy: skillY, d: S };
  const page = { cx: skillX - S / 2 - gap - P / 2, cy: skillY, d: P };
  return { attack, dodge, skill, page, ring: { R, b } };
}

const THEME = Object.freeze({
  attack: { border: '#9fd8ff', bg: 'radial-gradient(circle at 35% 30%, rgba(159,216,255,0.55), rgba(16,28,110,0.88))', glow: 'rgba(159,216,255,0.6)' },
  dodge: { border: '#c9d3e3', bg: 'radial-gradient(circle at 35% 30%, rgba(242,246,252,0.38), rgba(30,40,80,0.88))', glow: 'rgba(201,211,227,0.5)' },
  skill: { border: '#d6b25e', bg: 'radial-gradient(circle at 35% 30%, rgba(214,178,94,0.5), rgba(40,30,70,0.9))', glow: 'rgba(214,178,94,0.55)' },
  page: { border: '#8d9ab3', bg: 'rgba(10,18,48,0.8)', glow: 'rgba(141,154,179,0.45)' },
});

const LABEL = Object.freeze({ attack: '攻撃', dodge: '回避', skill: '', page: '' });
const ARIA = Object.freeze({ attack: '通常攻撃', dodge: '回避', skill: 'スキル', page: 'スキルページ切り替え' });
const FONT = '"Hiragino Sans", -apple-system, "Noto Sans JP", sans-serif';

export class CombatUi {
  /**
   * @param {object} options
   * @param {HTMLElement} options.host #stage
   * @param {import('../combat/combatInput.js').CombatInput} options.combat
   * @param {(skillId: any) => string} [options.labelOf] スキル ID → 表示名
   */
  constructor({ host, combat, labelOf = (id) => String(id) }) {
    this.host = host;
    this.combat = combat;
    this.labelOf = labelOf;
    this.els = {};
    this.pressedCount = { attack: 0, dodge: 0, skill: 0, page: 0 };
    this.active = new Map();     // pointerId -> ボタン名
    this.skillPointer = null;
    this.skillStart = { x: 0, y: 0 };
    this.layoutData = null;
    this.ringEl = null;
    this.ringBubbles = [];
    this.pips = [];
    this.shownCombo = -1;
    this.flash = 0;
    this.disposers = [];
    this.build();
    this.bind();
    this.layout();
  }

  /* ---------- DOM ---------- */

  build() {
    for (const name of ['attack', 'dodge', 'skill', 'page']) {
      const el = document.createElement('div');
      el.dataset.role = `combat-${name}`;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', ARIA[name]);
      const text = document.createElement('div');
      text.style.cssText = 'pointer-events:none;text-align:center;line-height:1.15;';
      el.appendChild(text);
      this.els[name] = { el, text };
      this.host.appendChild(el);
    }
    // 通常攻撃：コンボ段階の表示（5 つの点）
    const pips = document.createElement('div');
    pips.style.cssText = 'position:absolute;left:0;right:0;top:-14px;display:flex;justify-content:center;gap:6px;pointer-events:none;';
    for (let i = 0; i < COMBO_MAX; i += 1) {
      const pip = document.createElement('div');
      pips.appendChild(pip);
      this.pips.push(pip);
    }
    this.els.attack.el.appendChild(pips);
    this.pipsEl = pips;

    // スキル選択リング
    const ring = document.createElement('div');
    ring.dataset.role = 'combat-skill-ring';
    ring.style.cssText = 'position:absolute;z-index:8;display:none;pointer-events:none;';
    for (let i = 0; i < SKILL_SLOTS_PER_PAGE; i += 1) {
      const bubble = document.createElement('div');
      bubble.dataset.slot = String(i);
      const label = document.createElement('span');
      label.style.cssText = 'display:block;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
      bubble.appendChild(label);
      ring.appendChild(bubble);
      this.ringBubbles.push(bubble);
    }
    this.ringEl = ring;
    this.host.appendChild(ring);

    // セーフエリア取得用（CSS px）
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    this.host.appendChild(probe);
    this.probe = probe;
  }

  /** 画面サイズ・向きの変更時に呼ぶ（FieldScene.resize から）。 */
  layout() {
    const rect = this.host.getBoundingClientRect();
    const cs = getComputedStyle(this.probe);
    const ins = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    this.layoutData = computeCombatLayout(rect.width, rect.height, ins);
    for (const name of ['attack', 'dodge', 'skill', 'page']) this.paint(name);
    this.renderLabels();
    this.renderRing();
    this.renderPips(true);
  }

  paint(name) {
    const { el, text } = this.els[name];
    const g = this.layoutData[name];
    const t = THEME[name];
    const pressed = this.pressedCount[name] > 0;
    el.style.cssText = [
      'position:absolute', 'z-index:7', 'box-sizing:border-box', 'display:flex', 'align-items:center', 'justify-content:center',
      `left:${(g.cx - g.d / 2).toFixed(1)}px`, `top:${(g.cy - g.d / 2).toFixed(1)}px`, `width:${g.d.toFixed(1)}px`, `height:${g.d.toFixed(1)}px`,
      'border-radius:50%', `border:2px solid ${this.flash > 0 && name === 'skill' ? '#ff6b81' : t.border}`, `background:${t.bg}`,
      `box-shadow:${pressed ? `inset 0 0 26px ${t.glow}, 0 0 26px ${t.glow}` : `inset 0 0 12px ${t.glow}, 0 0 10px rgba(5,9,20,0.6)`}`,
      `transform:scale(${pressed ? 0.92 : 1})`, `opacity:${pressed ? 1 : name === 'page' && this.combat.pageCount < 2 ? 0.4 : 0.82}`, 'transition:transform 70ms, opacity 70ms',
      'touch-action:none', 'user-select:none', '-webkit-user-select:none', '-webkit-touch-callout:none', '-webkit-tap-highlight-color:transparent',
      `color:#f2f6fc`, `font-family:${FONT}`, `font-size:${Math.round(g.d * (name === 'page' ? 0.3 : 0.24))}px`, 'font-weight:600', 'letter-spacing:0.08em',
    ].join(';');
    text.style.fontSize = `${Math.round(g.d * (name === 'page' ? 0.3 : 0.24))}px`;
    if (name !== 'attack') return;
    const pipSize = Math.max(7, Math.round(g.d * 0.07));
    this.pipsEl.style.top = `${-pipSize - 8}px`;
    this.pips.forEach((pip) => { pip.style.width = `${pipSize}px`; pip.style.height = `${pipSize}px`; pip.style.borderRadius = '50%'; });
  }

  renderLabels() {
    const c = this.combat;
    this.els.attack.text.textContent = LABEL.attack;
    this.els.dodge.text.textContent = LABEL.dodge;
    this.els.page.text.textContent = `${c.page + 1}/${c.pageCount}`;
    this.paint('page');
    const skill = c.currentSkill();
    const label = skill === null ? '—' : this.labelOf(skill);
    this.els.skill.text.innerHTML = '';
    const cap = document.createElement('div');
    cap.textContent = 'SKILL';
    cap.style.cssText = 'font-size:0.55em;opacity:0.8;letter-spacing:0.12em;';
    const name = document.createElement('div');
    name.textContent = label;
    name.style.cssText = `max-width:${Math.round(this.layoutData.skill.d * 0.8)}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;${skill === null ? 'opacity:0.6;' : ''}`;
    this.els.skill.text.append(cap, name);
  }

  renderPips(force = false) {
    const lit = this.combat.combo;
    if (!force && lit === this.shownCombo) return;
    this.shownCombo = lit;
    this.pips.forEach((pip, i) => {
      const on = i < lit;
      pip.style.background = on ? '#9fd8ff' : 'rgba(141,154,179,0.35)';
      pip.style.boxShadow = on ? '0 0 8px #9fd8ff' : 'none';
    });
  }

  renderRing() {
    const c = this.combat;
    const open = c.skill.ring;
    this.ringEl.style.display = open ? 'block' : 'none';
    if (!open || !this.layoutData) return;
    const { skill, ring } = this.layoutData;
    this.ringEl.style.left = `${skill.cx.toFixed(1)}px`;
    this.ringEl.style.top = `${skill.cy.toFixed(1)}px`;
    const offsets = { up: [0, -ring.R], right: [ring.R, 0], down: [0, ring.R], left: [-ring.R, 0] };
    const slots = c.slots();
    RING_DIRECTIONS.forEach((dir, i) => {
      const bubble = this.ringBubbles[i];
      const empty = slots[i] === null;
      const selected = c.skill.slot === i;
      const [ox, oy] = offsets[dir];
      bubble.firstChild.textContent = empty ? '—' : this.labelOf(slots[i]);
      bubble.style.cssText = [
        'position:absolute', 'box-sizing:border-box', 'display:flex', 'align-items:center', 'justify-content:center', 'text-align:center',
        `left:${(ox - ring.b).toFixed(1)}px`, `top:${(oy - ring.b).toFixed(1)}px`, `width:${(ring.b * 2).toFixed(1)}px`, `height:${(ring.b * 2).toFixed(1)}px`,
        'border-radius:50%', `border:2px solid ${selected ? '#ffffff' : empty ? 'rgba(141,154,179,0.5)' : '#d6b25e'}`,
        `background:${selected ? 'radial-gradient(circle, #f6e3a8, #d6b25e)' : 'rgba(5,9,20,0.86)'}`,
        `color:${selected ? '#1a1530' : empty ? 'rgba(201,211,227,0.5)' : '#f2f6fc'}`,
        `box-shadow:${selected ? '0 0 22px rgba(246,227,168,0.9)' : '0 0 8px rgba(5,9,20,0.7)'}`,
        `transform:scale(${selected ? 1.15 : 1})`, 'transition:transform 60ms', `font:600 ${Math.round(ring.b * 0.5)}px ${FONT}`,
        'overflow:hidden', 'padding:0 4px',
      ].join(';');
    });
  }

  /* ---------- 指の追跡（Pointer Events のみ） ---------- */

  on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  bind() {
    for (const name of ['attack', 'dodge', 'skill', 'page']) {
      this.on(this.els[name].el, 'pointerdown', (e) => this.onDown(e, name), { passive: false });
      this.on(this.els[name].el, 'contextmenu', (e) => e.preventDefault());
    }
    // 指がボタンの外へ出ても追えるよう、move / up / cancel は window で受ける（pointerId で絞り込む）
    this.on(window, 'pointermove', (e) => this.onMove(e), { passive: true });
    this.on(window, 'pointerup', (e) => this.onEnd(e, false));
    this.on(window, 'pointercancel', (e) => this.onEnd(e, true));
    this.on(window, 'blur', () => this.releaseAll());
    this.on(window, 'pagehide', () => this.releaseAll());
    this.on(window, 'orientationchange', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => { if (document.hidden) this.releaseAll(); });

    const c = this.combat;
    this.disposers.push(
      c.on('attack', () => this.renderPips()),
      c.on('combo-reset', () => this.renderPips()),
      c.on('skill-ring-open', () => { this.renderRing(); this.paint('skill'); }),
      c.on('skill-ring-select', () => this.renderRing()),
      c.on('skill-ring-close', () => { this.renderRing(); this.paint('skill'); }),
      c.on('skill-page', () => this.renderLabels()),
      c.on('skill', () => this.renderLabels()),
      c.on('skill-empty', () => { this.flash = 0.25; this.paint('skill'); }),
    );
  }

  onDown(e, name) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.active.has(e.pointerId)) return;
    e.preventDefault();
    if (name === 'skill') {
      if (this.skillPointer !== null || !this.combat.skillDown()) return; // 2 本目の指は無視
      this.skillPointer = e.pointerId;
      this.skillStart = { x: e.clientX, y: e.clientY };
    }
    try { this.els[name].el.setPointerCapture(e.pointerId); } catch (_) { /* window で追跡する */ }
    this.active.set(e.pointerId, name);
    this.pressedCount[name] += 1;
    this.paint(name);
    if (name === 'attack') this.combat.pressAttack();
    else if (name === 'dodge') this.combat.pressDodge();
    else if (name === 'page') this.combat.pressPage();
  }

  onMove(e) {
    if (e.pointerId !== this.skillPointer) return;
    this.combat.skillMove(e.clientX - this.skillStart.x, e.clientY - this.skillStart.y);
  }

  onEnd(e, cancelled) {
    const name = this.active.get(e.pointerId);
    if (!name) return; // このUIの指ではない（ジョイスティックや右側の空き領域の指）
    this.active.delete(e.pointerId);
    this.pressedCount[name] = Math.max(0, this.pressedCount[name] - 1);
    this.paint(name);
    if (name === 'skill' && e.pointerId === this.skillPointer) {
      this.skillPointer = null;
      if (cancelled) this.combat.cancelSkill(); else this.combat.skillUp();
    }
  }

  /** pointercancel・画面非表示・フォーカス喪失など。何も発動せず、すべての押下を解除する。 */
  releaseAll() {
    this.active.clear();
    this.skillPointer = null;
    for (const name of Object.keys(this.pressedCount)) {
      if (this.pressedCount[name] !== 0) { this.pressedCount[name] = 0; if (this.layoutData) this.paint(name); }
    }
    this.combat.cancelSkill();
  }

  /** FieldScene.update から毎フレーム（既存ループ）。コンボ表示と警告表示の更新だけ。 */
  update(dt) {
    this.renderPips();
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) { this.flash = 0; this.paint('skill'); }
    }
  }

  dispose() {
    this.releaseAll();
    for (const off of this.disposers) off();
    this.disposers = [];
    for (const { el } of Object.values(this.els)) if (el.parentNode) el.parentNode.removeChild(el);
    for (const el of [this.ringEl, this.probe]) if (el && el.parentNode) el.parentNode.removeChild(el);
    this.els = {};
    this.ringEl = null;
    this.probe = null;
  }
}
