/**
 * プレイヤーの仮スプライト (src/game/entities/playerSprite.js)
 *
 * fillRect だけで描くドット絵の仮素材。draw(ctx, player, sx, sy) の形を保てば、
 * スプライトシート + 4 方向アニメーションの実装に丸ごと差し替えられる。
 * (sx, sy) は足元中心の画面座標。
 */

const C = Object.freeze({
  skin: '#f3d3b0', hair: '#e4ecf8', tunic: '#2f4fa0', trim: '#c9d3e3', gold: '#d6b25e',
  pants: '#27325c', boot: '#151b33', cape: '#3a56a8', eye: '#2a3b7a', shadow: 'rgba(0,0,0,0.3)',
});

export class PlayerSprite {
  draw(ctx, player, sx, sy) {
    const R = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(sx + x, sy + y, w, h); };
    const step = player.moving ? Math.floor(player.walkTime / 7) % 4 : 0; // 0〜3
    const b = step === 1 || step === 3 ? -1 : 0;   // 上下の揺れ
    const lift1 = step === 1 ? 2 : 0;
    const lift2 = step === 3 ? 2 : 0;
    const f = player.facing;

    R(C.shadow, -7, -3, 14, 4);

    if (f === 'left' || f === 'right') {
      const s = f === 'right' ? 1 : -1;
      const X = (x, w) => (s > 0 ? x : -x - w); // 左右反転
      R(C.cape, X(-6, 4), -19 + b, 4, 13);                       // 背中のマント
      R(C.pants, X(-3, 3), -8, 3, 8 - lift1);                    // 奥の脚
      R(C.pants, X(0, 3), -8, 3, 8 - lift2);                     // 手前の脚
      R(C.boot, X(-3, 3), -2 - lift1, 3, 2);
      R(C.boot, X(0, 4), -2 - lift2, 4, 2);
      R(C.tunic, X(-4, 9), -19 + b, 9, 11);
      R(C.trim, X(-4, 9), -19 + b, 9, 1);
      R(C.gold, X(-4, 9), -11 + b, 9, 2);
      R(C.tunic, X(-1, 3), -18 + b, 3, 8);                       // 腕
      R(C.skin, X(-1, 3), -10 + b + (step === 1 ? 1 : step === 3 ? -1 : 0), 3, 2);
      R(C.skin, X(-4, 9), -28 + b, 9, 9);                        // 頭
      R(C.hair, X(-5, 11), -30 + b, 11, 5);
      R(C.hair, X(-5, 4), -26 + b, 4, 8);
      R(C.eye, X(2, 2), -24 + b, 2, 2);
    } else {
      const back = f === 'up';
      const swing = step === 1 ? 1 : step === 3 ? -1 : 0;
      R(C.pants, -5, -8, 4, 8 - lift1);
      R(C.pants, 1, -8, 4, 8 - lift2);
      R(C.boot, -5, -2 - lift1, 4, 2);
      R(C.boot, 1, -2 - lift2, 4, 2);
      if (back) {
        R(C.cape, -7, -19 + b, 14, 14);
        R(C.gold, -7, -6 + b, 14, 1);
      } else {
        R(C.tunic, -6, -19 + b, 12, 11);
        R(C.trim, -6, -19 + b, 12, 1);
        R(C.trim, -1, -19 + b, 2, 11);
        R(C.gold, -6, -11 + b, 12, 2);
      }
      R(C.tunic, -8, -18 + b + swing, 2, 8);
      R(C.tunic, 6, -18 + b - swing, 2, 8);
      R(C.skin, -8, -10 + b + swing, 2, 2);
      R(C.skin, 6, -10 + b - swing, 2, 2);
      R(C.skin, -5, -28 + b, 10, 9);                             // 頭
      if (back) {
        R(C.hair, -6, -30 + b, 12, 11);
      } else {
        R(C.hair, -6, -30 + b, 12, 5);
        R(C.hair, -6, -26 + b, 2, 5);
        R(C.hair, 4, -26 + b, 2, 5);
        R(C.eye, -3, -24 + b, 2, 2);
        R(C.eye, 1, -24 + b, 2, 2);
      }
    }
  }
}
