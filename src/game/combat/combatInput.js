/**
 * 戦闘入力ロジック (src/game/combat/combatInput.js)
 *
 * DOM にも描画にも依存しない、「右手の操作」の状態機械。ボタン UI（ui/combatButtons.js）が
 * pressAttack() などを呼び、結果をイベントとして発行する。ダメージ・当たり判定・無敵処理・
 * スキル効果は一切持たない（未実装）。戦闘システムは、ここのイベントを購読して接続する。
 * 時間は update(dt) で進める（既存のゲームループ。タブ非表示中は進まない）。
 *
 * 発行するイベント（すべて { type, ... } 形式。on('*', fn) で全部受けられる）:
 *   attack            { combo: 1〜5, comboMax, continued: boolean }
 *   dodge             { invulnerableSeconds: 0.3, canceledCombo: boolean }
 *   combo-reset       { reason: 'timeout' | 'dodge', lastCombo }
 *   skill             { skillId, page, slot, via: 'tap' | 'ring' }
 *   skill-empty       { page }              選択中のスキルが無い状態でタップされた
 *   skill-ring-open   { page, slots }
 *   skill-ring-select { page, slot: 0〜3 | null, direction: 'up'|'right'|'down'|'left'|null }
 *   skill-ring-close  { page, fired: boolean }
 *   skill-page        { page, pageCount }
 */

export const COMBO_MAX = 5;
export const COMBO_WINDOW_SEC = 1.2;        // 次の攻撃入力までの猶予
export const DODGE_INVULNERABLE_SEC = 0.3;  // 回避の無敵時間（仕様値。処理は戦闘システム側）
export const SKILL_HOLD_SEC = 0.18;         // これ以上の長押しでスキル選択リング
export const SKILL_SLOTS_PER_PAGE = 4;
export const RING_THRESHOLD_PX = 18;        // リング中、これ未満の移動は「未選択」

/** 上 / 右 / 下 / 左 → 1〜4 番目のスキル枠（index 0〜3） */
export const RING_DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);

export class CombatInput {
  /**
   * @param {object} [options]
   * @param {number} [options.pageCount=2] スキルページ数（枠だけを管理。中身は setSkillPages で渡す）
   */
  constructor({ pageCount = 2 } = {}) {
    this.listeners = new Map();
    this.time = 0;

    // 通常攻撃
    this.combo = 0;
    this.sinceAttack = 0;

    // スキル（スキル ID は外部のスキルデータから渡す。ここでは作らない）
    this.pageCount = Math.max(1, pageCount);
    this.page = 0;
    this.pages = Array.from({ length: this.pageCount }, () => new Array(SKILL_SLOTS_PER_PAGE).fill(null));
    this.selectedSlot = new Array(this.pageCount).fill(null); // ページごとの「現在選択中」
    this.skill = { down: false, downTime: 0, ring: false, slot: null, direction: null };
  }

  /* ---------- イベント ---------- */

