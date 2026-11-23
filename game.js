import { GameLoop } from './gameLoop.js';

const VW = 1280, VH = 720;            // 仮想解像度（16:9）。実画面へレターボックスで拡縮
const SAVE_KEY = 'astralia.save.v1';
const SETTINGS_KEY = 'astralia.settings.v1';
const C = { bg0: '#070b1c', bg1: '#141b3d', ring: '#e8c872', mist: '#b9d9ea', dim: '#5b6585' };
const FONT = '"Hiragino Mincho ProN","Hiragino Mincho Pro","Yu Mincho","Times New Roman",serif';

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode 等 */ } },
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.w = 0; this.h = 0; this.dpr = 1;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.scene = 'title';            // 'title' | 'play' | 'settings'
    this.buttons = [];
    this.time = 0;
    this.spin = 0;                   // dt依存性確認用（毎秒90度）
    this.settings = { showFps: false, ...JSON.parse(storage.get(SETTINGS_KEY) || '{}') };
    if (new URLSearchParams(location.search).has('debug')) this.settings.showFps = true;
    this.hasSave = !!storage.get(SAVE_KEY);
    this.stars = Array.from({ length: 90 }, (_, i) => ({
      x: ((i * 7919) % 1000) / 1000, y: ((i * 104729) % 1000) / 1000,
      r: 0.5 + ((i * 31) % 10) / 8, s: 4 + ((i * 17) % 10),
    }));
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: () => this.render() });
  }

  init() {
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    if (window.visualViewport) visualViewport.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
    // iOS Safari: ピンチ・ダブルタップズーム・スクロールを抑止
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(t, (e) => e.preventDefault());
    }
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'p') this.loop.togglePause(); });
    this.loop.start();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.scale = Math.min(this.w / VW, this.h / VH);
    this.ox = (this.w - VW * this.scale) / 2;
    this.oy = (this.h - VH * this.scale) / 2;
  }

  get portrait() { return this.h > this.w; }

  // ---- 入力 ----
  onPointer(e) {
    e.preventDefault();
    if (this.loop.userPaused) { this.loop.resume(); return; }
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - this.ox) / this.scale;
    const y = (e.clientY - r.top - this.oy) / this.scale;
    for (const b of this.buttons) {
      if (!b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.action(); return; }
    }
  }

  go(scene) { this.scene = scene; }
  startNew() { this.spin = 0; this.go('play'); }
  continueGame() { this.go('play'); } // 次工程以降でセーブ読込を実装
  toggleFps() {
    this.settings.showFps = !this.settings.showFps;
    storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  // ---- 更新（固定dt） ----
  update(dt) {
    this.time += dt;
    this.spin = (this.spin + 90 * dt) % 360;
  }

  // ---- 描画 ----
  render() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(g);
    if (this.portrait) { this.drawRotateHint(g); this.drawHud(g); return; }

    g.save();
    g.translate(this.ox, this.oy);
    g.scale(this.scale, this.scale);
    this.buttons = [];
    if (this.scene === 'title') this.drawTitle(g);
    else if (this.scene === 'settings') this.drawSettings(g);
    else this.drawPlay(g);
    g.restore();

    if (this.loop.userPaused) this.drawPause(g);
    this.drawHud(g);
  }

  drawBackground(g) {
    const grad = g.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, C.bg1); grad.addColorStop(1, C.bg0);
    g.fillStyle = grad; g.fillRect(0, 0, this.w, this.h);
    g.fillStyle = C.mist;
    for (const s of this.stars) {
      const x = (s.x * this.w + this.time * s.s) % this.w;
      g.globalAlpha = 0.35 + 0.35 * Math.sin(this.time * 0.8 + s.x * 40);
      g.beginPath(); g.arc(x, s.y * this.h, s.r, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1;
  }

  drawRing(g, cx, cy, rx, ry, rot, width) {
    g.save();
    g.translate(cx, cy); g.rotate(rot);
    g.strokeStyle = C.ring; g.lineWidth = width;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.stroke();
    g.restore();
  }

  drawTitle(g) {
    // 天環：ゆっくり傾いて回る金の環
    g.globalAlpha = 0.9;
    this.drawRing(g, VW / 2, 250, 330, 78, -0.22, 2);
    g.globalAlpha = 0.35;
    this.drawRing(g, VW / 2, 250, 390, 96, -0.22, 1);
    g.globalAlpha = 1;

    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C.ring;
    g.font = `600 112px ${FONT}`;
    if ('letterSpacing' in g) g.letterSpacing = '18px';
    g.fillText('ASTRALIA', VW / 2 + 9, 250);
    if ('letterSpacing' in g) g.letterSpacing = '12px';
    g.fillStyle = C.mist;
    g.font = `400 30px ${FONT}`;
    g.fillText('― 天環の彼方 ―', VW / 2 + 6, 340);
    if ('letterSpacing' in g) g.letterSpacing = '0px';

    const bw = 340, bh = 62, bx = (VW - bw) / 2;
    this.button(g, 'GAME START', bx, 420, bw, bh, () => this.startNew());
    this.button(g, 'CONTINUE', bx, 496, bw, bh, () => this.continueGame(), !this.hasSave);
    this.button(g, 'SETTINGS', bx, 572, bw, bh, () => this.go('settings'));
  }

  drawSettings(g) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C.ring; g.font = `600 48px ${FONT}`;
    g.fillText('SETTINGS', VW / 2, 150);
    this.button(g, `FPS表示：${this.settings.showFps ? 'ON' : 'OFF'}`, (VW - 420) / 2, 280, 420, 62, () => this.toggleFps());
    g.fillStyle = C.dim; g.font = `400 22px ${FONT}`;
    g.fillText('音量・操作設定などは今後の工程で追加します', VW / 2, 400);
    this.button(g, 'BACK', (VW - 260) / 2, 560, 260, 62, () => this.go('title'));
  }

  drawPlay(g) {
    // 基盤確認用の仮画面（戦闘・マップ等は未実装）
    this.drawRing(g, VW / 2, VH / 2, 200, 200, 0, 1);
    const a = this.spin * Math.PI / 180;
    g.fillStyle = C.ring;
    g.beginPath(); g.arc(VW / 2 + Math.cos(a) * 200, VH / 2 + Math.sin(a) * 200, 12, 0, 6.2832); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C.mist; g.font = `400 30px ${FONT}`;
    g.fillText('基盤構築完了 ― ここから物語が始まります', VW / 2, VH / 2 - 8);
    g.fillStyle = C.dim; g.font = `400 20px ${FONT}`;
    g.fillText('光点は毎秒90度で周回（FPSに依存しません）', VW / 2, VH / 2 + 32);
    this.button(g, 'PAUSE', VW - 220, 40, 160, 54, () => this.loop.pause());
    this.button(g, 'TITLE', 60, 40, 160, 54, () => { this.hasSave = !!storage.get(SAVE_KEY); this.go('title'); });
  }

  button(g, label, x, y, w, h, action, disabled = false) {
    this.buttons.push({ x, y, w, h, action, disabled });
    g.save();
    g.globalAlpha = disabled ? 0.35 : 1;
    g.fillStyle = 'rgba(20,27,61,0.75)'; g.fillRect(x, y, w, h);
    g.strokeStyle = disabled ? C.dim : C.ring; g.lineWidth = 1.5; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
    g.fillStyle = disabled ? C.dim : C.mist;
    g.font = `500 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = '4px';
    g.fillText(label, x + w / 2 + 2, y + h / 2 + 1);
    g.restore();
  }

  drawPause(g) {
    g.fillStyle = 'rgba(7,11,28,0.7)'; g.fillRect(0, 0, this.w, this.h);
    g.fillStyle = C.ring; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 44px ${FONT}`; g.fillText('PAUSE', this.w / 2, this.h / 2 - 16);
    g.fillStyle = C.mist; g.font = `400 22px ${FONT}`; g.fillText('タップで再開', this.w / 2, this.h / 2 + 30);
  }

  drawRotateHint(g) {
    g.fillStyle = C.ring; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 28px ${FONT}`; g.fillText('端末を横向きにしてください', this.w / 2, this.h / 2);
  }

  drawHud(g) {
    if (!this.settings.showFps) return;
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(8, 8, 190, 26);
    g.fillStyle = '#9dffb0'; g.font = '14px monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(`${this.loop.fps.toFixed(1)} FPS  ${this.loop.frameMs.toFixed(1)}ms`, 16, 21);
  }
}
