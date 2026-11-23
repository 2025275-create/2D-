/**
 * ASTRALIA ― 天環の彼方 ― ゲーム本体管理 (src/core/game.js)
 *
 * 役割:
 *   - Game クラス: 初期化 / 開始 / 停止 / 一時停止・再開 / 破棄 の管理
 *   - Canvas 2D の取得（既存 #game を優先、なければ生成）、サイズ調整、DPR 対応
 *   - シーン管理（SceneManager）: タイトル・プレイ・設定など任意のシーンを登録して切り替え
 *   - システム登録口（registerSystem）: 将来のマップ・戦闘・キャラクター等を接続する
 *   - main.js との接続: createGameService() が main.js のサービス登録口に対応する
 *
 * 現在の実装状況:
 *   実装済み : 起動・停止・破棄、Canvas管理、リサイズ/回転対応、固定ステップのループ、
 *              シーン管理、タイトル/プレイ(仮)/設定(仮)シーン、エラー保護
 *   未実装   : マップ、戦闘、キャラクター、敵、クエスト、セーブ読込、設定項目、音声
 *              （プレイ画面・設定画面は「仮表示」であり、ゲームとしては未完成です）
 *
 * 他ファイルとの前提（index.html / style.css / main.js）:
 *   #stage, #game(canvas), #ui, .screen#screen-title を参照。見つからなくても停止しない。
 *   window.Astralia が存在し、その .canvas が #game と同じ場合は「既存の背景描画」と判断し、
 *   Astralia.background.{start,stop} があれば Canvas を使うシーンの間だけ背景描画を止める。
 *
 * シーンの形（すべて任意）:
 *   { ownsCanvas, enter(params), exit(), update(dt), render(ctx, frame),
 *     resize(viewport), onPointerDown({x,y,event}), onKeyDown(event), dispose() }
 *   ownsCanvas が true のシーンだけが Canvas に描画する（座標は論理ピクセル）。
 */

/* ==========================================================================
   定数
   ========================================================================== */

export const TILE_SIZE = 32;   // ピクセルアートの基準タイル
export const MAX_FLOOR = 100;  // 将来の最大階層

export const GAME_STATUS = Object.freeze({
  CREATED: 'created',
  READY: 'ready',
  RUNNING: 'running',
  STOPPED: 'stopped',
  ERROR: 'error',
  DISPOSED: 'disposed',
});

export const SCENE = Object.freeze({
  TITLE: 'title',
  PLAY: 'play',
  SETTINGS: 'settings',
});

const BASE_VIEW = Object.freeze({ width: TILE_SIZE * 20, height: 360 }); // 論理解像度の下限 (640x360)
const MAX_DPR = 2;                    // 描画負荷の上限
const ORIENTATION_DELAY_MS = 200;     // iPad の回転完了待ち
const MAX_CONSECUTIVE_ERRORS = 3;     // 連続エラーでループ停止
const CLEAR_COLOR = '#050914';
const LOG_PREFIX = '[ASTRALIA:game]';

const log = Object.freeze({
  info: (...a) => console.info(LOG_PREFIX, ...a),
  warn: (...a) => console.warn(LOG_PREFIX, ...a),
  error: (...a) => console.error(LOG_PREFIX, ...a),
});

/** 多重起動防止用（モジュール内に閉じた状態。グローバルには公開しない） */
let activeGame = null;

/* ==========================================================================
   小さなイベントエミッタ
   ========================================================================== */

class Emitter {
  constructor() {
    this.map = new Map();
  }

  on(type, listener) {
    if (typeof listener !== 'function') return () => {};
    let set = this.map.get(type);
    if (!set) { set = new Set(); this.map.set(type, set); }
    set.add(listener);
    return () => set.delete(listener);
  }

  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (error) {
        log.error(`イベント "${type}" のリスナーでエラー:`, error);
      }
    }
  }

  clear() {
    this.map.clear();
  }
}

/* ==========================================================================
   ゲーム状態
   ========================================================================== */

class GameState {
  constructor(events, initial) {
    this.events = events;
    this.data = { ...initial };
  }

