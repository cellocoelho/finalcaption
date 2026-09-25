// Hooks: uma frase em destaque que substitui as legendas de um trecho, com layout
// tipográfico próprio, animação de entrada e a lente de deformação (bulge).
//
// O MESMO desenho serve à prévia e ao MP4, como em render.js — o que você vê é o que sai.

export const HOOK_LAYOUTS = [
  ['manchete', 'Manchete'], ['mistura', 'Mistura'], ['serif', 'Serifa solta'],
  ['grifo', 'Grifo'], ['elegante', 'Elegante'], ['condensada', 'Condensada'], ['bojo', 'Bojo'],
];

export const HOOK_ANIMS = [
  ['pop', 'Pop'], ['subir', 'Subir'], ['karaoke', 'Destaque'],
  ['troca', 'Uma por vez'], ['zoom', 'Zoom'], ['maquina', 'Máquina'],
];

export const HOOK_COLORS = ['#E8441F', '#FFD60A', '#C9F24D', '#FFFFFF', '#0A84FF'];

const COND = 'Helvetica Neue Condensed Bold, Arial Narrow';
const CLARO = '#F2EEE4';
/** As fontes são guardadas pelo nome, igual à aba Estilo. */
const pilha = (nome) => `"${nome}", "Helvetica Neue", Arial, sans-serif`;

export const DEFAULT_HOOK = Object.freeze({
  layout: 'condensada',
  anim: 'pop',
  color: '#E8441F',
  fontA: 'Helvetica Neue',
  fontB: 'Didot',
  bulge: 0,          // força da lente
  lens: 0.32,        // largura do sino da lente
  speed: 1,          // multiplica a duração da animação
  marks: [],         // índices das palavras em destaque
  tweaks: {},        // ajustes por palavra: { fam, peso, ital, cor, grifo, escala, dx, dy }
});

export const hookAt = (hooks, t) => hooks.find((h) => t >= h.start && t < h.end) || null;
export const wordsOf = (hook) => hook.text.split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------- layouts

const naipe = (ws, n) => { const o = []; for (let i = 0; i < ws.length; i += n) o.push(ws.slice(i, i + n)); return o; };

function montaLinhas(hook) {
  const ws = wordsOf(hook);
  const marcada = (i) => (hook.marks.length ? hook.marks.includes(i) : false);
  const A = hook.fontA, B = hook.fontB, cor = hook.color;
  const condensada = A === DEFAULT_HOOK.fontA ? COND : A;   // só troca por condensada se estiver no padrão

  switch (hook.layout) {
    case 'manchete':
      return naipe(ws, 2).map((g, li) => ({
        align: li % 2 ? 'dir' : 'esq', escala: 1,
        runs: g.map((t, k) => ({ txt: t, fam: A, peso: 700, ital: false, cor: CLARO, i: li * 2 + k })),
      }));
    case 'mistura':
      return naipe(ws, 3).map((g, li) => {
        const forte = li % 2 === 0;
        return { align: 'centro', escala: forte ? 1.25 : 0.82,
          runs: g.map((t, k) => {
            const i = li * 3 + k;
            return forte
              ? { txt: t.toUpperCase(), fam: condensada, peso: 800, ital: false, cor, i }
              : { txt: t, fam: B, peso: 400, ital: true, cor: CLARO, i };
          }) };
      });
    case 'serif':
      return naipe(ws, 2).map((g, li) => {
        const serifa = li % 2 === 1;
        return { align: 'centro', escala: serifa ? 1.5 : 0.8,
          runs: g.map((t, k) => {
            const i = li * 2 + k;
            return serifa
              ? { txt: t, fam: B, peso: 400, ital: true, cor: marcada(i) ? cor : CLARO, i }
              : { txt: t, fam: A, peso: 800, ital: false, cor: marcada(i) ? cor : CLARO, i };
          }) };
      });
    case 'grifo':
      return naipe(ws, 3).map((g, li) => ({
        align: 'centro', escala: 1,
        runs: g.map((t, k) => {
          const i = li * 3 + k;
          const on = hook.marks.length ? hook.marks.includes(i) : i === ws.length - 1;
          return { txt: t, fam: A, peso: 800, ital: false, cor: on ? '#141414' : CLARO, grifo: on ? cor : null, i };
        }),
      }));
    case 'elegante':
      return naipe(ws, 2).map((g, li) => ({
        align: 'centro', escala: li === 0 ? 1.4 : 0.9,
        runs: g.map((t, k) => {
          const i = li * 2 + k;
          const serifa = hook.marks.length ? hook.marks.includes(i) : li === 0;
          const curta = t.length <= 4 && li > 0;
          return { txt: t, fam: serifa ? B : A, peso: serifa ? 400 : 800, ital: serifa,
            cor: CLARO, pilula: curta ? cor : null, i };
        }),
      }));
    case 'bojo':
      return naipe(ws, 3).map((g, li) => ({
        align: 'centro', escala: li === 1 ? 1.15 : 0.95,
        runs: g.map((t, k) => ({ txt: t, fam: B, peso: 700, ital: true, cor, i: li * 3 + k })),
      }));
    default: {  // condensada
      const linhas = naipe(ws, 3);
      return linhas.map((g, li) => ({
        align: 'centro', escala: li === linhas.length - 1 ? 1.3 : 1,
        runs: g.map((t, k) => {
          const i = li * 3 + k;
          const ultima = li === linhas.length - 1;
          const on = hook.marks.length ? hook.marks.includes(i) : ultima;
          return ultima && on
            ? { txt: t, fam: B, peso: 400, ital: true, cor, i }
            : { txt: t.toUpperCase(), fam: condensada, peso: 800, ital: false, cor: on ? cor : CLARO, i };
        }),
      }));
    }
  }
}

