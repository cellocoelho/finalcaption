// FinalCaptions — núcleo (sem DOM): palavras, legendas, divisão, alinhamento e exportação.
// Tempos sempre em segundos a partir do início do vídeo.

export const DEFAULT_STYLE = Object.freeze({
  font: 'Helvetica Neue',
  weight: 700,
  size: 72,            // px numa altura de referência de 1080
  tracking: 0,         // espaço entre letras, em % do tamanho da fonte
  lineHeight: 1.18,    // espaço entre linhas, em múltiplos do tamanho da fonte
  color: '#FFFFFF',
  stroke: true,
  strokeColor: '#000000',
  strokeWidth: 4,
  box: false,
  boxColor: '#000000',
  boxOpacity: 0.6,
  shadow: false,
  posY: 82,            // % a partir do topo
  posX: 50,            // % a partir da esquerda (50 = centro)
  textCase: 'original', // original | upper | lower
  stripPunct: false,
});

export const DEFAULT_SEGMENTATION = Object.freeze({
  mode: 'words',       // words | lines | sentences
  wordsPerCaption: 3,
  maxCharsPerLine: 28,
  maxLines: 1,
  maxSentenceDuration: 7,
  maxCaptionDuration: 4,
  pauseThreshold: 0.7,
  minCaptionDuration: 0.3,
  closeGapsUnder: 0.4,
});

let idCounter = 0;
export const newId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// ---------- Texto ----------

export const tokensOf = (text) => text.split(/\s+/).filter(Boolean);