  get(key) {
    return this.data[key];
  }

  patch(changes) {
    const previous = this.data;
    this.data = { ...previous, ...changes };
    this.events.emit('state:change', { changes, previous, current: this.data });
  }

  snapshot() {
    return { ...this.data };
  }
}

/* ==========================================================================
   内蔵ゲームループ（固定ステップ 1/60 秒、タブ非表示時は rAF 停止）
   loopFactory オプションで、同じインターフェース
   (start / stop / pause / resume / paused / fps) の別実装に差し替え可能。
   ========================================================================== */

class FrameLoop {
  constructor({ update, render, step = 1 / 60, maxDelta = 0.25, maxSteps = 5 }) {
    this.update = update;
    this.render = render;
    this.step = step;
    this.maxDelta = maxDelta;
    this.maxSteps = maxSteps;
    this.userPaused = false;
    this.hidden = false;
    this.running = false;
    this.fps = 0;
    this.frameMs = 0;
    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.tick = this.tick.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
  }

  get paused() { return this.userPaused || this.hidden; }

  start() {
    if (this.running) return;
    this.running = true;
    this.hidden = document.hidden;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (!this.hidden) this.schedule();
  }

  stop() {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  pause() { this.userPaused = true; }

  resume() {
    this.userPaused = false;
    this.resetClock();
  }

  schedule() {
    this.resetClock();
    this.raf = requestAnimationFrame(this.tick);
  }

  resetClock() {
    this.last = 0;
    this.acc = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
  }

  onVisibility() {
    if (!this.running) return;
    if (document.hidden) {
      this.hidden = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.hidden = false;
      if (!this.raf) this.schedule();
    }
  }

  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.last) { this.last = now; return; }

    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt < 0) dt = 0;
    this.frameMs = dt * 1000;

    this.fpsFrames += 1;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (dt > this.maxDelta) dt = this.maxDelta;

    if (!this.userPaused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= this.step && steps < this.maxSteps) {
        this.update(this.step);
        this.acc -= this.step;
        steps += 1;
      }
      if (steps === this.maxSteps) this.acc = 0;
    }
    this.render(this.acc / this.step);
  }
}

/* ==========================================================================
   シーン管理
   ========================================================================== */

class SceneManager {
  constructor(game) {
    this.game = game;
    this.factories = new Map();
    this.current = null;
    this.currentName = null;
    this.token = 0;
  }

  /**
   * @param {string} name
   * @param {(game: Game) => object} factory シーンを返す関数（遷移のたびに新規生成）
   */
  register(name, factory) {
    if (typeof factory !== 'function') {
      throw new TypeError(`シーン "${name}" のファクトリが関数ではありません。`);
    }
    this.factories.set(name, factory);
  }

  has(name) {
    return this.factories.has(name);
  }

  /** 遷移中に別の遷移が始まった場合は、古い遷移を破棄して false を返す。 */
  async change(name, params) {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`シーン "${name}" は登録されていません。`);

    const token = ++this.token;
    const previous = this.current;
    this.current = null;            // 遷移中は update / render の対象にしない
    this.currentName = null;
    if (previous) await this.teardown(previous);
    if (token !== this.token) return false;

    const scene = factory(this.game);
    if (!scene || typeof scene !== 'object') {
      throw new TypeError(`シーン "${name}" のファクトリがオブジェクトを返しませんでした。`);
    }

    this.game.applyCanvasOwnership(!!scene.ownsCanvas);
    try {
      if (typeof scene.enter === 'function') await scene.enter(params);
    } catch (error) {
      await this.teardown(scene);
      throw error;
    }
    if (token !== this.token) {
      await this.teardown(scene);
      return false;
    }