// ---------------------------------------------------------------- medir e posicionar

const fonteCss = (r, px) => `${r.ital ? 'italic ' : ''}${r.peso} ${px}px ${pilha(r.fam)}`;

function comAjuste(r, hook) {
  const a = hook.tweaks[r.i];
  if (!a) return { ...r, escalaP: 1, dx: 0, dy: 0 };
  return { ...r,
    fam: a.fam || r.fam,
    peso: a.peso ?? r.peso,
    ital: a.ital ?? r.ital,
    cor: a.cor || r.cor,
    grifo: a.grifo === true ? (a.cor || hook.color) : (a.grifo === false ? null : r.grifo),
    escalaP: a.escala ?? 1, dx: a.dx || 0, dy: a.dy || 0 };
}

function posiciona(ctx, W, H, linhas, hook, escalaGeral) {
  const rel = linhas.map((l) => l.escala * 1.12 * Math.max(1, ...l.runs.map((r) => (hook.tweaks[r.i]?.escala ?? 1))));
  const somaRel = rel.reduce((a, b) => a + b, 0) || 1;
  const base = Math.min(W * 0.115, (H * 0.8) / somaRel) * escalaGeral;
  const larguraMax = W * 0.88 * escalaGeral;
  const margem = (W - larguraMax) / 2;
  const postas = [];
  const alturas = rel.map((r) => base * r);
  let y = H / 2 - alturas.reduce((a, b) => a + b, 0) / 2 + alturas[0] / 2;
  linhas.forEach((l, li) => {
    const runs = l.runs.map((r) => comAjuste(r, hook));
    const pxs = runs.map((r) => base * l.escala * r.escalaP);
    const esp = base * l.escala * 0.26;
    const larg = runs.map((r, k) => { ctx.font = fonteCss(r, pxs[k]); return ctx.measureText(r.txt).width; });
    const soma = larg.reduce((a, b) => a + b, 0) + esp * (runs.length - 1);
    const fator = soma > larguraMax ? larguraMax / soma : 1;
    const largf = larg.map((w) => w * fator);
    const somaf = soma * fator;
    let x = l.align === 'esq' ? margem + larguraMax * 0.02
      : l.align === 'dir' ? W - margem - larguraMax * 0.02 - somaf
      : W / 2 - somaf / 2;
    runs.forEach((r, k) => {
      postas.push({ ...r, x: x + largf[k] / 2 + r.dx * W * 0.01, y: y + r.dy * base * 0.1,
        px: pxs[k] * fator, w: largf[k] });
      x += largf[k] + esp * fator;
    });
    y += (alturas[li] + (alturas[li + 1] || 0)) / 2;
  });
  return postas;
}

// ---------------------------------------------------------------- lente (bulge)

/** Curva em sino: plana no miolo, caindo de leve para fora. A VARIAÇÃO é o que entorta. */
const encolhe = (rd, k, sig) => 1 / (1 + k * Math.exp(-(rd * rd) / (2 * sig * sig)));

