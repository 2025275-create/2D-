/**
 * GameLoop: requestAnimationFrame + 固定タイムステップ。
 * - update は常に step 秒（既定 1/60）刻みで呼ばれ、端末の FPS に依存しない
 * - フレーム落ち時は accumulator で追従（maxDelta / maxSteps で暴走防止）
 * - 手動ポーズ / タブ非表示時は update 停止、非表示中は rAF 自体を止めて負荷ゼロ
 */
export class GameLoop {
  constructor({ update, render, step = 1 / 60, maxDelta = 0.25, maxSteps = 5 }) {
    this.update = update;
    this.render = render;
    this.step = step;
    this.maxDelta = maxDelta;
    this.maxSteps = maxSteps;
    this.userPaused = false;
    this.hidden = false;
    this.fps = 0;
    this.frameMs = 0;
    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this._running = false;
    this._tick = this._tick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  get paused() { return this.userPaused || this.hidden; }

  start() {
    if (this._running) return;
    this._running = true;
    document.addEventListener('visibilitychange', this._onVisibility);
    this.hidden = document.hidden;
    if (!this.hidden) this._schedule();
  }

  stop() {
    this._running = false;
    document.removeEventListener('visibilitychange', this._onVisibility);
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  pause() { this.userPaused = true; }
  resume() { this.userPaused = false; this._resetClock(); }
  togglePause() { this.userPaused ? this.resume() : this.pause(); }

  _schedule() {
    this._resetClock();
    this._raf = requestAnimationFrame(this._tick);
  }

  _resetClock() {
    this._last = 0;      // 次フレームで基準時刻を取り直す（復帰時のdelta爆発を防止）
    this._acc = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;
  }

  _onVisibility() {
    if (!this._running) return;
    if (document.hidden) {
      this.hidden = true;
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    } else {
      this.hidden = false;
      if (!this._raf) this._schedule();
    }
  }

  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);
    if (!this._last) { this._last = now; return; }

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt < 0) dt = 0;
    this.frameMs = dt * 1000;

    // FPS計測（0.5秒ごと）
    this._fpsFrames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = this._fpsFrames / this._fpsTime;
      this._fpsFrames = 0;
      this._fpsTime = 0;
    }

    if (dt > this.maxDelta) dt = this.maxDelta; // 長時間停止の補正

    if (!this.userPaused) {
      this._acc += dt;
      let steps = 0;
      while (this._acc >= this.step && steps < this.maxSteps) {
        this.update(this.step);
        this._acc -= this.step;
        steps++;
      }
      if (steps === this.maxSteps) this._acc = 0; // 追従不能なら遅延を捨てる
    }
    this.render(this._acc / this.step, dt);
  }
}