    const previousName = this.game.state.get('mode');
    this.current = scene;
    this.currentName = name;
    this.game.state.patch({ mode: name });
    if (typeof scene.resize === 'function') this.game.guardCall('scene.resize', () => scene.resize(this.game.viewport));
    this.game.events.emit('scene:change', { name, previous: previousName });
    return true;
  }

  async teardown(scene) {
    try {
      if (typeof scene.exit === 'function') await scene.exit();
    } catch (error) {
      log.error('シーンの exit でエラー:', error);
    }
    try {
      if (typeof scene.dispose === 'function') scene.dispose();
    } catch (error) {
      log.error('シーンの dispose でエラー:', error);
    }
  }

  /** Game.dispose() 用。進行中の遷移も無効化する。 */
  dispose() {
    this.token += 1;
    const scene = this.current;
    this.current = null;
    this.currentName = null;
    if (scene) this.teardown(scene);
    this.factories.clear();
  }
}

/* ==========================================================================
   Game
   ========================================================================== */

export class Game {
  /**
   * @param {object} [options]
   * @param {HTMLCanvasElement} [options.canvas]    使用する Canvas（省略時はセレクタで取得 → なければ生成）
   * @param {string}  [options.canvasSelector='#game']
   * @param {string}  [options.stageSelector='#stage']
   * @param {string}  [options.uiSelector='#ui']
   * @param {string}  [options.initialScene='title']
   * @param {object|null} [options.bridge]          index.html 内蔵ブリッジ（省略時は window.Astralia）
   * @param {(callbacks:{update:Function,render:Function}) => object} [options.loopFactory]
   * @param {(message:string) => void} [options.notify]          ユーザー向け通知
   * @param {(context:string, error:unknown) => void} [options.onError]  エラー報告
   */
  constructor(options = {}) {
    if (activeGame && activeGame.status !== GAME_STATUS.DISPOSED) {
      throw new Error('Game はすでに作成されています（多重起動はできません）。');
    }
    this.options = {
      canvas: null,
      canvasSelector: '#game',
      stageSelector: '#stage',
      uiSelector: '#ui',
      initialScene: SCENE.TITLE,
      bridge: undefined,
      loopFactory: null,
      notify: null,
      onError: null,
      ...options,
    };

    this.status = GAME_STATUS.CREATED;
    this.events = new Emitter();
    this.state = new GameState(this.events, { mode: 'boot', floor: 1, maxFloor: MAX_FLOOR });
    this.scenes = new SceneManager(this);
    this.systems = new Map();       // name -> { system, initialized }
    this.saveProvider = null;       // 将来のセーブシステム接続口

    this.canvas = null;
    this.ctx = null;
    this.stage = null;
    this.ui = null;
    this.bridge = null;
    this.loop = null;
    this.legacyBackground = false;  // 既存の背景描画が同じ Canvas を使っているか
    this.canvasOwned = false;       // 現在のシーンが Canvas を使うか
    this.createdCanvas = false;
    this.viewport = Object.freeze({
      cssWidth: 0, cssHeight: 0, dpr: 1, deviceWidth: 0, deviceHeight: 0,
      scale: 1, width: BASE_VIEW.width, height: BASE_VIEW.height,
      offsetX: 0, offsetY: 0, isLandscape: true,
    });

    this.cleanups = [];
    this.resizeRaf = 0;
    this.orientationTimer = 0;
    this.resizeObserver = null;
    this.streak = { update: 0, render: 0 };
    this.warned = new Set();

    activeGame = this;
  }

  get paused() {
    return !!(this.loop && this.loop.paused);
  }

  /* ---------- ライフサイクル ---------- */