/** Caminho inverso: para onde a lente empurra um ponto. */
function paraOnde(px, py, W, H, k, sig) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H);
  const dx = px - cx, dy = py - cy, d = Math.sqrt(dx * dx + dy * dy);
  const rs = d / R;
  if (d < 0.001) return [px, py];
  let lo = rs, hi = rs * (1 + k) + 0.01;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (m * encolhe(m, k, sig) < rs) lo = m; else hi = m;
  }
  return [cx + dx * (((lo + hi) / 2) / rs), cy + dy * (((lo + hi) / 2) / rs)];
}

/** Monta e encolhe até o texto caber no quadro mesmo depois de deformado. */
function posicionaCabendo(ctx, W, H, linhas, hook) {
  let escala = 1;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const postas = posiciona(ctx, W, H, linhas, hook, escala);
    if (!(hook.bulge > 0) || !postas.length) return postas;
    const cx = W / 2, cy = H / 2;
    let pior = 1;
    for (const p of postas) {
      const meio = p.px * 0.8, lado = p.w / 2 + p.px * 0.12;
      for (const qx of [p.x - lado, p.x, p.x + lado]) {
        for (const qy of [p.y - meio, p.y, p.y + meio]) {
          const [ax, ay] = paraOnde(qx, qy, W, H, hook.bulge, hook.lens);
          pior = Math.max(pior, Math.abs(ax - cx) / (W * 0.46), Math.abs(ay - cy) / (H * 0.46));
        }
      }
    }
    if (pior <= 1.01) return postas;
    escala /= pior;
  }
  return posiciona(ctx, W, H, linhas, hook, escala);
}

// ---------------------------------------------------------------- animações

const back = (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -9 * x));
const c01 = (x) => Math.max(0, Math.min(1, x));

const ANIMS = {
  pop: (n, i, t, d) => { const a = c01((t - i * (d * 0.6 / n)) / 0.22); return a <= 0 ? null : { a: 1, s: back(a) }; },
  subir: (n, i, t, d) => { const a = c01((t - i * (d * 0.6 / n)) / 0.24); return a <= 0 ? null : { a, s: 1, dy: (1 - expo(a)) * 0.5 }; },
  zoom: (n, i, t) => { const a = c01(t / 0.34); return { a: Math.min(1, a * 2.2), s: 2.3 - 1.3 * expo(a), global: true }; },
  karaoke: (n, i, t, d) => { const on = Math.floor(t / (d * 0.8 / n)) === i; return { a: on ? 1 : 0.42, s: on ? 1.06 : 1 }; },
  troca: (n, i, t, d) => {
    const passo = d * 0.9 / n;
    if (Math.floor(t / passo) !== i) return null;
    const l = (t - i * passo) / passo, e = expo(c01(l / 0.3)), s = l > 0.85 ? (l - 0.85) / 0.15 : 0;
    return { a: Math.min(e, 1 - s), s: 1, dy: (1 - e) * 0.4 - s * 0.4 };
  },
  maquina: (n, i, t, d) => { const a = c01((t - i * (d * 0.7 / n)) / 0.05); return a <= 0 ? null : { a: 1, s: 1, corte: a }; },
};

// ---------------------------------------------------------------- desenho

let fora = null, foraCtx = null, saida = null, saidaCtx = null;
const SS = 1.7;   // o texto é desenhado maior e depois amostrado: borda limpa

function telas() {
  if (!fora) {
    fora = document.createElement('canvas');
    foraCtx = fora.getContext('2d', { willReadFrequently: true });
    saida = document.createElement('canvas');
    saidaCtx = saida.getContext('2d');
  }
}

function aplicaLente(ctx, W, H, k, sig, caixa) {
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
  for (const px of [caixa.x0, (caixa.x0 + caixa.x1) / 2, caixa.x1]) {
    for (const py of [caixa.y0, (caixa.y0 + caixa.y1) / 2, caixa.y1]) {
      const [qx, qy] = paraOnde(px, py, W, H, k, sig);
      bx0 = Math.min(bx0, qx); bx1 = Math.max(bx1, qx);
      by0 = Math.min(by0, qy); by1 = Math.max(by1, qy);
    }
  }
  const x0 = Math.max(0, Math.floor(bx0 - 4)), y0 = Math.max(0, Math.floor(by0 - 4));
  const x1 = Math.min(W, Math.ceil(bx1 + 4)), y1 = Math.min(H, Math.ceil(by1 + 4));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  const SW = fora.width, SH = fora.height;
  const s = ctx.getImageData(0, 0, SW, SH).data;
  if (saida.width !== w || saida.height !== h) { saida.width = w; saida.height = h; }
  const img = saidaCtx.createImageData(w, h);
  const o = img.data;
  const cx = W / 2, cy = H / 2, R = Math.min(W, H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let fx = x, fy = y;
      if (dist > 0.001) { const f = encolhe(dist / R, k, sig); fx = cx + dx * f; fy = cy + dy * f; }
      fx *= SS; fy *= SS;
      const i = ((y - y0) * w + (x - x0)) * 4;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= SW - 1 || iy >= SH - 1) continue;
      const ax = fx - ix, ay = fy - iy;
      const p00 = (iy * SW + ix) * 4, p10 = p00 + 4, p01 = p00 + SW * 4, p11 = p01 + 4;
      for (let c = 0; c < 4; c++) {
        o[i + c] = s[p00 + c] * (1 - ax) * (1 - ay) + s[p10 + c] * ax * (1 - ay)
          + s[p01 + c] * (1 - ax) * ay + s[p11 + c] * ax * ay;
      }
    }
  }
  saidaCtx.putImageData(img, 0, 0);
  return { x0, y0, cv: saida };
}

