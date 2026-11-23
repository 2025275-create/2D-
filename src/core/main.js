/**
 * ASTRALIA ― 天環の彼方 ― 起動処理 (src/core/main.js)
 *
 * 役割:
 *   - DOM読み込み完了後に、ゲームを一度だけ初期化する（多重初期化防止）
 *   - タイトル画面のコマンド（NEW GAME / CONTINUE / SETTINGS）を登録・実行する
 *   - 未捕捉エラーを捕捉し、コンソールと画面に表示する
 *   - 将来のサブシステム（Canvas描画 / ゲームループ / 入力 / セーブ）を
 *     サービスとして登録できる口を提供する
 *
 * 現在の実装状況:
 *   実装済み: 起動管理、コマンド登録、ボタン連携、エラー表示、セーブデータの有無確認
 *   未実装  : 新規ゲーム開始、セーブデータの読込、設定画面（押下時は「準備中」と表示）
 *
 * index.html との対応:
 *   #ui              … ボタンのクリックを受けるルート（なければ document）
 *   [data-command]   … "new-game" / "continue" / "settings"
 *   #toast           … 通知表示（なければコンソールのみ）
 *   window.Astralia  … index.html 内蔵の簡易ブリッジ（存在する場合は連携し、二重処理しない）
 */

/* ==========================================================================
   定数
   ========================================================================== */

const APP_NAME = 'ASTRALIA';
const BOOT_FLAG = Symbol.for('astralia.core.booted');

const SELECTORS = Object.freeze({
  uiRoot: '#ui',
  toast: '#toast',
  commandButton: '[data-command]',
});

const COMMANDS = Object.freeze({
  NEW_GAME: 'new-game',
  CONTINUE: 'continue',
  SETTINGS: 'settings',
});

const SAVE_STORAGE_KEY = 'astralia.save.v1'; // index.html 内蔵ブリッジと同じキー
const COMMAND_COOLDOWN_MS = 250;             // 連打による多重実行の防止
const TOAST_DURATION_MS = 2000;
const MAX_ERROR_REPORTS = 5;                 // エラー連鎖で画面が埋まらないようにする

const LOG_PREFIX = `[${APP_NAME}]`;

/* ==========================================================================
   ログ
   ========================================================================== */

const log = Object.freeze({
  info: (...args) => console.info(LOG_PREFIX, ...args),
  warn: (...args) => console.warn(LOG_PREFIX, ...args),
  error: (...args) => console.error(LOG_PREFIX, ...args),
});

/* ==========================================================================
   小さなイベントバス（将来のシステム間連携用）
   ========================================================================== */

class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * @param {string} type
   * @param {(payload?: any) => void} listener
   * @returns {() => void} 購読解除関数
   */
  on(type, listener) {
    if (typeof listener !== 'function') return () => {};
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    const set = this.listeners.get(type);
    if (set) set.delete(listener);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (error) {
        // 1つのリスナーの失敗で他のリスナーを止めない
        log.error(`イベント "${type}" のリスナーでエラー:`, error);
      }
    }
  }

  clear() {
    this.listeners.clear();
  }
}

/* ==========================================================================
   DOMユーティリティ
   ========================================================================== */

/**
 * DOMContentLoaded を待つ。すでに読み込み済みなら即座に解決する。
 * @returns {Promise<void>}
 */
function whenDomReady() {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

/**
 * セレクタで要素を取得する。見つからなくても例外にしない。
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {Element | null}
 */
function queryOptional(selector, root = document) {
  try {
    return root.querySelector(selector);
  } catch (error) {
    log.warn(`セレクタが不正です: ${selector}`, error);
    return null;
  }
}

/** @param {unknown} error */
function toErrorMessage(error) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/* ==========================================================================
   通知（トースト）
   ========================================================================== */

class Toast {
  /** @param {Element | null} element */
  constructor(element) {
    this.element = element;
    this.timer = 0;
  }

  /** @param {string} message */
  show(message) {
    log.info(message);
    const el = this.element;
    if (!el) return; // 要素がなくてもコンソールには出力済み
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => el.classList.remove('is-visible'), TOAST_DURATION_MS);
  }

  dispose() {
    clearTimeout(this.timer);
    if (this.element) this.element.classList.remove('is-visible');
  }
}