export const alignKey = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const PUNCT = /[.,;:!?…"“”«»¡¿()]/g;

export function renderText(text, style) {
  let t = text;
  if (style.stripPunct) t = t.replace(PUNCT, '');
  if (style.textCase === 'upper') t = t.toLocaleUpperCase('pt-BR');
  else if (style.textCase === 'lower') t = t.toLocaleLowerCase('pt-BR');
  return t
    .split('\n')
    .map((l) => l.split(/[ \t]+/).filter(Boolean).join(' '))
    .filter((l, i, a) => l.length > 0 || a.length === 1)
    .join('\n');
}

export const endsSentence = (w) => /[.!?…]["”»)]*$/.test(w.trim());

// ---------- Buscar e substituir ----------

/** Texto sem acento e em minúsculas, para comparar do mesmo jeito que a busca. */
export const foldText = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Índice: para cada letra do texto "dobrado", onde ela começa no texto original. */
function foldIndex(text) {
  let folded = '';
  const at = [];
  for (let i = 0; i < text.length; i++) {
    const f = foldText(text[i]);
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
  }
  return { folded, at };
}

const isUpper = (c) => c && c !== c.toLowerCase();

/**
 * Troca todas as ocorrências de `needle` por `replacement`, ignorando acentos e
 * maiúsculas — igual à busca. Uma ocorrência que começava com maiúscula continua
 * com maiúscula. Devolve o texto novo e quantas trocas foram feitas.
 */
export function replaceOccurrences(text, needle, replacement) {
  const target = foldText(needle);
  if (!target) return { text, count: 0 };
  const { folded, at } = foldIndex(text);
  let out = '', last = 0, from = 0, count = 0;
  for (;;) {
    const hit = folded.indexOf(target, from);
    if (hit < 0) break;
    const start = at[hit];
    const lastLetter = hit + target.length - 1;
    const end = lastLetter + 1 < at.length ? at[lastLetter + 1] : text.length;
    let piece = replacement;
    if (isUpper(text[start]) && !isUpper(piece[0])) piece = piece.charAt(0).toUpperCase() + piece.slice(1);
    out += text.slice(last, start) + piece;
    last = end;
    from = hit + target.length;
    count++;
  }
  return { text: out + text.slice(last), count };
}

/** Quantas vezes `needle` aparece no texto (mesma regra da busca). */
export function countOccurrences(text, needle) {
  const target = foldText(needle);
  if (!target) return 0;
  const { folded } = foldIndex(text);
  let n = 0, from = 0;
  for (;;) {
    const hit = folded.indexOf(target, from);
    if (hit < 0) return n;
    n++;
    from = hit + target.length;
  }
}

// ---------- Limpeza da transcrição ----------

const HALLUCINATIONS = /amara\.org|legendas pela comunidade|legendado por|subtitles by|obrigad[oa] por assistir/i;

export function sanitizeWords(words) {
  const out = [];
  for (const w0 of words) {
    const w = { text: (w0.text || '').trim(), start: +w0.start || 0, end: +w0.end || 0 };
    if (!w.text) continue;
    if (/^\[.*\]$|^\(.*\)$|^<\|.*\|>$/.test(w.text)) continue;          // [Música], (risos), tokens especiais
    if (/^[\p{P}\p{S}]+$/u.test(w.text)) {                              // pontuação solta gruda na anterior
      if (out.length) out[out.length - 1].text += w.text;
      continue;
    }
    if (out.length) w.start = Math.max(w.start, out[out.length - 1].start);
    if (!(w.end > w.start)) w.end = w.start + 0.12;
    out.push(w);
  }
  // Remove frases típicas de alucinação do Whisper
  const joined = out.map((w) => w.text).join(' ');
  if (!HALLUCINATIONS.test(joined)) return out;
  const keep = [];
  for (let i = 0; i < out.length; i++) {
    const windowText = out.slice(i, i + 4).map((w) => w.text).join(' ');
    if (HALLUCINATIONS.test(windowText) && /amara|legend|subtit|obrigad/i.test(out[i].text)) {
      // pula até o fim da frase
      while (i < out.length && !endsSentence(out[i].text)) i++;
      continue;
    }
    keep.push(out[i]);
  }
  return keep;
}

// ---------- Divisão em legendas ----------

export function wrap(tokens, maxChars) {
  const lines = [];
  let line = '';
  for (const t of tokens) {
    if (!line) line = t;
    else if (line.length + 1 + t.length <= maxChars) line += ' ' + t;
    else { lines.push(line); line = t; }
  }
  if (line) lines.push(line);
  return lines;
}

export function segment(words, s = DEFAULT_SEGMENTATION) {
  const ws = words.filter((w) => w.text.trim());
  const maxDur = s.mode === 'sentences' ? s.maxSentenceDuration : s.maxCaptionDuration;
  const groups = [];
  let cur = [];
  for (const w of ws) {
    if (cur.length) {
      const first = cur[0], last = cur[cur.length - 1];
      let brk = w.start - last.end >= s.pauseThreshold || w.end - first.start > maxDur;
      if (s.mode === 'words') brk ||= cur.length >= Math.max(1, s.wordsPerCaption);
      if (s.mode === 'lines') brk ||= wrap([...cur, w].map((x) => x.text), s.maxCharsPerLine).length > Math.max(1, s.maxLines);
      if (brk) { groups.push(cur); cur = []; }
    }
    cur.push(w);
    if (endsSentence(w.text)) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);

  const caps = groups.map((g) => {
    const toks = g.map((w) => w.text.trim());
    const text = s.mode === 'lines' ? wrap(toks, s.maxCharsPerLine).join('\n') : toks.join(' ');
    return { id: newId(), text, words: g.map((w) => ({ ...w })), start: g[0].start, end: g[g.length - 1].end, style: null };
  });
  normalizeTiming(caps, s);
  return caps;
}

export function normalizeTiming(caps, s = DEFAULT_SEGMENTATION) {
  caps.sort((a, b) => a.start - b.start);
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    const next = i + 1 < caps.length ? caps[i + 1].start : Infinity;
    if (c.end - c.start < s.minCaptionDuration) c.end = c.start + s.minCaptionDuration;
    if (next - c.end < s.closeGapsUnder) c.end = next;
    c.end = Math.min(c.end, next);
    c.end = Math.max(c.end, c.start + 0.04);
  }
  return caps;
}

// ---------- Alinhamento texto ↔ áudio ----------

/** LCS entre duas listas de chaves; devolve pares [iA, iB] casados. */
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return [];
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint16Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Dá tempo às palavras do texto editado: palavras iguais herdam o tempo exato da
 * referência; palavras novas são interpoladas entre as vizinhas.
 */
export function retime(tokens, reference, winStart, winEnd) {
  if (!tokens.length) return [];
  const pairs = lcsPairs(tokens.map(alignKey), reference.map((w) => alignKey(w.text)));
  const out = new Array(tokens.length).fill(null);
  for (const [i, j] of pairs) out[i] = { text: tokens[i], start: reference[j].start, end: reference[j].end };
  let i = 0;
  while (i < tokens.length) {
    if (out[i]) { i++; continue; }
    let j = i;
    while (j < tokens.length && !out[j]) j++;
    const lo = i > 0 ? out[i - 1].end : winStart;
    const hi = j < tokens.length ? out[j].start : winEnd;
    const count = j - i;
    const step = Math.max(hi - lo, 0.08 * count) / count;
    for (let k = 0; k < count; k++) out[i + k] = { text: tokens[i + k], start: lo + k * step, end: lo + (k + 1) * step };
    i = j;
  }
  return out;
}

export const timedWords = (c) => retime(tokensOf(c.text), c.words, c.start, c.end);

/**
 * Realinha cada legenda (texto atual) com as palavras da transcrição que estão por perto
 * no tempo. Mantém textos e agrupamento; atualiza início/fim.
 */
export function realign(caps, transcript, s = DEFAULT_SEGMENTATION, margin = 3) {
  let from = 0;
  const out = caps.map((c) => {
    while (from < transcript.length && transcript[from].end < c.start - margin) from++;
    const ref = [];
    for (let k = from; k < transcript.length && transcript[k].start <= c.end + margin; k++) ref.push(transcript[k]);
    const toks = tokensOf(c.text);
    const pairs = lcsPairs(toks.map(alignKey), ref.map((w) => alignKey(w.text)));
    if (!pairs.length) return { ...c };
    const words = retime(toks, ref, c.start, c.end);
    return { ...c, words, start: words[0].start, end: words[words.length - 1].end };
  });
  return normalizeTiming(out, s);
}

// ---------- Operações de edição ----------

export function splitCaption(c, tokenIndex) {
  const words = timedWords(c);
  if (words.length < 2) return null;
  const k = Math.min(Math.max(tokenIndex ?? Math.floor(words.length / 2), 1), words.length - 1);
  const a = words.slice(0, k), b = words.slice(k);
  return [
    { id: newId(), text: a.map((w) => w.text).join(' '), words: a, start: c.start, end: Math.max(b[0].start, c.start + 0.04), style: c.style },
    { id: newId(), text: b.map((w) => w.text).join(' '), words: b, start: b[0].start, end: c.end, style: c.style },
  ];
}

export function mergeCaptions(a, b) {
  return { id: a.id, text: `${a.text} ${b.text}`.trim(), words: [...timedWords(a), ...timedWords(b)], start: a.start, end: b.end, style: a.style };
}

export const effectiveStyle = (c, global) => (c.style ? { ...global, ...c.style } : global);

/** Índice da legenda ativa no instante t (busca binária; legendas ordenadas). */
export function captionAt(caps, t) {
  let lo = 0, hi = caps.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (caps[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 && t < caps[found].end ? found : -1;
}

// ---------- Tempo ----------

export function formatClock(t, withMs = false) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base}.${String(Math.floor((t % 1) * 10))}` : base;
}

function srtTime(t) {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

// ---------- SRT ----------

export function toSRT(caps, globalStyle) {
  return caps
    .map((c) => ({ c, text: renderText(c.text, effectiveStyle(c, globalStyle)).trim() }))
    .filter((x) => x.text)
    .map((x, i) => `${i + 1}\n${srtTime(x.c.start)} --> ${srtTime(x.c.end)}\n${x.text}\n`)
    .join('\n');
}

// ---------- FCPXML (Final Cut Pro) ----------

export const FPS_OPTIONS = [
  { label: '23,976', fps: 24000 / 1001, num: 1001, den: 24000 },
  { label: '24', fps: 24, num: 100, den: 2400 },
  { label: '25', fps: 25, num: 100, den: 2500 },
  { label: '29,97', fps: 30000 / 1001, num: 1001, den: 30000 },
  { label: '30', fps: 30, num: 100, den: 3000 },
  { label: '50', fps: 50, num: 100, den: 5000 },
  { label: '59,94', fps: 60000 / 1001, num: 1001, den: 60000 },
  { label: '60', fps: 60, num: 100, den: 6000 },
];

export const nearestFps = (rate) =>
  FPS_OPTIONS.reduce((best, o) => (Math.abs(o.fps - rate) < Math.abs(best.fps - rate) ? o : best), FPS_OPTIONS[3]);

const BASIC_TITLE_UID = '.../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti';
const POSITION_KEY = '9999/999166631/999166633/1/100/101';

const FACE_NAMES = {
  default: { 400: 'Regular', 500: 'Medium', 700: 'Bold', 800: 'Heavy' },
  'Helvetica Neue': { 400: 'Regular', 500: 'Medium', 700: 'Bold', 800: 'Condensed Black' },
  'Avenir Next': { 400: 'Regular', 500: 'Medium', 700: 'Bold', 800: 'Heavy' },
  Futura: { 400: 'Medium', 500: 'Medium', 700: 'Bold', 800: 'Condensed ExtraBold' },
  Arial: { 400: 'Regular', 500: 'Regular', 700: 'Bold', 800: 'Bold' },
  'Arial Black': { 400: 'Regular', 500: 'Regular', 700: 'Regular', 800: 'Regular' },
  Impact: { 400: 'Regular', 500: 'Regular', 700: 'Regular', 800: 'Regular' },
  Georgia: { 400: 'Regular', 500: 'Regular', 700: 'Bold', 800: 'Bold' },
  'Gill Sans': { 400: 'Regular', 500: 'SemiBold', 700: 'Bold', 800: 'UltraBold' },
};

export const faceName = (font, weight) => (FACE_NAMES[font] || FACE_NAMES.default)[weight] || 'Regular';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rgba(hex, alpha = 1) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  const f = (v) => +(v / 255).toFixed(4);
  return `${f((n >> 16) & 255)} ${f((n >> 8) & 255)} ${f(n & 255)} ${alpha}`;
}

const num = (v) => String(+v.toFixed(2));

/**
 * Projeto FCPXML com um Basic Title por legenda, conectados a um gap na lane 1.
 * No Final Cut: importe, selecione os titles, copie e cole no seu projeto com o
 * playhead no início do vídeo.
 */
export function toFCPXML({ caps, style, fpsOption, width, height, duration, projectName }) {
  const { num: fn, den: fd } = fpsOption;
  const frames = (sec) => Math.max(0, Math.round((sec * fd) / fn));
  const t = (f) => (f === 0 ? '0s' : `${f * fn}/${fd}s`);
  // O gap começa em 3600s (padrão do FCP); offsets dos titles = 3600s + n frames.
  const off = (f) => `${3600 * fd + f * fn}/${fd}s`;
  const totalFrames = Math.max(frames(duration), 1);

  const titles = [];
  let prevEnd = 0;
  let tsIndex = 0;
  for (const c of caps) {
    const st = effectiveStyle(c, style);
    const text = renderText(c.text, st).trim();
    if (!text) continue;
    let s = Math.max(frames(c.start), prevEnd);
    const e = Math.max(frames(c.end), s + 1);
    if (s >= e) continue;
    prevEnd = e;
    tsIndex++;
    const posPx = ((50 - st.posY) / 100) * height;
    const posXPx = (((st.posX ?? 50) - 50) / 100) * width;
    const strokeAttrs = st.stroke && st.strokeWidth > 0
      ? ` strokeColor="${rgba(st.strokeColor)}" strokeWidth="${num(-st.strokeWidth)}"`
      : '';
    const shadowAttrs = st.shadow ? ` shadowColor="0 0 0 0.75" shadowOffset="4 315" shadowBlurRadius="6"` : '';
    // tracking em pontos; lineSpacing em % a partir do padrão do app (1,18)
    const track = ((st.tracking ?? 0) / 100) * st.size;
    const spacing = ((st.lineHeight ?? 1.18) - 1.18) * 100;
    const spaceAttrs = (track ? ` tracking="${num(track)}"` : '') + (Math.abs(spacing) > 0.5 ? ` lineSpacing="${num(spacing)}"` : '');
    titles.push(
      `              <title ref="r2" lane="1" offset="${off(s)}" name="${esc(text.replace(/\n/g, ' ').slice(0, 60))}" start="3600s" duration="${t(e - s)}">\n` +
      `                <param name="Position" key="${POSITION_KEY}" value="${num(posXPx)} ${num(posPx)}"/>\n` +
      `                <text>\n                  <text-style ref="fcts${tsIndex}">${esc(text)}</text-style>\n                </text>\n` +
      `                <text-style-def id="fcts${tsIndex}">\n` +
      `                  <text-style font="${esc(st.font)}" fontSize="${num(st.size)}" fontFace="${esc(faceName(st.font, st.weight))}" fontColor="${rgba(st.color)}" alignment="center"${spaceAttrs}${strokeAttrs}${shadowAttrs}/>\n` +
      `                </text-style-def>\n` +
      `              </title>`,
    );
  }
  const endFrames = Math.max(totalFrames, prevEnd);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" frameDuration="${fn}/${fd}s" width="${width}" height="${height}"/>
    <effect id="r2" name="Basic Title" uid="${BASIC_TITLE_UID}"/>
  </resources>
  <library>
    <event name="FinalCaptions">
      <project name="${esc(projectName)}">
        <sequence format="r1" duration="${t(endFrames)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <gap name="Legendas" offset="0s" start="3600s" duration="${t(endFrames)}">
${titles.join('\n')}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