/** Pinta as palavras e devolve a área ocupada. */
function pintaTexto(ctx, W, H, hook, t, dur) {
  const postas = posicionaCabendo(ctx, W, H, montaLinhas(hook), hook);
  if (!postas.length) return null;
  const n = postas.length;
  const fn = ANIMS[hook.anim] || ANIMS.pop;
  const geral = hook.anim === 'zoom' ? fn(n, 0, t, dur) : null;
  let x0 = W, y0 = H, x1 = 0, y1 = 0, achou = false;

  ctx.save();
  if (geral) { ctx.translate(W / 2, H / 2); ctx.scale(geral.s, geral.s); ctx.translate(-W / 2, -H / 2); ctx.globalAlpha = geral.a; }
  postas.forEach((p, i) => {
    const st = geral ? { a: 1, s: 1 } : fn(n, i, t, dur);
    if (!st) return;
    let txt = p.txt;
    if (st.corte != null) txt = p.txt.slice(0, Math.max(1, Math.ceil(p.txt.length * st.corte)));
    achou = true;
    const meio = p.px * (st.s || 1);
    x0 = Math.min(x0, p.x - p.w / 2 - meio); x1 = Math.max(x1, p.x + p.w / 2 + meio);
    y0 = Math.min(y0, p.y - meio); y1 = Math.max(y1, p.y + meio);
    ctx.save();
    ctx.globalAlpha = geral ? 1 : st.a;
    ctx.translate(p.x, p.y + (st.dy || 0) * p.px);
    ctx.scale(st.s, st.s);
    ctx.font = fonteCss(p, p.px);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (p.grifo) {
      ctx.fillStyle = p.grifo; ctx.beginPath();
      ctx.roundRect(-p.w / 2 - p.px * 0.12, -p.px * 0.52, p.w + p.px * 0.24, p.px * 1.04, p.px * 0.12); ctx.fill();
    }
    if (p.pilula) {
      ctx.fillStyle = p.pilula; ctx.beginPath();
      ctx.roundRect(-p.w / 2 - p.px * 0.3, -p.px * 0.46, p.w + p.px * 0.6, p.px * 0.92, p.px * 0.46); ctx.fill();
    }
    ctx.lineJoin = 'round'; ctx.lineWidth = p.px * 0.13; ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.fillStyle = p.pilula ? '#141414' : p.cor;
    if (!p.grifo && !p.pilula) ctx.strokeText(txt, 0, 0);
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  });
  ctx.restore();
  return achou ? { x0, y0, x1, y1 } : null;
}

/**
 * Desenha o hook. `t` são os segundos desde o começo dele.
 * Mesma função na prévia e no MP4.
 */
export function drawHook(ctx, W, H, hook, t) {
  const dur = Math.max(0.6, (hook.end - hook.start) * 0.85) / (hook.speed || 1);
  const tt = Math.max(0, t);
  if (!(hook.bulge > 0)) { pintaTexto(ctx, W, H, hook, tt, dur); return; }
  telas();
  const sw = Math.round(W * SS), sh = Math.round(H * SS);
  if (fora.width !== sw || fora.height !== sh) { fora.width = sw; fora.height = sh; }
  foraCtx.setTransform(SS, 0, 0, SS, 0, 0);
  foraCtx.clearRect(0, 0, W, H);
  const caixa = pintaTexto(foraCtx, W, H, hook, tt, dur);
  if (!caixa) return;
  const r = aplicaLente(foraCtx, W, H, hook.bulge, hook.lens, caixa);
  if (r) ctx.drawImage(r.cv, r.x0, r.y0);
}