  on(type, listener) {
    if (typeof listener !== 'function') return () => {};
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type).delete(listener);
  }

  emit(type, payload) {
    const event = { type, ...payload };
    for (const key of [type, '*']) {
      const set = this.listeners.get(key);
      if (!set) continue;
      for (const fn of [...set]) {
        try { fn(event); } catch (error) { console.error('[ASTRALIA:combat] リスナーでエラー:', error); }
      }
    }
  }

  /* ---------- スキルデータ（外部から受け取る） ---------- */

  /** @param {(string|number|null)[][]} pages ページごとに最大 4 つのスキル ID（未設定は null） */
  setSkillPages(pages) {
    this.pageCount = Math.max(1, pages.length);
    this.pages = Array.from({ length: this.pageCount }, (_, p) => {
      const row = new Array(SKILL_SLOTS_PER_PAGE).fill(null);
      (pages[p] || []).slice(0, SKILL_SLOTS_PER_PAGE).forEach((id, i) => { row[i] = id === undefined ? null : id; });
      return row;
    });
    this.selectedSlot = new Array(this.pageCount).fill(null);
    this.page = Math.min(this.page, this.pageCount - 1);
    this.cancelSkill();
  }

  slots(page = this.page) { return this.pages[page]; }

  /** 現在のページで選択中の枠 index。明示的に選んでいなければ最初の設定済み枠。無ければ null。 */
  currentSlot() {
    const chosen = this.selectedSlot[this.page];
    if (chosen !== null && this.pages[this.page][chosen] !== null) return chosen;
    const first = this.pages[this.page].findIndex((id) => id !== null);
    return first >= 0 ? first : null;
  }

  currentSkill() {
    const slot = this.currentSlot();
    return slot === null ? null : this.pages[this.page][slot];
  }

  /* ---------- 時間 ---------- */

  /** ゲームループから毎フレーム呼ぶ。コンボの猶予とスキル長押しの判定を進める。 */
  update(dt) {
    this.time += dt;
    if (this.combo > 0) {
      this.sinceAttack += dt;
      if (this.sinceAttack > COMBO_WINDOW_SEC) this.resetCombo('timeout');
    }
    const s = this.skill;
    if (s.down && !s.ring && this.time - s.downTime >= SKILL_HOLD_SEC) this.openRing();
  }

  /* ---------- 通常攻撃 ---------- */

  pressAttack() {
    const continued = this.combo > 0 && this.sinceAttack <= COMBO_WINDOW_SEC;
    this.combo = continued ? (this.combo >= COMBO_MAX ? 1 : this.combo + 1) : 1; // 5 段の次は 1 段目から
    this.sinceAttack = 0;
    this.emit('attack', { combo: this.combo, comboMax: COMBO_MAX, continued });
  }

  resetCombo(reason) {
    const lastCombo = this.combo;
    this.combo = 0;
    this.sinceAttack = 0;
    if (lastCombo > 0) this.emit('combo-reset', { reason, lastCombo });
  }

  /* ---------- 回避 ---------- */

  pressDodge() {
    const canceledCombo = this.combo > 0;
    if (canceledCombo) this.resetCombo('dodge'); // 回避で通常攻撃コンボをキャンセル
    this.emit('dodge', { invulnerableSeconds: DODGE_INVULNERABLE_SEC, canceledCombo });
  }

  /* ---------- スキル ---------- */

  skillDown() {
    const s = this.skill;
    if (s.down) return false; // 2 本目の指は無視
    s.down = true;
    s.downTime = this.time;
    s.ring = false;
    s.slot = null;
    s.direction = null;
    return true;
  }

  openRing() {
    const s = this.skill;
    s.ring = true;
    s.slot = null;
    s.direction = null;
    this.emit('skill-ring-open', { page: this.page, slots: this.pages[this.page].slice() });
  }

  /** @param {number} dx @param {number} dy 指の移動量（スキルボタンを押した位置からの px） */
  skillMove(dx, dy) {
    const s = this.skill;
    if (!s.ring) return;
    let direction = null;
    if (Math.hypot(dx, dy) >= RING_THRESHOLD_PX) {
      if (Math.abs(dy) >= Math.abs(dx)) direction = dy < 0 ? 'up' : 'down';
      else direction = dx > 0 ? 'right' : 'left';
    }
    let slot = direction === null ? null : RING_DIRECTIONS.indexOf(direction);
    if (slot !== null && this.pages[this.page][slot] === null) slot = null; // 未設定の枠は選べない
    if (slot !== s.slot || direction !== s.direction) {
      s.slot = slot;
      s.direction = direction;
      this.emit('skill-ring-select', { page: this.page, slot, direction });
    }
  }

  skillUp() {
    const s = this.skill;
    if (!s.down) return;
    // update が間に合わなかった長押し（フレーム落ち）もリング扱いにする
    if (!s.ring && this.time - s.downTime >= SKILL_HOLD_SEC) this.openRing();
    if (s.ring) {
      const slot = s.slot;
      s.down = false; s.ring = false; s.slot = null; s.direction = null;
      let fired = false;
      if (slot !== null) {
        this.selectedSlot[this.page] = slot;
        this.emit('skill', { skillId: this.pages[this.page][slot], page: this.page, slot, via: 'ring' });
        fired = true;
      }
      this.emit('skill-ring-close', { page: this.page, fired });
      return;
    }
    s.down = false;
    const slot = this.currentSlot();
    if (slot === null) this.emit('skill-empty', { page: this.page });
    else this.emit('skill', { skillId: this.pages[this.page][slot], page: this.page, slot, via: 'tap' });
  }

  /** pointercancel・画面非表示・フォーカス喪失など。何も発動せずに解除する。 */
  cancelSkill() {
    const s = this.skill;
    const hadRing = s.ring;
    s.down = false; s.ring = false; s.slot = null; s.direction = null;
    if (hadRing) this.emit('skill-ring-close', { page: this.page, fired: false });
  }

  pressPage() {
    if (this.skill.ring || this.pageCount < 2) return false; // リング表示中は切り替えない
    this.page = (this.page + 1) % this.pageCount;
    this.emit('skill-page', { page: this.page, pageCount: this.pageCount });
    return true;
  }
}