/* ==========================================================================
   エラー表示（画面）
   ========================================================================== */

class ErrorOverlay {
  constructor() {
    this.root = null;
    this.body = null;
    this.count = 0;
  }

  /**
   * @param {string} title
   * @param {string} detail
   */
  show(title, detail) {
    if (this.count >= MAX_ERROR_REPORTS) return;
    this.count += 1;

    try {
      this.ensureElements();
      const item = document.createElement('p');
      item.style.cssText = 'margin:0 0 10px;line-height:1.6;word-break:break-word;';
      const strong = document.createElement('strong');
      strong.textContent = title;
      item.appendChild(strong);
      item.appendChild(document.createElement('br'));
      item.appendChild(document.createTextNode(detail));
      this.body.appendChild(item);
      this.root.style.display = 'flex';
    } catch (overlayError) {
      // 表示自体に失敗してもアプリは止めない
      log.error('エラー表示に失敗しました:', overlayError);
    }
  }

  hide() {
    if (this.root) this.root.style.display = 'none';
    if (this.body) this.body.textContent = '';
    this.count = 0;
  }

  ensureElements() {
    if (this.root) return;
    const host = document.body || document.documentElement;

    const root = document.createElement('div');
    root.setAttribute('role', 'alert');
    root.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:9999',
      'display:none', 'flex-direction:column', 'gap:10px',
      'max-height:60%', 'overflow:auto',
      'padding:14px calc(env(safe-area-inset-right,0px) + 16px) calc(env(safe-area-inset-bottom,0px) + 14px) calc(env(safe-area-inset-left,0px) + 16px)',
      'background:rgba(40,8,16,0.96)', 'color:#ffd9de',
      'border-top:2px solid #ff6b81',
      'font:14px -apple-system,"Hiragino Sans",sans-serif',
      'pointer-events:auto', 'touch-action:manipulation',
    ].join(';');

    const heading = document.createElement('div');
    heading.textContent = 'エラーが発生しました';
    heading.style.cssText = 'font-weight:700;font-size:15px;';

    const body = document.createElement('div');

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;';
    actions.appendChild(this.createButton('閉じる', () => this.hide()));
    actions.appendChild(this.createButton('再読み込み', () => location.reload()));

    root.append(heading, body, actions);
    host.appendChild(root);
    this.root = root;
    this.body = body;
  }

  createButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'min-height:44px;padding:0 18px;border:1px solid #ff9aa9;background:transparent;color:#ffd9de;font:inherit;';
    button.addEventListener('click', onClick);
    return button;
  }
}

/* ==========================================================================
   エラーハンドラ（全体の捕捉）
   ========================================================================== */

class ErrorHandler {
  /** @param {ErrorOverlay} overlay */
  constructor(overlay) {
    this.overlay = overlay;
    this.installed = false;
    this.onError = this.onError.bind(this);
    this.onRejection = this.onRejection.bind(this);
  }

  install() {
    if (this.installed) return;
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
    this.installed = true;
  }

  uninstall() {
    if (!this.installed) return;
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    this.installed = false;
  }

  /**
   * 捕捉したエラーを記録して画面に表示する。
   * @param {string} context 発生箇所の説明
   * @param {unknown} error
   */
  report(context, error) {
    log.error(`${context}:`, error);
    this.overlay.show(context, toErrorMessage(error));
  }

  /** @param {ErrorEvent} event */
  onError(event) {
    // 画像などのリソース読込エラーはここには来ない（捕捉フェーズ未使用）
    this.report('予期しないエラー', event.error || event.message);
  }

  /** @param {PromiseRejectionEvent} event */
  onRejection(event) {
    this.report('未処理の非同期エラー', event.reason);
  }
}

/* ==========================================================================
   セーブデータ確認（読込処理は未実装）
   ========================================================================== */

class SaveService {
  /** セーブデータが存在するか確認する。ストレージが使えない環境では false。 */
  exists() {
    try {
      return window.localStorage.getItem(SAVE_STORAGE_KEY) !== null;
    } catch (error) {
      log.warn('ストレージにアクセスできません（プライベートブラウズ等）:', error);
      return false;
    }
  }
}

/* ==========================================================================
   アプリケーション本体
   ========================================================================== */