  /** DOM・Canvas・イベントを準備する。失敗した場合は後始末をして例外を投げる。 */
  init() {
    if (this.status !== GAME_STATUS.CREATED) return;
    try {
      this.stage = this.query(this.options.stageSelector);
      this.ui = this.query(this.options.uiSelector);
      this.bridge = this.options.bridge !== undefined ? this.options.bridge : (globalThis.Astralia || null);
      this.canvas = this.acquireCanvas();
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      if (!this.ctx) throw new Error('Canvas 2D コンテキストを取得できませんでした。');
      this.legacyBackground = !!(this.bridge && this.bridge.canvas === this.canvas);
      this.loop = this.createLoop();
      this.bindEvents();
      this.resize();
      this.status = GAME_STATUS.READY;
      this.events.emit('game:init');
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** ループを開始し、最初のシーン（既定はタイトル）を表示する。停止後の再開始にも使える。 */
  async start() {
    if (this.status === GAME_STATUS.DISPOSED) throw new Error('破棄済みの Game は開始できません。');
    if (this.status === GAME_STATUS.RUNNING) return;
    if (this.status === GAME_STATUS.CREATED) this.init();

    this.streak.update = 0;
    this.streak.render = 0;
    this.initSystems();
    this.status = GAME_STATUS.RUNNING;
    this.loop.start();
    if (!this.scenes.current) await this.changeScene(this.options.initialScene);
    this.events.emit('game:start');
  }

  /** ループを止める（状態・シーンは保持）。再び start() で動かせる。 */
  stop() {
    if (this.status !== GAME_STATUS.RUNNING && this.status !== GAME_STATUS.ERROR) return;
    if (this.loop) this.loop.stop();
    this.status = GAME_STATUS.STOPPED;
    this.events.emit('game:stop');
  }

  /** 更新を止める（描画は継続）。 */
  pause() {
    if (this.status !== GAME_STATUS.RUNNING || !this.loop) return;
    this.loop.pause();
    this.events.emit('game:pause');
  }

  resume() {
    if (this.status !== GAME_STATUS.RUNNING || !this.loop) return;
    this.loop.resume();
    this.events.emit('game:resume');
  }

  /** すべてのリスナー・タイマー・システム・シーンを解放し、DOM を元に戻す。 */
  dispose() {
    if (this.status === GAME_STATUS.DISPOSED) return;

    if (this.loop) this.guardCall('loop.stop', () => this.loop.stop());
    cancelAnimationFrame(this.resizeRaf);
    clearTimeout(this.orientationTimer);
    this.resizeRaf = 0;
    this.orientationTimer = 0;
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    for (const cleanup of this.cleanups.reverse()) this.guardCall('cleanup', cleanup);
    this.cleanups = [];

    this.scenes.dispose();
    for (const [name, entry] of [...this.systems].reverse()) {
      if (entry.initialized && typeof entry.system.dispose === 'function') {
        this.guardCall(`system.dispose(${name})`, () => entry.system.dispose());
      }
    }
    this.systems.clear();

    this.applyCanvasOwnership(false); // 既存の背景描画を元に戻す
    if (this.ui) this.ui.style.visibility = '';
    if (this.stage) this.stage.removeAttribute('data-scene');
    if (this.createdCanvas && this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    this.status = GAME_STATUS.DISPOSED;
    this.events.emit('game:dispose');
    this.events.clear();
    this.loop = null;
    this.ctx = null;
    this.canvas = null;
    if (activeGame === this) activeGame = null;
  }

  /* ---------- Canvas / リサイズ ---------- */

  query(selector) {
    try {
      return document.querySelector(selector);
    } catch (error) {
      log.warn(`セレクタが不正です: ${selector}`, error);
      return null;
    }
  }

  acquireCanvas() {
    const given = this.options.canvas;
    if (given && given.tagName === 'CANVAS') return given;

    const found = this.query(this.options.canvasSelector);
    if (found && found.tagName === 'CANVAS') return found;

    log.warn('Canvas が見つからないため生成します。');
    const canvas = document.createElement('canvas');
    if (this.options.canvasSelector.charAt(0) === '#') canvas.id = this.options.canvasSelector.slice(1);
    canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;';
    (this.stage || document.body).appendChild(canvas);
    this.createdCanvas = true;
    return canvas;
  }

  /** 画面サイズ・DPR・整数倍率を計算し、必要なら Canvas のバッキングサイズを更新する。 */
  resize() {
    if (!this.canvas || this.status === GAME_STATUS.DISPOSED) return;

    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width));
    const cssHeight = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, MAX_DPR);
    const deviceWidth = Math.max(1, Math.round(cssWidth * dpr));
    const deviceHeight = Math.max(1, Math.round(cssHeight * dpr));

    // ピクセルアートを滲ませないため、可能な限り整数倍率にする
    const fit = Math.min(deviceWidth / BASE_VIEW.width, deviceHeight / BASE_VIEW.height);
    const scale = fit >= 1 ? Math.floor(fit) : Math.max(0.1, fit);
    const width = Math.floor(deviceWidth / scale);
    const height = Math.floor(deviceHeight / scale);

    this.viewport = Object.freeze({
      cssWidth, cssHeight, dpr, deviceWidth, deviceHeight, scale, width, height,
      offsetX: Math.floor((deviceWidth - width * scale) / 2),
      offsetY: Math.floor((deviceHeight - height * scale) / 2),
      isLandscape: cssWidth >= cssHeight,
    });

    if (this.canUseCanvas()) this.syncCanvasSize();

    const scene = this.scenes.current;
    if (scene && typeof scene.resize === 'function') this.guardCall('scene.resize', () => scene.resize(this.viewport));
    this.events.emit('game:resize', this.viewport);
  }

