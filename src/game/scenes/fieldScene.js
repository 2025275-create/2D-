/**
 * フィールドシーン (src/game/scenes/fieldScene.js)
 *
 * 既存の SceneManager のシーンとして動く（game.js の PLAY に登録）。独自のループや
 * 画面遷移は持たない。update / render は Game の固定ステップループから呼ばれる。
 *
 * 右手の戦闘操作（攻撃・回避・スキル）は combat（入力ロジック）と combatUi（ボタン）。
 * 発行されるイベントは onActionPress に渡る（効果の処理は未実装。戦闘システムがここへ接続する）。
 *
 * 将来の敵・NPC は this.entities（sortY と draw を持つ物）へ追加し、update に処理を足す。
 * ミニマップ・エリア移動は map / camera を差し替えて対応する。
 */

import { createAsteriaMap } from '../map/asteriaMap.js';
import { MapRenderer } from '../map/mapRenderer.js';
import { CollisionGrid } from '../world/collision.js';
import { Player } from '../entities/player.js';
import { PlayerSprite } from '../entities/playerSprite.js';
import { InputManager } from '../input/inputManager.js';
import { CombatInput } from '../combat/combatInput.js';
import { CombatUi } from '../ui/combatButtons.js';
import { Camera } from '../camera.js';
import { Hud } from '../ui/hud.js';

const BACK_BUTTON = Object.freeze({ w: 92, h: 28, margin: 8 });

export class FieldScene {
  /**
   * @param {import('../../core/game.js').Game} game
   * @param {{tileSize?: number, titleScene?: string}} [options]
   */
  constructor(game, { tileSize = 32, titleScene = 'title' } = {}) {
    this.game = game;
    this.tileSize = tileSize;
    this.titleScene = titleScene;
    this.ownsCanvas = true;

    this.map = null;
    this.renderer = null;
    this.collision = null;
    this.player = null;
    this.playerSprite = new PlayerSprite();
    this.input = null;
    this.combat = null;
    this.combatUi = null;
    this.camera = null;
    this.hud = new Hud();
    this.entities = [];
    this.move = { dir: -1, x: 0, y: 0, strength: 0 };
    this.time = 0;
    this.insetProbe = null;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.disposers = [];
    this.leaving = false;

    // 右半分の入力フック
    this.onActionPress = null;

    // プレイヤーを Y ソートの対象にするための描画ハンドル
    const self = this;
    this.playerEntity = {
      get sortY() { return self.player.sortY; },
      draw(ctx, ox, oy) {
        self.playerSprite.draw(
          ctx,
          self.player,
          Math.round(self.player.x) - ox,
          Math.round(self.player.y) - oy
        );
      },
    };
  }

  enter() {
    // シーン再入場時に前回の退出状態を解除
    this.leaving = false;

    const game = this.game;
    game.setStageScene('play');
    game.setUiVisible(false);

    this.map = createAsteriaMap(this.tileSize);
    this.renderer = new MapRenderer(this.map);
    this.collision = new CollisionGrid(
      this.map.cols,
      this.map.rows,
      this.map.tileSize,
      this.map.colliders
    );
    this.player = new Player({
      x: this.map.spawn.x,
      y: this.map.spawn.y,
    });
    this.camera = new Camera({
      mapWidth: this.map.width,
      mapHeight: this.map.height,
    });
    this.entities = [this.playerEntity];

    const host = game.stage || document.body;
    this.input = new InputManager({ host });
    // 回避中かどうかの判定元は Player。回避中の攻撃・回避入力は CombatInput 側で受け付けない
    // （コンボ番号を進めず、イベントも出さない）。
    this.combat = new CombatInput({
      canAttack: () => !this.player || !this.player.dodging,
      canDodge: () => !this.player || !this.player.dodging,
    });
    this.combat.on('*', (event) => {
      // Player の攻撃・回避へ接続（先に処理し、その後で従来どおり onActionPress へ転送する）
      this.routeCombatEvent(event);

      if (typeof this.onActionPress === 'function') {
        this.onActionPress(event);
      }
    });
    this.combatUi = new CombatUi({
      host,
      combat: this.combat,
    });
    this.createInsetProbe(host);

    const reset = () => {
      if (this.input) this.input.reset();
      if (this.combatUi) this.combatUi.releaseAll();
    };
    const onVisibility = () => {
      if (document.hidden) reset();
    };

    this.listen(document, 'visibilitychange', onVisibility);
    this.listen(window, 'blur', reset);
    this.listen(window, 'pagehide', reset);

    this.applyViewport(game.viewport);
    this.camera.snapTo(this.player.x, this.player.y);
  }

  exit() {
    if (this.input) this.input.reset();
    if (this.combatUi) this.combatUi.releaseAll();
  }