class GameApp {
  constructor() {
    this.events = new EventBus();
    this.overlay = new ErrorOverlay();
    this.errors = new ErrorHandler(this.overlay);
    this.save = new SaveService();

    /** @type {Toast} */
    this.toast = new Toast(null);
    /** @type {Element | null} */
    this.uiRoot = null;
    /** @type {Map<string, Element>} */
    this.buttons = new Map();
    /** @type {Map<string, () => (void | Promise<void>)>} */
    this.commands = new Map();
    /** @type {Map<string, { init?: Function, dispose?: Function }>} */
    this.services = new Map();
    /** @type {Map<string, number>} */
    this.lastRun = new Map();

    this.started = false;
    this.bridge = null;
    this.onUiClick = this.onUiClick.bind(this);
    this.onPageShow = this.onPageShow.bind(this);
  }

  /* ---------- 起動 ---------- */

  async start() {
    if (this.started) {
      log.warn('すでに起動済みです。多重初期化を無視しました。');
      return;
    }
    this.started = true;

    try {
      this.errors.install();
      this.resolveElements();
      this.registerDefaultCommands();
      await this.initServices();
      this.connectUi();
      this.refreshContinueButton();
      window.addEventListener('pageshow', this.onPageShow);
      this.events.emit('boot:ready');
      log.info('起動しました。');
    } catch (error) {
      this.errors.report('起動に失敗しました', error);
    }
  }

  /** 起動後に終了する場合や、テストでの後始末に使用する。 */
  async stop() {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('pageshow', this.onPageShow);
    this.disconnectUi();
    await this.disposeServices();
    this.toast.dispose();
    this.errors.uninstall();
    this.events.emit('boot:stopped');
    this.events.clear();
  }

  /* ---------- DOM ---------- */

  resolveElements() {
    this.uiRoot = queryOptional(SELECTORS.uiRoot);
    this.toast = new Toast(queryOptional(SELECTORS.toast));

    this.buttons.clear();
    const found = document.querySelectorAll(SELECTORS.commandButton);
    for (const button of found) {
      const command = button.getAttribute('data-command');
      if (command) this.buttons.set(command, button);
    }

    // 存在しないボタンはエラーにせず警告のみ
    for (const command of Object.values(COMMANDS)) {
      if (!this.buttons.has(command)) {
        log.warn(`ボタンが見つかりません: [data-command="${command}"]（無視して続行します）`);
      }
    }
  }

  /**
   * UIとコマンドを接続する。
   * index.html 内蔵ブリッジ（window.Astralia）があればそこへハンドラを登録し、
   * クリック処理の二重化を避ける。なければ自前でクリックを受ける。
   */
  connectUi() {
    const bridge = window.Astralia;
    const hasBridge = bridge && typeof bridge.on === 'function';

    if (hasBridge) {
      this.bridge = bridge;
      for (const command of this.commands.keys()) {
        bridge.on(command, () => this.runCommand(command));
      }
      log.info('index.html のブリッジに接続しました。');
      return;
    }

    const target = this.uiRoot || document;
    target.addEventListener('click', this.onUiClick);
    this.clickTarget = target;
  }

  disconnectUi() {
    if (this.clickTarget) {
      this.clickTarget.removeEventListener('click', this.onUiClick);
      this.clickTarget = null;
    }
    if (this.bridge) {
      // ブリッジ側のハンドラを無害な状態に戻す（未登録時の既定動作に戻る）
      for (const command of this.commands.keys()) {
        this.bridge.on(command, undefined);
      }
      this.bridge = null;
    }
  }

  /** @param {MouseEvent} event */
  onUiClick(event) {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const button = origin.closest(SELECTORS.commandButton);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    const command = button.getAttribute('data-command');
    if (command) this.runCommand(command);
  }

  onPageShow() {
    this.refreshContinueButton();
  }

  /** CONTINUE ボタンの有効・無効をセーブデータの有無に合わせる。 */
  refreshContinueButton() {
    const button = this.buttons.get(COMMANDS.CONTINUE);
    if (!button) return;
    const enabled = this.save.exists();
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', String(!enabled));
  }

  /* ---------- コマンド ---------- */