  /** 既存の背景描画が Canvas を使っている間は、バッキングサイズに触れない。 */
  canUseCanvas() {
    return !this.legacyBackground || this.canvasOwned;
  }

  syncCanvasSize() {
    const { deviceWidth, deviceHeight } = this.viewport;
    // 同じ値でも width 代入はキャンバスを消去するため、変化したときだけ代入する
    if (this.canvas.width !== deviceWidth) this.canvas.width = deviceWidth;
    if (this.canvas.height !== deviceHeight) this.canvas.height = deviceHeight;
    this.ctx.imageSmoothingEnabled = false;
  }

  scheduleResize() {
    if (this.resizeRaf || this.status === GAME_STATUS.DISPOSED) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      this.resize();
    });
  }

  /**
   * Canvas を使うシーンの間だけ、既存の背景描画（index.html 内蔵）を止める。
   * @param {boolean} owns
   */
  applyCanvasOwnership(owns) {
    if (owns === this.canvasOwned) return;
    this.canvasOwned = owns;

    const background = this.bridge && this.bridge.background;
    if (this.legacyBackground) {
      if (owns) {
        if (background && typeof background.stop === 'function') {
          this.guardCall('背景描画の停止', () => background.stop());
        } else {
          this.warnOnce('no-bg-control',
            'index.html に Astralia.background.stop/start が無いため、背景描画と重なる可能性があります。');
        }
      } else if (background && typeof background.start === 'function') {
        this.guardCall('背景描画の再開', () => background.start());
      }
    }
    if (owns && this.canvas && this.ctx) {
      this.resize();
    }
  }

  /* ---------- 入力イベント ---------- */

  listen(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  bindEvents() {
    const onResize = () => this.scheduleResize();
    this.listen(window, 'resize', onResize);
    this.listen(window, 'orientationchange', () => {
      clearTimeout(this.orientationTimer);
      this.orientationTimer = setTimeout(onResize, ORIENTATION_DELAY_MS);
    });
    if (window.visualViewport) this.listen(window.visualViewport, 'resize', onResize);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(onResize);
      this.resizeObserver.observe(this.canvas);
    }

    this.listen(this.canvas, 'pointerdown', (event) => this.handlePointerDown(event), { passive: false });
    this.listen(window, 'keydown', (event) => this.handleKeyDown(event));
  }

  handlePointerDown(event) {
    const scene = this.scenes.current;
    if (this.status !== GAME_STATUS.RUNNING || !scene || typeof scene.onPointerDown !== 'function') return;
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const { dpr, offsetX, offsetY, scale } = this.viewport;
    const x = ((event.clientX - rect.left) * dpr - offsetX) / scale;
    const y = ((event.clientY - rect.top) * dpr - offsetY) / scale;
    this.guardCall('scene.onPointerDown', () => scene.onPointerDown({ x, y, event }));
  }

  handleKeyDown(event) {
    const scene = this.scenes.current;
    if (this.status !== GAME_STATUS.RUNNING || !scene || typeof scene.onKeyDown !== 'function') return;
    this.guardCall('scene.onKeyDown', () => scene.onKeyDown(event));
  }

  /* ---------- ループ ---------- */

  createLoop() {
    const callbacks = {
      update: (dt) => this.update(dt),
      render: (alpha) => this.render(alpha),
    };
    const factory = this.options.loopFactory;
    const loop = typeof factory === 'function' ? factory(callbacks) : new FrameLoop(callbacks);
    for (const method of ['start', 'stop', 'pause', 'resume']) {
      if (!loop || typeof loop[method] !== 'function') {
        throw new TypeError(`ループに ${method}() がありません。`);
      }
    }
    return loop;
  }

  update(dt) {
    if (this.status !== GAME_STATUS.RUNNING) return;
    this.runPhase('update', () => {
      for (const entry of this.systems.values()) {
        if (entry.initialized && typeof entry.system.update === 'function') entry.system.update(dt, this);
      }
      const scene = this.scenes.current;
      if (scene && typeof scene.update === 'function') scene.update(dt);
    });
  }

  render(alpha) {
    if (this.status !== GAME_STATUS.RUNNING || !this.ctx) return;
    if (this.legacyBackground && !this.canvasOwned) return; // 既存の背景描画に任せる
    this.runPhase('render', () => {
      const ctx = this.ctx;
      const vp = this.viewport;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = CLEAR_COLOR;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.canvasOwned) return;

      ctx.save();
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath();
      ctx.rect(0, 0, vp.width, vp.height);
      ctx.clip();
      const frame = { alpha, game: this };
      // システム（将来のマップ・エンティティ等）を先に、シーン（UI含む）を後に描く
      for (const entry of this.systems.values()) {
        if (entry.initialized && typeof entry.system.render === 'function') entry.system.render(ctx, frame);
      }
      const scene = this.scenes.current;
      if (scene && typeof scene.render === 'function') scene.render(ctx, frame);
      ctx.restore();
    });
  }

  /** 連続エラーが続いたらループを止めて報告する（毎フレームの画面スパムを防ぐ）。 */
  runPhase(phase, fn) {
    try {
      fn();
      this.streak[phase] = 0;
    } catch (error) {
      this.streak[phase] += 1;
      log.error(`${phase} でエラー (${this.streak[phase]}/${MAX_CONSECUTIVE_ERRORS}):`, error);
      if (this.streak[phase] >= MAX_CONSECUTIVE_ERRORS) this.fail(phase, error);
    }
  }

  fail(phase, error) {
    if (this.status === GAME_STATUS.ERROR || this.status === GAME_STATUS.DISPOSED) return;
    this.status = GAME_STATUS.ERROR;
    if (this.loop) this.guardCall('loop.stop', () => this.loop.stop());
    this.report(`ゲームループを停止しました（${phase}）`, error);
  }

  /* ---------- シーン・システム ---------- */

  registerScene(name, factory) {
    this.scenes.register(name, factory);
  }

  /** 切り替えに失敗した場合はエラーを報告し、可能ならタイトルへ戻す。 */
  async changeScene(name, params) {
    try {
      return await this.scenes.change(name, params);
    } catch (error) {
      this.report(`シーン "${name}" への切り替えに失敗しました`, error);
      if (name !== SCENE.TITLE && this.scenes.has(SCENE.TITLE) && this.status !== GAME_STATUS.DISPOSED) {
        try {
          await this.scenes.change(SCENE.TITLE);
        } catch (fallbackError) {
          log.error('タイトルへの復帰にも失敗しました:', fallbackError);
        }
      }
      return false;
    }
  }

  /**
   * 将来のマップ・戦闘・キャラクター等を接続する口。
   * system: { init(game), update(dt, game), render(ctx, frame), dispose() }（すべて任意）
   */
  registerSystem(name, system) {
    if (!system || typeof system !== 'object') throw new TypeError(`システム "${name}" が不正です。`);
    if (this.systems.has(name)) throw new Error(`システム "${name}" はすでに登録されています。`);
    this.systems.set(name, { system, initialized: false });
    if (this.status === GAME_STATUS.RUNNING) this.initSystems();
  }

  initSystems() {
    for (const [name, entry] of this.systems) {
      if (entry.initialized) continue;
      entry.initialized = true;
      if (typeof entry.system.init === 'function') {
        this.guardCall(`system.init(${name})`, () => entry.system.init(this));
      }
    }
  }

  /** 将来のセーブシステム用: { exists(): boolean, load(): Promise<object> } */
  setSaveProvider(provider) {
    this.saveProvider = provider || null;
  }

  /* ---------- タイトルメニューからの操作 ---------- */

  /** NEW GAME：プレイシーンへ。現時点のプレイシーンは仮表示（ゲーム本体は未実装）。 */
  async startNewGame() {
    this.events.emit('game:new-requested');
    this.state.patch({ floor: 1 });
    return this.changeScene(SCENE.PLAY, { mode: 'new' });
  }

  /** CONTINUE：セーブシステム未接続の間は、読込せずにその旨を通知する。 */
  async continueGame() {
    this.events.emit('game:continue-requested');
    const provider = this.saveProvider;
    if (!provider) {
      this.notify('CONTINUE ― セーブデータの読込は未実装です');
      return false;
    }
    if (!provider.exists()) {
      this.notify('セーブデータがありません');
      return false;
    }
    const save = await provider.load();
    return this.changeScene(SCENE.PLAY, { mode: 'continue', save });
  }

  /** SETTINGS：設定シーンへ。現時点は仮表示（設定項目は未実装）。 */
  async openSettings() {
    this.events.emit('settings:open-requested');
    return this.changeScene(SCENE.SETTINGS);
  }

  /* ---------- UI（DOM）操作 ---------- */

  setUiVisible(visible) {
    if (this.ui) this.ui.style.visibility = visible ? '' : 'hidden';
  }

  /** @param {string | null} id 表示する .screen の id（null で全て非表示） */
  showScreen(id) {
    if (!this.ui) return;
    for (const screen of this.ui.querySelectorAll('.screen')) {
      screen.classList.toggle('is-active', screen.id === id);
    }
  }

  setStageScene(name) {
    if (this.stage) this.stage.setAttribute('data-scene', name);
  }

  /* ---------- 通知・エラー ---------- */

  notify(message) {
    log.info(message);
    if (typeof this.options.notify === 'function') this.guardCall('notify', () => this.options.notify(message));
  }

  report(context, error) {
    log.error(`${context}:`, error);
    this.events.emit('game:error', { context, error });
    if (typeof this.options.onError === 'function') {
      try {
        this.options.onError(context, error);
      } catch (handlerError) {
        log.error('onError ハンドラでエラー:', handlerError);
      }
    }
  }

  guardCall(label, fn) {
    try {
      return fn();
    } catch (error) {
      log.error(`${label} でエラー:`, error);
      return undefined;
    }
  }

  warnOnce(key, message) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    log.warn(message);
  }
}

