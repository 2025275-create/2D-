/**
 * HUD (src/game/ui/hud.js)
 *
 * 画面左上に Lv / HP / MP / スタミナを表示する。論理ピクセルで描画する。
 * ゲージの長さと数値は、同じフレームで同じ stats の値から計算するので常に一致する。
 * 右上や左下（ジョイスティック）には描かない。
 */

const FONT = '"Hiragino Sans", -apple-system, "Noto Sans JP", sans-serif';

const BARS = Object.freeze([
  { label: 'HP', value: 'hp', max: 'maxHp', color: '#e5566b', light: '#ff9aa9' },
  { label: 'MP', value: 'mp', max: 'maxMp', color: '#3f8fe8', light: '#8cc4ff' },
  { label: 'STA', value: 'stamina', max: 'maxStamina', color: '#6fcf62', light: '#b4efa8' },
]);

export class Hud {
  constructor() {
    this.insets = { top: 0, left: 0 };       // セーフエリア（論理 px）
    this.lines = ['', '', '', ''];           // 直近に描画した文字列（確認用）
    this.fills = [0, 0, 0];                  // 直近に描画したゲージ幅の割合（確認用）
  }

  setInsets(top, left) {
    this.insets.top = top;
    this.insets.left = left;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} viewWidth 論理幅
   * @param {{level:number,hp:number,maxHp:number,mp:number,maxMp:number,stamina:number,maxStamina:number}} stats
   */
  render(ctx, viewWidth, stats) {
    const x = Math.round(this.insets.left + 6);
    const y = Math.round(this.insets.top + 6);
    const width = Math.round(Math.min(150, viewWidth * 0.46));
    const pad = 4;
    const barW = width - pad * 2;
    const barH = 11;
    const gap = 3;
    const height = pad * 2 + 12 + BARS.length * (barH + gap) - gap + 2;

    ctx.fillStyle = 'rgba(5, 9, 20, 0.6)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(201, 211, 227, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${FONT}`;
    ctx.fillStyle = '#e8c872';
    this.lines[0] = `Lv.${stats.level}`;
    ctx.fillText(this.lines[0], x + pad, y + pad + 6);

    ctx.font = `9px ${FONT}`;
    BARS.forEach((bar, i) => {
      const by = y + pad + 14 + i * (barH + gap);
      const max = stats[bar.max];
      const value = Math.max(0, Math.min(max, stats[bar.value]));
      const ratio = max > 0 ? value / max : 0;
      const fillW = Math.round(barW * ratio);

      ctx.fillStyle = '#0b1228';
      ctx.fillRect(x + pad, by, barW, barH);
      ctx.fillStyle = bar.color;
      ctx.fillRect(x + pad, by, fillW, barH);
      ctx.fillStyle = bar.light;
      ctx.fillRect(x + pad, by, fillW, 2);
      ctx.strokeStyle = 'rgba(141, 154, 179, 0.9)';
      ctx.strokeRect(x + pad + 0.5, by + 0.5, barW - 1, barH - 1);

      const text = `${bar.label} ${Math.round(value)} / ${max}`;
      this.lines[i + 1] = text;
      this.fills[i] = ratio;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x + pad + 3, by + barH / 2 + 0.5);
    });
  }
}
