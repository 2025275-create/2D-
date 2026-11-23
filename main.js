import { Game } from './game.js';

function boot() {
  const canvas = document.getElementById('game');
  if (!canvas || !canvas.getContext) {
    document.body.textContent = 'Canvasに対応したブラウザで開いてください。';
    return;
  }
  const game = new Game(canvas);
  game.init();
  window.astralia = game; // デバッグ用（次工程以降で削除可）
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