  /**
   * @param {string} name
   * @param {() => (void | Promise<void>)} handler
   */
  registerCommand(name, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`コマンド "${name}" のハンドラが関数ではありません。`);
    }
    this.commands.set(name, handler);
  }

  registerDefaultCommands() {
    this.registerCommand(COMMANDS.NEW_GAME, () => this.startNewGame());
    this.registerCommand(COMMANDS.CONTINUE, () => this.continueGame());
    this.registerCommand(COMMANDS.SETTINGS, () => this.openSettings());
  }

  /**
   * コマンドを実行する。同一コマンドの連打は無視し、例外はすべて捕捉する。
   * @param {string} name
   * @returns {Promise<void>}
   */
  async runCommand(name) {
    const handler = this.commands.get(name);
    if (!handler) {
      log.warn(`未登録のコマンドです: ${name}`);
      return;
    }

    const now = performance.now();
    const last = this.lastRun.get(name) ?? -Infinity;
    if (now - last < COMMAND_COOLDOWN_MS) return;
    this.lastRun.set(name, now);

    try {
      this.events.emit('command:run', { name });
      await handler();
    } catch (error) {
      this.errors.report(`コマンド "${name}" の実行に失敗しました`, error);
    }
  }

  /* ---------- タイトル画面の各処理（未実装部分は仮処理） ---------- */

  /** NEW GAME：新規ゲーム開始処理。ゲーム本体は未実装のため通知のみ。 */
  startNewGame() {
    this.events.emit('game:new-requested');
    this.toast.show('NEW GAME ― ゲーム本体は準備中です');
  }

  /** CONTINUE：セーブデータの有無を確認する。読込処理は未実装。 */
  continueGame() {
    if (!this.save.exists()) {
      this.refreshContinueButton();
      this.toast.show('セーブデータがありません');
      return;
    }
    this.events.emit('game:continue-requested');
    this.toast.show('セーブデータを確認しました ― 読込機能は準備中です');
  }

  /** SETTINGS：設定画面を開く。画面は未実装のため通知のみ。 */
  openSettings() {
    this.events.emit('settings:open-requested');
    this.toast.show('SETTINGS ― 設定画面は準備中です');
  }

  /* ---------- サービス（将来の拡張口） ---------- */

  /**
   * Canvas描画・ゲームループ・入力管理・セーブ等を登録する。
   * 登録されたサービスは start() 内で init()、stop() 内で dispose() が呼ばれる。
   * 例: app.registerService('loop', { init() {...}, dispose() {...} })
   *
   * @param {string} name
   * @param {{ init?: Function, dispose?: Function }} service
   */
  registerService(name, service) {
    if (this.services.has(name)) {
      throw new Error(`サービス "${name}" はすでに登録されています。`);
    }
    this.services.set(name, service);
  }

  /** @param {string} name */
  getService(name) {
    return this.services.get(name) ?? null;
  }

  async initServices() {
    for (const [name, service] of this.services) {
      if (typeof service.init !== 'function') continue;
      try {
        await service.init(this);
      } catch (error) {
        // 1つのサービスの失敗で全体を止めず、原因を表示する
        this.errors.report(`サービス "${name}" の初期化に失敗しました`, error);
      }
    }
  }

  async disposeServices() {
    for (const [name, service] of [...this.services].reverse()) {
      if (typeof service.dispose !== 'function') continue;
      try {
        await service.dispose();
      } catch (error) {
        log.error(`サービス "${name}" の終了処理に失敗しました:`, error);
      }
    }
    this.services.clear();
  }
}

/* ==========================================================================
   エントリーポイント
   ========================================================================== */

/**
 * ゲームを起動する。ページ内で一度だけ実行される。
 * @returns {Promise<GameApp | null>}
 */
async function boot() {
  if (globalThis[BOOT_FLAG]) {
    log.warn('多重初期化を検出したため、2回目以降の起動を無視しました。');
    return null;
  }
  globalThis[BOOT_FLAG] = true;

  const app = new GameApp();
  try {
    await whenDomReady();
    await app.start();
  } catch (error) {
    // start() 内で捕捉できない例外（DOM待機の失敗など）の最終防衛線
    log.error('起動処理で致命的なエラーが発生しました:', error);
    app.errors.report('致命的なエラー', error);
  }
  return app;
}

boot();

export { GameApp, EventBus, SaveService, COMMANDS, boot };