/* ==========================================================================
   標準シーン
   ========================================================================== */

/** タイトル：DOM（#ui の .screen#screen-title）と既存の背景描画が担当。Canvas は使わない。 */
class TitleScene {
  constructor(game) {
    this.game = game;
    this.ownsCanvas = false;
  }

  enter() {
    this.game.setStageScene(SCENE.TITLE);
    this.game.setUiVisible(true);
    this.game.showScreen('screen-title');
  }

  exit() {
    this.game.showScreen(null); // 戻ったときに登場演出を再生させる
    this.game.setUiVisible(false);
  }
}

/** 未実装画面の仮表示。ゲーム内容があるように見せず、未実装であることを明示する。 */
class PlaceholderScene {
  constructor(game, { heading, lines, grid }) {
    this.game = game;
    this.ownsCanvas = true;
    this.heading = heading;
    this.lines = lines;
    this.grid = grid;
    this.back = { x: 8, y: 8, w: 96, h: 32 };
  }

  enter() {
    this.game.setStageScene(SCENE.PLAY);
    this.game.setUiVisible(false);
  }

  goBack() {
    return this.game.changeScene(SCENE.TITLE);
  }

  onPointerDown({ x, y }) {
    const b = this.back;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) this.goBack();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') this.goBack();
  }

  render(ctx) {
    const game = this.game;
    const { width: w, height: h } = game.viewport;
    const T = TILE_SIZE;

    ctx.fillStyle = '#0a1230';
    ctx.fillRect(0, 0, w, h);

    if (this.grid) {
      ctx.fillStyle = '#101c46';
      for (let ty = 0; ty * T < h; ty += 1) {
        for (let tx = 0; tx * T < w; tx += 1) {
          if ((tx + ty) % 2 === 0) ctx.fillRect(tx * T, ty * T, T, T);
        }
      }
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8c872';
    ctx.font = 'bold 20px -apple-system, "Hiragino Sans", sans-serif';
    ctx.fillText(this.heading, w / 2, h / 2 - 36);
    ctx.fillStyle = '#c9d3e3';
    ctx.font = '12px -apple-system, "Hiragino Sans", sans-serif';
    this.lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + i * 20));
    if (this.grid) {
      ctx.fillStyle = '#8d9ab3';
      ctx.fillText(`階層 ${game.state.get('floor')} / ${game.state.get('maxFloor')}（仮表示）`, w / 2, h / 2 + this.lines.length * 20 + 8);
    }

    const b = this.back;
    ctx.strokeStyle = '#c9d3e3';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h);
    ctx.fillStyle = '#f2f6fc';
    ctx.fillText('◀ タイトル', b.x + b.w / 2, b.y + b.h / 2 + 1);

    const fps = game.loop && typeof game.loop.fps === 'number' ? game.loop.fps : 0;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9dffb0';
    ctx.fillText(`${fps.toFixed(0)} FPS`, w - 8, 18);
  }
}

