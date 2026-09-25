// Desenho da legenda num canvas. O MESMO código é usado no preview e no MP4 exportado,
// então o que você vê é exatamente o que sai no vídeo.
import { renderText } from './core.js';

const fontCss = (st, px) => `${st.weight} ${px}px "${st.font}", "Helvetica Neue", Arial, sans-serif`;

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Quebra cada linha explícita para caber em maxWidth. */
function layoutLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ').filter(Boolean);
    if (!words.length) continue;
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const probe = `${line} ${words[i]}`;
      if (ctx.measureText(probe).width <= maxWidth) line = probe;
      else { out.push(line); line = words[i]; }
    }
    out.push(line);
  }
  return out;
}

/**
 * Desenha `text` com o estilo `st` num canvas de largura W e altura H.
 * Tamanhos do estilo estão em px numa altura de referência de 1080.
 */
export function drawCaption(ctx, W, H, text, st) {
  const content = renderText(text, st).trim();
  if (!content) return;
  const scale = H / 1080;
  const px = Math.max(4, st.size * scale);
  ctx.save();
  ctx.font = fontCss(st, px);
  // Espaço entre letras. O Chrome soma o espaço DEPOIS da última letra também, então
  // measureText devolve uma largura maior que a tinta e o texto centralizado sai
  // deslocado meio espaço para a esquerda — daí o `+ gap / 2` no desenho e o desconto
  // na largura da caixa.
  const gap = 'letterSpacing' in ctx ? ((st.tracking ?? 0) / 100) * px : 0;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${gap.toFixed(2)}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const cx = ((st.posX ?? 50) / 100) * W;
  // fora do centro, a largura da quebra encolhe para o texto não sair do quadro
  const maxW = Math.max(W * 0.3, Math.min(W * 0.9, 2 * Math.min(cx, W - cx)));
  const lines = layoutLines(ctx, content, maxW);
  const lineH = px * (st.lineHeight ?? 1.18);
  const cy = (st.posY / 100) * H;
  const top = cy - (lineH * lines.length) / 2 + lineH / 2;

  const drawX = cx + gap / 2;
  if (st.box) {
    const padX = px * 0.45, padY = px * 0.22;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width)) - gap;
    const bw = widest + padX * 2;
    const bh = lineH * lines.length + padY * 2;
    const r = Math.min(px * 0.3, bh / 2);
    ctx.fillStyle = hexToRgba(st.boxColor, st.boxOpacity);
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, r);
    ctx.fill();
  }

  lines.forEach((line, i) => {
    const y = top + i * lineH;
    if (st.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = px * 0.18;
      ctx.shadowOffsetY = px * 0.06;
    }
    if (st.stroke && st.strokeWidth > 0) {
      ctx.strokeStyle = st.strokeColor;
      ctx.lineWidth = st.strokeWidth * 2 * scale; // traço centrado no contorno: metade fica por fora
      ctx.strokeText(line, drawX, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = st.color;
    ctx.fillText(line, drawX, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
}