  dispose() {
    for (const off of this.disposers) off();
    this.disposers = [];

    if (this.combatUi) this.combatUi.dispose();
    this.combatUi = null;
    this.combat = null;

    if (this.input) this.input.dispose();
    this.input = null;

    if (this.insetProbe && this.insetProbe.parentNode) {
      this.insetProbe.parentNode.removeChild(this.insetProbe);
    }
    this.insetProbe = null;

    if (this.renderer) this.renderer.dispose();
    this.renderer = null;
    this.map = null;
    this.collision = null;
    this.entities = [];
  }

  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.disposers.push(() => target.removeEventListener(type, handler));
  }

  /* ---------- セーフエリア ---------- */

  createInsetProbe(host) {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) '
      + 'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    host.appendChild(probe);
    this.insetProbe = probe;
  }

  /** セーフエリアを CSS px → 論理 px に換算して HUD などの配置に使う。 */
  readInsets(vp) {
    if (!this.insetProbe) return;

    const style = getComputedStyle(this.insetProbe);
    const toLogical = (v) => ((parseFloat(v) || 0) * vp.dpr) / vp.scale;

    this.insets.top = toLogical(style.paddingTop);
    this.insets.right = toLogical(style.paddingRight);
    this.insets.bottom = toLogical(style.paddingBottom);
    this.insets.left = toLogical(style.paddingLeft);

    this.hud.setInsets(this.insets.top, this.insets.left);
  }

  /* ---------- Game から呼ばれるフック ---------- */

  resize(vp) {
    this.applyViewport(vp);
  }

  applyViewport(vp) {
    if (!this.camera) return;

    this.camera.setViewport(vp.width, vp.height);
    this.readInsets(vp);

    if (this.combatUi) this.combatUi.layout();
  }

  update(dt) {
    if (!this.player || this.leaving) return;

    this.time += dt;
    this.combat.update(dt);
    this.combatUi.update(dt);

    this.input.getMove(this.move);
    this.player.update(
      dt,
      this.move,
      this.collision,
      this.map.width,
      this.map.height
    );
    this.camera.follow(this.player.x, this.player.y, dt);
  }

  render(ctx) {
    if (!this.renderer) return;

    const vp = this.game.viewport;
    const w = vp.width;
    const h = vp.height;
    const ox = this.camera.renderX;
    const oy = this.camera.renderY;

    ctx.imageSmoothingEnabled = false;

    this.renderer.drawGround(ctx, ox, oy, w, h);

    if (this.entities.length > 1) {
      this.entities.sort((a, b) => a.sortY - b.sortY);
    }

    this.renderer.drawWorld(
      ctx,
      ox,
      oy,
      w,
      h,
      this.time,
      this.entities
    );

    this.hud.render(ctx, w, this.player.stats);
    this.renderOverlay(ctx, w);
  }

  /** 右上：タイトルへ戻るボタンと FPS。 */
  renderOverlay(ctx, w) {
    const b = this.backRect(w);

    ctx.fillStyle = 'rgba(5, 9, 20, 0.6)';
    ctx.fillRect(b.x, b.y, b.w, b.h);

    ctx.strokeStyle = '#c9d3e3';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      b.x + 0.5,
      b.y + 0.5,
      b.w - 1,
      b.h - 1
    );

    ctx.font = '10px "Hiragino Sans", -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2f6fc';
    ctx.fillText(
      '◀ タイトル',
      b.x + b.w / 2,
      b.y + b.h / 2 + 1
    );

    const loop = this.game.loop;
    const fps = loop && typeof loop.fps === 'number' ? loop.fps : 0;

    ctx.textAlign = 'right';
    ctx.fillStyle = '#9dffb0';
    ctx.fillText(
      `${fps.toFixed(0)} FPS`,
      b.x + b.w,
      b.y + b.h + 10
    );
  }

  backRect(viewWidth) {
    const { w, h, margin } = BACK_BUTTON;

    return {
      x: Math.round(viewWidth - this.insets.right - margin - w),
      y: Math.round(this.insets.top + margin),
      w,
      h,
    };
  }

  /** スキルデータ（外部から）を渡す。pages: ページごとに最大 4 つのスキル ID（未設定は null）。 */
  setSkillPages(pages) {
    if (!this.combat) return;

    this.combat.setSkillPages(pages);

    if (this.combatUi) {
      this.combatUi.renderLabels();
    }
  }

  /**
   * CombatInput のイベントを Player の攻撃・回避処理へ渡す。
   *   attack: { type: 'attack', combo, comboMax, continued }  -> player.startAttack(event)
   *   dodge : { type: 'dodge', invulnerableSeconds, canceledCombo } -> player.startDodge(event)
   * スキル・ポインター等のイベントは何もしない（onActionPress への転送だけ）。
   * Player 側のメソッドが無い間は何も呼ばない（例外にしない）。
   */
  routeCombatEvent(event) {
    if (!event || typeof event !== 'object') return;

    const player = this.player;
    if (!player) return;

    try {
      if (event.type === 'attack' && typeof player.startAttack === 'function') {
        player.startAttack(event);
      } else if (event.type === 'dodge' && typeof player.startDodge === 'function') {
        player.startDodge(event);
      }
    } catch (error) {
      // Player 側の例外で、onActionPress への転送や他の入力を止めない
      console.error('[ASTRALIA:field] 戦闘イベントの処理でエラー:', error);
    }
  }

  goTitle() {
    if (this.leaving) return undefined;

    this.leaving = true;
    return this.game.changeScene(this.titleScene);
  }

  /**
   * Canvas へ届くタッチ＝右半分のうち、戦闘ボタン以外の場所
   * （左半分は移動ジョイスティックの領域が受ける）。
   * 戻るボタン以外は onActionPress へ
   * { type: 'pointer', x, y, pointerId } として渡す。
   */
  onPointerDown({ x, y, event }) {
    const b = this.backRect(this.game.viewport.width);

    if (
      x >= b.x &&
      x <= b.x + b.w &&
      y >= b.y &&
      y <= b.y + b.h
    ) {
      this.goTitle();
      return;
    }

    if (typeof this.onActionPress === 'function') {
      this.onActionPress({
        type: 'pointer',
        x,
        y,
        pointerId: event ? event.pointerId : null,
      });
    }
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      this.goTitle();
    }
  }
}