/** 標準シーン（タイトル / プレイ[仮] / 設定[仮]）を登録する。 */
export function registerDefaultScenes(game) {
  game.registerScene(SCENE.TITLE, (g) => new TitleScene(g));
  game.registerScene(SCENE.PLAY, (g) => new PlaceholderScene(g, {
    heading: 'GAMEPLAY（仮表示）',
    lines: ['マップ・戦闘・キャラクターは未実装です', 'Esc またはボタンでタイトルへ戻れます'],
    grid: true,
  }));
  game.registerScene(SCENE.SETTINGS, (g) => new PlaceholderScene(g, {
    heading: 'SETTINGS（仮表示）',
    lines: ['設定項目は未実装です'],
    grid: false,
  }));
}

/* ==========================================================================
   main.js との接続口
   ========================================================================== */

const COMMAND = Object.freeze({ NEW_GAME: 'new-game', CONTINUE: 'continue', SETTINGS: 'settings' });

/**
 * main.js の GameApp.registerService() に登録するサービスを作る。
 *   app.registerService('game', createGameService());
 * init(app) で Game を起動し、タイトルのコマンドを Game の処理へ差し替える。
 * dispose() で Game を破棄する。
 */
export function createGameService(options = {}) {
  let game = null;

  return {
    get game() { return game; },

    async init(app) {
      const toast = app && app.toast;
      const errors = app && app.errors;
      game = new Game({
        ...options,
        notify: (message) => { if (toast && typeof toast.show === 'function') toast.show(message); },
        onError: (context, error) => { if (errors && typeof errors.report === 'function') errors.report(context, error); },
      });
      try {
        registerDefaultScenes(game);
        game.init();
        if (app && typeof app.registerCommand === 'function') {
          app.registerCommand(COMMAND.NEW_GAME, () => game.startNewGame());
          app.registerCommand(COMMAND.CONTINUE, () => game.continueGame());
          app.registerCommand(COMMAND.SETTINGS, () => game.openSettings());
        }
        await game.start();
      } catch (error) {
        game.dispose();
        game = null;
        throw error;
      }
    },

    dispose() {
      if (game) game.dispose();
      game = null;
    },
  };
}
