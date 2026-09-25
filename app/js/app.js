// FinalCaptions — interface.
import * as C from './core.js';
import { drawCaption } from './render.js';
import { probe, extractAudio, exportBurnedIn } from './media.js';
import { transcribe, MODELS, LANGUAGES, SAMPLE_RATE } from './transcriber.js';
import { loadStoredFonts, addFont, removeFont } from './fonts.js';

// ---------------------------------------------------------------- estado

const state = {
  file: null, fileKey: null, url: null, info: null,
  audio: null,           // { promise, progress, error, samples }
  peaks: null,           // Float32Array, 100 valores por segundo
  transcript: [], captions: [],
  style: { ...C.DEFAULT_STYLE }, seg: { ...C.DEFAULT_SEGMENTATION },
  language: 'pt', modelKey: 'balanced',
  tab: 'captions', styleScope: 'all', search: '',
  selection: new Set(), anchorId: null, activeId: null,
  busy: null,            // { kind: 'transcribe', abort, text, progress, live, note }
  undo: [], redo: [],
  zoom: 60,              // px por segundo na linha do tempo
  tlHeight: 150,         // altura da linha do tempo, em px
  safeArea: false,       // guias de área segura do Instagram na prévia
  skim: true,            // prévia seguindo o mouse na linha do tempo (como no Final Cut)
  fonts: [],             // fontes .ttf/.otf enviadas pelo usuário
};

const TL_MIN = 92, TL_MAX = 560, TL_DEFAULT = 150;
const WAVE_MAX_H = 96, WAVE_PAD = 12;   // altura máxima da onda e folga mínima em volta

// Área segura da Meta para 9:16 (medidas de 1080x1920): topo 14%, laterais 6%,
// rodapé 35% no Reels (curtidas, comentários, legenda) e 20% no Stories (barra de resposta).
const IG_SAFE = { top: 0.14, side: 0.06, bottomReels: 0.35, bottomStories: 0.20 };

// prévia que segue o mouse: `from` é onde a cabeça de reprodução fica de verdade
const skim = { active: false, from: 0, pending: null, raf: 0 };
let tlDragging = false;

const FONTS = ['Helvetica Neue', 'Avenir Next', 'Futura', 'Gill Sans', 'Arial', 'Arial Black', 'Impact', 'Georgia'];
const WEIGHTS = [[400, 'Regular'], [500, 'Médio'], [700, 'Negrito'], [800, 'Black']];
const SWATCHES = ['#FFFFFF', '#FFD60A', '#1D1D1F', '#FF453A', '#30D158', '#0A84FF'];
const PRESETS = [
  { name: 'Clássico', style: { color: '#FFFFFF', weight: 700, size: 72, stroke: true, strokeWidth: 4, strokeColor: '#000000', box: false, shadow: false, textCase: 'original' } },
  { name: 'Caixa', style: { color: '#FFFFFF', weight: 500, size: 64, stroke: false, box: true, boxColor: '#000000', boxOpacity: 0.65, shadow: false, textCase: 'original' } },
  { name: 'Amarelo', style: { color: '#FFD60A', weight: 800, size: 80, stroke: true, strokeWidth: 5, strokeColor: '#000000', box: false, shadow: false, textCase: 'upper' } },
  { name: 'Reels', style: { color: '#FFFFFF', weight: 800, size: 96, stroke: true, strokeWidth: 6, strokeColor: '#000000', box: false, shadow: true, textCase: 'upper', posY: 66 } },
];

// ---------------------------------------------------------------- DOM

const $ = (id) => document.getElementById(id);
const app = $('app');
const video = $('video');
const overlay = $('overlay');
const stage = $('stage');
const panel = $('panel');
const timeline = $('timeline');
const tlInner = $('tlInner');
const tlBlocks = $('tlBlocks');
const tlWave = $('tlWave');
const tlPlayhead = $('tlPlayhead');
const tlSkimmer = $('tlSkimmer');
const tlStatus = $('tlStatus');
const els = { list: null };

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

const ICONS = {
  play: '<svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>',
  split: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 2v12M3 5l2.5 3L3 11M13 5l-2.5 3L13 11"/></svg>',
  merge: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v3.5a3 3 0 0 0 3 3h5M9.5 7l2.5 2.5L9.5 12"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 6.5h6.3a3.6 3.6 0 0 1 0 7.2H7.2"/><path d="M5.8 3.9 3.2 6.5l2.6 2.6"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 6.5H6.5a3.6 3.6 0 0 0 0 7.2h2.3"/><path d="M10.2 3.9l2.6 2.6-2.6 2.6"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
};

// ---------------------------------------------------------------- utilidades

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function openModal(...content) {
  $('modalBody').replaceChildren(...content);
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; }

function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

const baseName = () => (state.file?.name || 'video').replace(/\.[^.]+$/, '');
const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : state.info?.duration || 0);
const byId = (id) => state.captions.find((c) => c.id === id);
const indexOfId = (id) => state.captions.findIndex((c) => c.id === id);
const hasCaptions = () => state.transcript.length > 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ---------------------------------------------------------------- salvar

const PREFS_KEY = 'finalcaptions:prefs:v1';
const projectKey = (k) => `finalcaptions:project:v1:${k}`;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (!p) return;
    state.style = { ...C.DEFAULT_STYLE, ...p.style };
    state.seg = { ...C.DEFAULT_SEGMENTATION, ...p.seg };
    state.language = p.language ?? state.language;
    state.modelKey = MODELS[p.modelKey] ? p.modelKey : state.modelKey;
    state.tlHeight = clamp(Math.round(+p.tlHeight || TL_DEFAULT), TL_MIN, TL_MAX);
    state.safeArea = !!p.safeArea;
    state.skim = p.skim !== false;
  } catch { /* ignora */ }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
function saveNow() {
  const prefs = { style: state.style, seg: state.seg, language: state.language, modelKey: state.modelKey, tlHeight: state.tlHeight, safeArea: state.safeArea, skim: state.skim };
  const data = JSON.stringify({ transcript: state.transcript, captions: state.captions, ...prefs, savedAt: Date.now() });
  const write = () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    if (state.fileKey && hasCaptions()) localStorage.setItem(projectKey(state.fileKey), data);
  };
  try { write(); } catch {
    // sem espaço: remove projetos antigos e tenta de novo
    Object.keys(localStorage).filter((k) => k.startsWith('finalcaptions:project:') && k !== projectKey(state.fileKey))
      .forEach((k) => localStorage.removeItem(k));
    try { write(); } catch { toast('Não foi possível salvar o progresso neste navegador.'); }
  }
}

function loadProject(key) {
  try { return JSON.parse(localStorage.getItem(projectKey(key)) || 'null'); } catch { return null; }
}

// ---------------------------------------------------------------- desfazer

const snapshot = () => JSON.stringify({ captions: state.captions, style: state.style });
let lastUndoTag = null, lastUndoAt = 0;

function pushUndo(tag = null) {
  const now = Date.now();
  if (tag && tag === lastUndoTag && now - lastUndoAt < 800) { lastUndoAt = now; return; }
  lastUndoTag = tag; lastUndoAt = now;
  state.undo.push(snapshot());
  if (state.undo.length > 60) state.undo.shift();
  state.redo = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('btnUndo').disabled = !state.undo.length;
  $('btnRedo').disabled = !state.redo.length;
}
function restore(snap) {
  const s = JSON.parse(snap);
  state.captions = s.captions;
  state.style = s.style;
  state.selection = new Set([...state.selection].filter((id) => byId(id)));
  refreshAfterEdit(true);
  updateHistoryButtons();
}
function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
  toast('Desfeito.');
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
  toast('Refeito.');
}

// ---------------------------------------------------------------- abrir vídeo

function setView(v) { app.dataset.view = v; }

async function loadFile(file) {
  if (!file) return;
  if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) {
    toast('Escolha um arquivo de vídeo, como MP4 ou MOV.');
    return;
  }
  state.busy?.abort?.();
  if (state.fileKey) saveNow();
  if (state.url) URL.revokeObjectURL(state.url);

  Object.assign(state, {
    file, fileKey: `${file.name}|${file.size}|${file.lastModified}`, url: URL.createObjectURL(file), info: null,
    audio: null, peaks: null, transcript: [], captions: [], busy: null,
    selection: new Set(), anchorId: null, activeId: null, undo: [], redo: [], search: '', tab: 'captions',
  });
  loadPrefs();
  const saved = loadProject(state.fileKey);
  if (saved?.transcript?.length) {
    state.transcript = saved.transcript;
    state.captions = saved.captions || C.segment(saved.transcript, state.seg);
    state.style = { ...C.DEFAULT_STYLE, ...saved.style };
    state.seg = { ...C.DEFAULT_SEGMENTATION, ...saved.seg };
    state.language = saved.language ?? state.language;
  }

  $('fileName').textContent = file.name;
  $('stageMessage').hidden = true;
  video.src = state.url;
  setView('work');
  renderAll();
  if (saved?.transcript?.length) toast('Legendas deste vídeo restauradas.');

  try {
    state.info = await probe(file);
    if (!state.info.hasAudio) showStageMessage('Este vídeo não tem áudio para transcrever.');
  } catch (err) {
    state.info = null;
    console.warn(err);
  }
  renderTimeline();
  startAudio();
}

function startAudio() {
  const job = { progress: 0, error: null, samples: null };
  state.audio = job;
  tlStatus.hidden = false;
  tlStatus.textContent = 'Lendo o áudio…';
  job.promise = extractAudio(state.file, {
    onProgress: (p) => {
      job.progress = p;
      if (state.audio === job) tlStatus.textContent = `Lendo o áudio… ${Math.round(p * 100)}%`;
    },
  }).then((samples) => {
    job.samples = samples;
    if (state.audio !== job) return samples;
    state.peaks = computePeaks(samples);
    tlStatus.hidden = true;
    drawWave();
    return samples;
  }).catch((err) => {
    job.error = err;
    if (state.audio === job) {
      tlStatus.textContent = err.message || 'Não foi possível ler o áudio.';
      if (!hasCaptions()) renderPanel();
    }
    throw err;
  });
  job.promise.catch(() => {});
}

function computePeaks(samples) {
  const bin = SAMPLE_RATE / 100;
  const n = Math.ceil(samples.length / bin);
  const peaks = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let m = 0;
    for (let i = b * bin, end = Math.min(samples.length, i + bin); i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > m) m = v;
    }
    peaks[b] = m;
  }
  let max = 0;
  for (const p of peaks) if (p > max) max = p;
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
  return peaks;
}

function showStageMessage(msg) {
  const m = $('stageMessage');
  m.textContent = msg;
  m.hidden = false;
}

// ---------------------------------------------------------------- transcrição

async function runTranscription() {
  const ctrl = new AbortController();
  state.busy = { kind: 'transcribe', abort: () => ctrl.abort(), text: 'Preparando o áudio…', progress: null, live: '', note: '' };
  renderPanel();
  try {
    if (!state.audio) startAudio();
    const samples = await state.audio.promise;
    const words = await transcribe(samples, {
      modelKey: state.modelKey,
      language: state.language,
      signal: ctrl.signal,
      onStatus: updateTranscribeStatus,
    });
    if (!words.length) throw new Error('Nenhuma fala foi encontrada neste vídeo.');
    if (hasCaptions()) pushUndo();
    state.transcript = words;
    state.captions = C.segment(words, state.seg);
    state.busy = null;
    state.tab = 'captions';
    saveNow();
    renderAll();
    toast(`${state.captions.length} legendas criadas. Clique em qualquer uma para editar.`);
  } catch (err) {
    const cancelled = err?.name === 'AbortError';
    state.busy = cancelled ? null : { kind: 'error', message: explainError(err) };
    renderPanel();
    if (cancelled) toast('Transcrição cancelada.');
  }
}

function explainError(err) {
  const msg = err?.message || String(err);
  if (/fetch|network|Failed to fetch|load/i.test(msg) && !navigator.onLine) return 'Sem internet para baixar o modelo de voz. Conecte-se e tente de novo (depois do primeiro download funciona offline).';
  if (/memory|OOM|allocation/i.test(msg)) return 'Faltou memória. Tente a precisão “Equilibrada” ou “Rápida”.';
  return msg;
}

function updateTranscribeStatus(s) {
  const b = state.busy;
  if (!b || b.kind !== 'transcribe') return;
  if (s.phase === 'load' && b.started) return; // recarga periódica do modelo (libera memória)
  if (s.phase === 'load') {
    const big = s.total > 5e6;
    const pct = s.total ? Math.round((s.loaded / s.total) * 100) : 0;
    b.text = big && pct < 100 ? `Baixando o modelo de voz… ${pct}%` : 'Carregando o modelo de voz…';
    b.progress = big && pct < 100 ? s.loaded / s.total : null;
    b.note = big && pct < 100 ? 'Só na primeira vez. Depois ele fica guardado neste navegador.' : '';
  } else {
    b.started = true;
    b.text = `Transcrevendo… ${Math.round(s.progress * 100)}%`;
    b.progress = s.progress;
    b.live = s.text;
    b.note = s.device === 'wasm' ? 'Sem aceleração de vídeo (WebGPU) neste navegador: vai demorar mais. Use o Google Chrome.' : '';
  }
  paintBusy();
}

let busyEls = null;
function paintBusy() {
  const b = state.busy;
  if (!busyEls || !b) return;
  busyEls.text.textContent = b.text;
  busyEls.bar.parentElement.classList.toggle('indeterminate', b.progress == null);
  busyEls.bar.style.width = b.progress == null ? '' : `${Math.round(b.progress * 100)}%`;
  busyEls.live.textContent = b.live ? `“…${b.live}”` : '';
  busyEls.note.textContent = b.note || '';
}

// ---------------------------------------------------------------- painel

function renderAll() {
  applyTimelineHeight();
  renderPanel();
  renderTimeline();
  layoutOverlay();
  updateTransport();
  updateHistoryButtons();
  $('btnAdd').disabled = !hasCaptions();
  $('btnExport').disabled = !hasCaptions();
}

function renderPanel() {
  busyEls = null;
  els.list = null;
  if (!hasCaptions() || state.busy) {
    panel.replaceChildren(renderTranscribeCard());
    return;
  }
  const tabs = segmented(
    [['captions', 'Legendas'], ['style', 'Estilo']], state.tab,
    (v) => { state.tab = v; renderPanel(); drawPreview(); },
  );
  const head = h('div', { class: 'panel-head' }, tabs);
  if (state.tab === 'captions') {
    head.append(...captionsHead());
    const list = h('ol', { class: 'caption-list', 'aria-label': 'Legendas' });
    els.list = list;
    bindList(list);
    panel.replaceChildren(head, h('div', { class: 'panel-body', id: 'listScroller' }, list));
    renderList();
  } else {
    head.append(segmented(
      [['all', 'Todas as legendas'], ['selected', `Selecionadas (${state.selection.size})`]], state.styleScope,
      (v) => { state.styleScope = v; renderPanel(); drawPreview(); },
    ));
    panel.replaceChildren(head, h('div', { class: 'panel-body' }, renderStyleBody()));
  }
}

function segmented(options, value, onChange, label) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label || null },
    options.map(([v, text]) => h('button', {
      type: 'button', 'aria-pressed': String(v === value),
      onclick: () => onChange(v),
    }, text)));
}

function renderTranscribeCard() {
  const b = state.busy;
  if (b?.kind === 'transcribe') {
    const text = h('div', { class: 'label' });
    const bar = h('span');
    const live = h('div', { class: 'live-text' });
    const note = h('div', { class: 'note' });
    busyEls = { text, bar, live, note };
    const card = h('div', { class: 'card' },
      h('h2', null, 'Transcrevendo'),
      h('div', { class: 'progress' }, bar),
      text, live, note,
      h('button', { class: 'btn soft', type: 'button', onclick: () => b.abort() }, 'Cancelar'),
    );
    queueMicrotask(paintBusy);
    return card;
  }

  const audioError = state.audio?.error;
  const lang = h('select', { class: 'select', id: 'langSelect', onchange: (e) => { state.language = e.target.value; saveNow(); } },
    LANGUAGES.map((l) => h('option', { value: l.code, selected: l.code === state.language }, l.label)));
  const models = h('div', { class: 'choice-list', role: 'radiogroup', 'aria-label': 'Precisão' },
    Object.entries(MODELS).map(([key, m]) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'model', value: key, checked: key === state.modelKey, onchange: () => { state.modelKey = key; saveNow(); } }),
      h('span', null, m.label, h('small', null, m.note)))));

  return h('div', { class: 'card' },
    h('h2', null, hasCaptions() ? 'Transcrever de novo' : 'Transcrever'),
    h('p', null, 'O áudio vira texto aqui mesmo, no seu Mac. O modelo de voz é baixado uma vez e fica guardado.'),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'langSelect' }, 'Idioma falado'), lang),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Precisão'), models),
    b?.kind === 'error' ? h('p', { class: 'error', role: 'alert' }, b.message) : null,
    audioError ? h('p', { class: 'error', role: 'alert' }, audioError.message) : null,
    h('button', { class: 'btn primary lg block', type: 'button', disabled: !!audioError || state.info?.hasAudio === false, onclick: runTranscription }, 'Transcrever vídeo'),
    hasCaptions()
      ? h('button', { class: 'btn ghost block', type: 'button', onclick: () => { state.busy = null; renderPanel(); } }, 'Voltar às legendas')
      : null,
  );
}

// ---------------------------------------------------------------- aba Legendas

function captionsHead() {
  const s = state.seg;
  const modes = segmented([['words', 'Palavras'], ['lines', 'Linhas'], ['sentences', 'Frases']], s.mode,
    (v) => regroup({ mode: v }), 'Dividir legendas por');

  const params = h('div', { class: 'row' });
  if (s.mode === 'words') {
    params.append(stepper(s.wordsPerCaption, 1, 12, (v) => regroup({ wordsPerCaption: v })),
      h('span', { class: 'label' }, s.wordsPerCaption === 1 ? 'palavra por legenda' : 'palavras por legenda'));
  } else if (s.mode === 'lines') {
    params.append(stepper(s.maxCharsPerLine, 10, 60, (v) => regroup({ maxCharsPerLine: v }), 2),
      h('span', { class: 'label' }, 'letras'),
      stepper(s.maxLines, 1, 3, (v) => regroup({ maxLines: v })),
      h('span', { class: 'label' }, s.maxLines === 1 ? 'linha' : 'linhas'));
  } else {
    params.append(h('span', { class: 'label' }, 'Uma frase por legenda'));
  }
  const more = h('button', { class: 'icon-btn more-btn', type: 'button', 'aria-label': 'Mais opções', html: ICONS.more,
    onclick: (e) => openPopover(e.currentTarget, [
      ['Realinhar texto com o áudio', realignAll],
      ['Transcrever de novo', () => { state.busy = { kind: 'retry' }; renderPanel(); }],
      ['Desfazer', undo, !state.undo.length],
      ['Refazer', redo, !state.redo.length],
    ]) });

  const search = h('label', { class: 'search' }, h('span', { html: ICONS.search }),
    h('input', { type: 'search', placeholder: 'Buscar nas legendas', value: state.search, 'aria-label': 'Buscar nas legendas',
      oninput: (e) => { state.search = e.target.value; renderList(); } }));

  return [modes, h('div', { class: 'row between' }, params, more), search];
}

function stepper(value, min, max, onChange, step = 1) {
  return h('span', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'Menos', disabled: value <= min, onclick: () => onChange(clamp(value - step, min, max)) }, '−'),
    h('output', null, value),
    h('button', { type: 'button', 'aria-label': 'Mais', disabled: value >= max, onclick: () => onChange(clamp(value + step, min, max)) }, '+'));
}

function regroup(change) {
  pushUndo();
  state.seg = { ...state.seg, ...change };
  const words = state.captions.length ? state.captions.flatMap(C.timedWords) : state.transcript;
  state.captions = C.segment(words, state.seg);
  state.selection.clear();
  refreshAfterEdit(true);
}

function realignAll() {
  pushUndo();
  state.captions = C.realign(state.captions, state.transcript, state.seg);
  refreshAfterEdit(true);
  toast('Tempos realinhados com o áudio.');
}

function renderList() {
  const list = els.list;
  if (!list) return;
  const q = fold(state.search.trim());
  const rows = [];
  state.captions.forEach((c, i) => {
    if (!q || fold(c.text).includes(q)) rows.push(captionRow(c, i));
  });
  list.replaceChildren(...rows);
  if (!rows.length) list.append(h('li', { class: 'list-empty' }, q ? `Nada encontrado para “${state.search}”.` : 'Nenhuma legenda.'));
  updateRowStates();
}

function captionRow(c, i) {
  const ta = h('textarea', { class: 'cap-text', rows: 1, spellcheck: 'true', placeholder: 'Nova legenda', 'aria-label': `Legenda ${i + 1}` });
  ta.value = c.text;
  return h('li', { class: 'cap', dataset: { id: c.id } },
    h('div', { class: 'cap-num', title: 'Selecionar (⌘-clique para várias)' }, i + 1),
    ta,
    h('div', { class: 'cap-meta' },
      h('span', { class: 'cap-time' }, `${C.formatClock(c.start, true)} – ${C.formatClock(c.end, true)}`),
      c.style ? h('span', { class: 'dot', title: 'Estilo próprio' }) : null,
      h('span', { class: 'cap-actions' },
        h('button', { type: 'button', dataset: { action: 'split' }, title: 'Dividir no cursor', 'aria-label': 'Dividir no cursor', html: ICONS.split }),
        h('button', { type: 'button', dataset: { action: 'merge' }, title: 'Juntar com a próxima', 'aria-label': 'Juntar com a próxima', html: ICONS.merge }),
        h('button', { type: 'button', dataset: { action: 'add' }, title: 'Adicionar legenda depois desta', 'aria-label': 'Adicionar legenda depois desta', html: ICONS.plus }),
        h('button', { type: 'button', dataset: { action: 'delete' }, title: 'Excluir', 'aria-label': 'Excluir', html: ICONS.trash }))),
  );
}

function updateRowStates() {
  const scrollToActive = !video.paused && !document.activeElement?.classList.contains('cap-text');
  els.list?.querySelectorAll('.cap').forEach((li) => {
    const id = li.dataset.id;
    li.classList.toggle('selected', state.selection.has(id));
    const active = id === state.activeId;
    if (active && !li.classList.contains('active') && scrollToActive) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    li.classList.toggle('active', active);
  });
  tlBlocks.querySelectorAll('.tl-block').forEach((b) => {
    b.classList.toggle('selected', state.selection.has(b.dataset.id));
    b.classList.toggle('active', b.dataset.id === state.activeId);
  });
}

let editBefore = null;
let lastPointerMods = { meta: false, shift: false };

function bindList(list) {
  list.addEventListener('pointerdown', (e) => { lastPointerMods = { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey }; });

  list.addEventListener('input', (e) => {
    if (!e.target.classList.contains('cap-text')) return;
    const c = byId(e.target.closest('.cap').dataset.id);
    if (!c) return;
    c.text = e.target.value;
    const block = tlBlocks.querySelector(`[data-id="${c.id}"] .tl-label`);
    if (block) {
      const first = c.text.split('\n')[0];
      block.textContent = first || 'Nova legenda';
      block.classList.toggle('empty', !first);
    }
    drawPreview();
    scheduleSave();
  });

  list.addEventListener('focusin', (e) => {
    if (!e.target.classList.contains('cap-text')) return;
    const id = e.target.closest('.cap').dataset.id;
    editBefore = snapshot();
    if (!lastPointerMods.meta && !lastPointerMods.shift) select(id, {});
    lastPointerMods = { meta: false, shift: false };
    const c = byId(id);
    if (c) { video.pause(); seek(c.start + 0.001); }
  });

  list.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('cap-text')) return;
    if (editBefore && editBefore !== snapshot()) {
      state.undo.push(editBefore);
      state.redo = [];
    }
    editBefore = null;
  });

  list.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('cap-text')) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const next = e.target.closest('.cap').nextElementSibling?.querySelector('.cap-text');
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
      else e.target.blur();
    } else if (e.key === 'Escape') {
      e.target.blur();
    }
  });

  list.addEventListener('click', (e) => {
    const li = e.target.closest('.cap');
    if (!li) return;
    const id = li.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'split') {
      const ta = li.querySelector('.cap-text');
      const caret = document.activeElement === ta ? ta.selectionStart : null;
      splitAt(id, caret == null ? null : C.tokensOf(ta.value.slice(0, caret)).length);
    } else if (action === 'merge') mergeNext(id);
    else if (action === 'add') addCaptionAfter(id);
    else if (action === 'delete') deleteCaptions(state.selection.has(id) ? [...state.selection] : [id]);
    else if (e.target.classList.contains('cap-text')) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) select(id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey });
    } else {
      select(id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey });
      const c = byId(id);
      if (c) seek(c.start + 0.001);
    }
  });
}

function select(id, { toggle = false, range = false }) {
  if (range && state.anchorId) {
    const a = indexOfId(state.anchorId), b = indexOfId(id);
    if (a >= 0 && b >= 0) {
      state.selection = new Set(state.captions.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id));
    }
  } else if (toggle) {
    if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
    state.anchorId = id;
  } else {
    state.selection = new Set([id]);
    state.anchorId = id;
  }
  updateRowStates();
  if (state.tab === 'style') renderPanel();
}

function splitAt(id, tokenIndex) {
  const i = indexOfId(id);
  if (i < 0) return;
  const parts = C.splitCaption(state.captions[i], tokenIndex);
  if (!parts) { toast('Uma legenda com uma só palavra não pode ser dividida.'); return; }
  pushUndo();
  state.captions.splice(i, 1, ...parts);
  state.selection = new Set([parts[1].id]);
  refreshAfterEdit(true);
  focusCaption(parts[1].id);
}

function mergeNext(id) {
  const i = indexOfId(id);
  if (i < 0 || i + 1 >= state.captions.length) return;
  pushUndo();
  state.captions.splice(i, 2, C.mergeCaptions(state.captions[i], state.captions[i + 1]));
  refreshAfterEdit(true);
  focusCaption(id);
}

const NEW_CAPTION_DUR = 1.0, MIN_CAPTION_DUR = 0.3;

/**
 * Cria uma legenda vazia logo depois de `id`. Sem `id`, usa a legenda selecionada
 * (a última, se houver várias), senão a que está tocando, senão a anterior à cabeça.
 * Usa o espaço livre; se estiver tudo colado, pega um pedaço do começo da próxima.
 */
function addCaptionAfter(id = null) {
  if (!hasCaptions()) return;
  const caps = state.captions;
  let i = id ? indexOfId(id) : -1;
  if (i < 0) {
    const selected = caps.filter((c) => state.selection.has(c.id));
    const ref = selected.length
      ? selected[selected.length - 1]
      : (state.activeId && byId(state.activeId)) || [...caps].reverse().find((c) => c.start <= (video.currentTime || 0));
    i = ref ? indexOfId(ref.id) : -1;
  }
  const at = i + 1;                       // i = -1: entra antes de todas
  const prev = i >= 0 ? caps[i] : null;
  const next = caps[at] || null;
  const from = prev ? prev.end : 0;
  const limit = next ? next.start : Math.max(duration() || 0, from + NEW_CAPTION_DUR);

  let end, trimNext = false;
  if (limit - from >= MIN_CAPTION_DUR) {
    end = Math.min(from + NEW_CAPTION_DUR, limit);
  } else if (next && next.end - next.start >= MIN_CAPTION_DUR * 2) {
    end = from + Math.min(NEW_CAPTION_DUR, (next.end - next.start) / 2);
    trimNext = true;
  } else {
    toast('Não há espaço para uma legenda aqui. Arraste os blocos para abrir espaço.');
    return;
  }

  pushUndo();
  if (trimNext) next.start = end;
  const nova = { id: C.newId(), text: '', words: [], start: from, end, style: null };
  caps.splice(at, 0, nova);
  state.selection = new Set([nova.id]);
  state.anchorId = nova.id;
  state.search = '';
  state.tab = 'captions';
  refreshAfterEdit(true);
  focusCaption(nova.id);
}

function deleteCaptions(ids) {
  if (!ids.length) return;
  pushUndo();
  const set = new Set(ids);
  state.captions = state.captions.filter((c) => !set.has(c.id));
  state.selection.clear();
  refreshAfterEdit(true);
  toast(ids.length === 1 ? 'Legenda excluída. ⌘Z desfaz.' : `${ids.length} legendas excluídas. ⌘Z desfaz.`);
}

function focusCaption(id) {
  requestAnimationFrame(() => {
    const ta = els.list?.querySelector(`[data-id="${id}"] .cap-text`);
    if (ta) { ta.focus(); ta.setSelectionRange(0, 0); }
  });
}

function refreshAfterEdit(structural) {
  if (structural) {
    if (state.tab === 'captions' && els.list) {
      // mantém o topo dos parâmetros de divisão em dia sem perder a busca
      const head = panel.querySelector('.panel-head');
      if (head) head.replaceChildren(head.firstChild, ...captionsHead());
      renderList();
    } else renderPanel();
    renderTimeline();
  }
  state.activeId = null;
  tick();
  drawPreview();
  scheduleSave();
  $('btnAdd').disabled = !hasCaptions();
  $('btnExport').disabled = !hasCaptions();
}

// ---------------------------------------------------------------- aba Estilo

function currentStyle() {
  if (state.styleScope === 'selected') {
    const first = state.captions.find((c) => state.selection.has(c.id));
    if (first) return C.effectiveStyle(first, state.style);
  }
  return state.style;
}

function applyStyle(patch, tag) {
  if (state.styleScope === 'selected' && !state.selection.size) return;
  pushUndo(tag);
  if (state.styleScope === 'all') {
    state.style = { ...state.style, ...patch };
    for (const c of state.captions) {
      if (!c.style) continue;
      for (const k of Object.keys(patch)) delete c.style[k];
      if (!Object.keys(c.style).length) c.style = null;
    }
  } else {
    for (const c of state.captions) if (state.selection.has(c.id)) c.style = { ...(c.style || {}), ...patch };
  }
  drawPreview();
  scheduleSave();
}

function renderStyleBody() {
  if (state.styleScope === 'selected' && !state.selection.size) {
    return h('div', { class: 'style-body' },
      h('p', { class: 'scope-hint' }, 'Selecione legendas na lista ou na linha do tempo para dar um estilo só a elas. ⌘-clique seleciona várias; ⇧-clique seleciona um intervalo.'));
  }
  const st = currentStyle();
  const rerender = () => { renderPanel(); drawPreview(); };

  const group = (title, ...kids) => h('section', { class: 'group' }, h('div', { class: 'group-title' }, title), ...kids);
  const slider = (label, key, min, max, step, fmt = (v) => v) => {
    const out = h('output', null, fmt(st[key]));
    return h('div', { class: 'field' },
      h('span', { class: 'label' }, label),
      h('div', { class: 'slider' },
        h('input', { type: 'range', min, max, step, value: String(st[key]), 'aria-label': label,
          oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); applyStyle({ [key]: v }, key); } }),
        out));
  };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const swatches = (key) => h('div', { class: 'swatches' },
    SWATCHES.map((hex) => h('button', { type: 'button', class: 'swatch', style: `background:${hex}`, 'aria-label': hex,
      'aria-pressed': String(st[key].toUpperCase() === hex), onclick: () => { applyStyle({ [key]: hex }); rerender(); } })),
    h('label', { class: 'swatch custom', title: 'Outra cor' },
      h('input', { type: 'color', value: st[key].length === 7 ? st[key] : '#ffffff', 'aria-label': 'Outra cor',
        oninput: (e) => applyStyle({ [key]: e.target.value.toUpperCase() }, key), onchange: rerender })));
  const toggle = (key, label) => h('label', { class: 'row between' }, h('span', null, label),
    h('span', { class: 'switch' },
      h('input', { type: 'checkbox', checked: !!st[key], 'aria-label': label, onchange: (e) => { applyStyle({ [key]: e.target.checked }); rerender(); } }),
      h('span')));

  const families = [...new Set([...FONTS, ...state.fonts.map((f) => f.family), st.font])];
  const fontSelect = h('select', { class: 'select', 'aria-label': 'Fonte',
    onchange: (e) => {
      let v = e.target.value;
      if (v === '__upload') { rerender(); pickFontFile(); return; }
      if (v === '__other') {
        v = prompt('Nome exato da fonte instalada no seu Mac (ex.: Montserrat):', st.font)?.trim();
        if (!v) { rerender(); return; }
      }
      applyStyle({ font: v }); rerender();
    } },
    families.map((f) => h('option', { value: f, selected: f === st.font }, f)),
    h('option', { value: '__upload' }, 'Enviar fonte do computador (.ttf/.otf)…'),
    h('option', { value: '__other' }, 'Outra fonte instalada no Mac…'));

  const fontChips = state.fonts.length
    ? h('div', { class: 'font-chips' }, state.fonts.map((f) => h('span', { class: 'font-chip' },
      h('b', null, `${f.family}${f.weight !== 400 ? ` ${f.weight}` : ''}${f.italic ? ' itálico' : ''}`),
      h('button', { type: 'button', 'aria-label': `Remover ${f.family}`, title: 'Remover esta fonte', onclick: () => dropFont(f) }, '×'))))
    : null;

  const presets = h('div', { class: 'presets' }, PRESETS.map((p) => {
    const cv = h('canvas', { width: 160, height: 100 });
    requestAnimationFrame(() => {
      const ctx = cv.getContext('2d');
      drawCaption(ctx, 160, 100, 'Legenda', { ...C.DEFAULT_STYLE, ...p.style, size: p.style.size * 3.4, strokeWidth: (p.style.strokeWidth || 4) * 2.4, posY: 50 });
    });
    return h('button', { type: 'button', class: 'preset', onclick: () => {
      applyStyle({ ...p.style });
      if (state.styleScope === 'all') for (const c of state.captions) c.style = null; // um modelo em “Todas” deixa tudo igual
      rerender();
    } }, cv, p.name);
  }));

  return h('div', { class: 'style-body' },
    group('Modelos prontos', presets),
    group('Texto',
      fontSelect,
      fontChips,
      segmented(WEIGHTS.map(([w, n]) => [w, n]), st.weight, (v) => { applyStyle({ weight: v }); rerender(); }, 'Peso'),
      slider('Tamanho', 'size', 24, 180, 1),
      swatches('color')),
    group('Contorno',
      toggle('stroke', 'Contorno nas letras'),
      st.stroke ? slider('Espessura', 'strokeWidth', 1, 16, 0.5) : null,
      st.stroke ? swatches('strokeColor') : null),
    group('Fundo',
      toggle('box', 'Caixa atrás do texto'),
      st.box ? swatches('boxColor') : null,
      st.box ? slider('Opacidade da caixa', 'boxOpacity', 0.1, 1, 0.05, pct) : null,
      toggle('shadow', 'Sombra')),
    group('Posição',
      slider('Altura (cima e baixo)', 'posY', 5, 95, 1, (v) => `${Math.round(v)}%`),
      slider('Lado (esquerda e direita)', 'posX', 5, 95, 1, (v) => `${Math.round(v)}%`),
      h('button', { class: 'btn soft block', type: 'button', onclick: () => { applyStyle({ posX: 50 }); rerender(); } }, 'Centralizar na horizontal'),
      h('p', { class: 'note' }, 'Dica: arraste a legenda direto no vídeo, para os lados e para cima e para baixo.')),
    group('Maiúsculas e pontuação',
      segmented([['original', 'Como falado'], ['upper', 'MAIÚSCULAS'], ['lower', 'minúsculas']], st.textCase,
        (v) => { applyStyle({ textCase: v }); rerender(); }, 'Maiúsculas'),
      toggle('stripPunct', 'Remover pontuação')),
    state.styleScope === 'selected'
      ? h('button', { class: 'btn soft block', type: 'button', onclick: () => {
        pushUndo();
        for (const c of state.captions) if (state.selection.has(c.id)) c.style = null;
        rerender(); scheduleSave();
      } }, 'Voltar ao estilo geral')
      : null,
  );
}

// ---------------------------------------------------------------- fontes enviadas

function pickFontFile() {
  const input = $('fontInput');
  input.value = '';
  input.click();
}

async function installFont(file) {
  try {
    const f = await addFont(file);
    state.fonts = [...state.fonts.filter((x) => x.id !== f.id), f].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
    if (state.styleScope === 'selected' && !state.selection.size) state.styleScope = 'all';
    applyStyle({ font: f.family });
    if (state.tab === 'style') renderPanel();
    drawPreview();
    toast(`Fonte “${f.family}” instalada no FinalCaptions.`);
  } catch (err) {
    toast(err?.message || 'Não foi possível ler este arquivo de fonte.');
  }
}

async function dropFont(f) {
  await removeFont(f.id);
  state.fonts = state.fonts.filter((x) => x.id !== f.id);
  const stillThere = state.fonts.some((x) => x.family === f.family);
  if (!stillThere && state.style.font === f.family) {
    state.style = { ...state.style, font: C.DEFAULT_STYLE.font };
    for (const c of state.captions) {
      if (c.style?.font !== f.family) continue;
      delete c.style.font;
      if (!Object.keys(c.style).length) c.style = null;
    }
  }
  if (state.tab === 'style') renderPanel();
  drawPreview();
  scheduleSave();
  toast(`Fonte “${f.family}” removida.`);
}

/** Fontes enviadas que estão realmente em uso (para avisar na exportação do Final Cut). */
function usedCustomFonts() {
  const fams = new Set(state.fonts.map((f) => f.family));
  if (!fams.size) return [];
  const used = new Set();
  if (fams.has(state.style.font)) used.add(state.style.font);
  for (const c of state.captions) if (c.style?.font && fams.has(c.style.font)) used.add(c.style.font);
  return [...used];
}

async function initFonts() {
  try {
    state.fonts = await loadStoredFonts();
  } catch { return; }
  if (!state.fonts.length) return;
  if (state.tab === 'style') renderPanel();
  drawPreview();
}

// ---------------------------------------------------------------- menu flutuante

let popover = null;
function openPopover(anchor, items) {
  closePopover();
  const r = anchor.getBoundingClientRect();
  popover = h('div', { class: 'menu', role: 'menu', style: `position:fixed; top:${r.bottom + 6}px; right:${window.innerWidth - r.right}px; width:240px` },
    items.map(([label, fn, disabled]) => h('button', { role: 'menuitem', type: 'button', disabled: !!disabled,
      style: disabled ? 'opacity:.4' : null, onclick: () => { closePopover(); fn(); } }, h('strong', null, label))));
  document.body.append(popover);
  popover.querySelector('button:not([disabled])')?.focus();
}
function closePopover() { popover?.remove(); popover = null; }

// ---------------------------------------------------------------- vídeo e prévia

function seek(t) {
  video.currentTime = clamp(t, 0, duration() || 0);
  tick();
}

function togglePlay() {
  if (!state.url) return;
  if (video.paused) video.play().catch(() => {}); else video.pause();
}

function updateTransport() {
  $('btnPlay').innerHTML = video.paused ? ICONS.play : ICONS.pause;
  $('btnPlay').setAttribute('aria-label', video.paused ? 'Reproduzir' : 'Pausar');
  $('timeLabel').textContent = `${C.formatClock(video.currentTime || 0)} / ${C.formatClock(duration())}`;
}

function tick() {
  const t = video.currentTime || 0;
  $('timeLabel').textContent = `${C.formatClock(t)} / ${C.formatClock(duration())}`;
  tlPlayhead.style.left = `${(skim.active ? skim.from : t) * state.zoom}px`;
  const i = C.captionAt(state.captions, t);
  const id = i >= 0 ? state.captions[i].id : null;
  if (id !== state.activeId) {
    state.activeId = id;
    updateRowStates();
    drawPreview();
  }
  if (!video.paused) {
    const x = t * state.zoom;
    const view = timeline.clientWidth;
    if (x < timeline.scrollLeft + 20 || x > timeline.scrollLeft + view - 60) timeline.scrollLeft = x - view * 0.25;
  }
}

/** Encerra a prévia que segue o mouse. `restore` volta para onde a cabeça estava. */
function stopSkim(restore = true) {
  if (skim.raf) { cancelAnimationFrame(skim.raf); skim.raf = 0; }
  tlSkimmer.hidden = true;
  if (!skim.active) return;
  skim.active = false;
  skim.pending = null;
  if (restore) seek(skim.from); else skim.from = video.currentTime || 0;
}

function loop() {
  tick();
  if (!video.paused) requestAnimationFrame(loop);
}

function layoutOverlay() {
  const vw = video.videoWidth || state.info?.width || 1920;
  const vh = video.videoHeight || state.info?.height || 1080;
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const s = Math.min(box.width / vw, box.height / vh);
  const w = vw * s, hgt = vh * s;
  Object.assign(overlay.style, { left: `${(box.width - w) / 2}px`, top: `${(box.height - hgt) / 2}px`, width: `${w}px`, height: `${hgt}px` });
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(hgt * dpr);
  drawPreview();
}

/**
 * Guias da área segura do Instagram, com as medidas que a Meta publica para 9:16:
 * topo 14%, laterais 6%, rodapé 35% no Reels e 20% no Stories.
 * Só na prévia — nunca entra no MP4 exportado.
 */
function drawSafeArea(ctx, W, H) {
  const bw = Math.min(W, (H * 9) / 16);
  const bh = (bw * 16) / 9;
  const x = (W - bw) / 2, y = (H - bh) / 2;
  const sx = x + bw * IG_SAFE.side, sw = bw * (1 - IG_SAFE.side * 2);
  const sy = y + bh * IG_SAFE.top;
  const reels = y + bh * (1 - IG_SAFE.bottomReels);      // limite de baixo do Reels
  const stories = y + bh * (1 - IG_SAFE.bottomStories);  // limite de baixo do Stories
  const k = Math.max(1, H / 720);

  ctx.save();
  // o que fica fora do quadro 9:16
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  if (bw < W - 0.5) { ctx.fillRect(0, 0, x, H); ctx.fillRect(x + bw, 0, W - x - bw, H); }
  if (bh < H - 0.5) { ctx.fillRect(x, 0, bw, y); ctx.fillRect(x, y + bh, bw, H - y - bh); }
  // coberto pela interface: topo, rodapé e laterais
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(x, y, bw, sy - y);
  ctx.fillRect(x, stories, bw, y + bh - stories);
  ctx.fillRect(x, sy, sx - x, stories - sy);
  ctx.fillRect(sx + sw, sy, x + bw - sx - sw, stories - sy);
  // faixa que vale para o Stories mas não para o Reels
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(sx, reels, sw, stories - reels);

  // retângulo seguro do Reels (o mais apertado dos dois)
  ctx.strokeStyle = '#FFD60A';
  ctx.lineWidth = 2 * k;
  ctx.setLineDash([9 * k, 7 * k]);
  ctx.strokeRect(sx, sy, sw, reels - sy);
  // até onde dá para descer num Stories
  ctx.strokeStyle = 'rgba(255,214,10,0.55)';
  ctx.lineWidth = 1.5 * k;
  ctx.setLineDash([4 * k, 5 * k]);
  ctx.beginPath();
  ctx.moveTo(sx, stories);
  ctx.lineTo(sx + sw, stories);
  ctx.stroke();
  ctx.setLineDash([]);

  if (bw < W - 0.5 || bh < H - 0.5) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1 * k;
    ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
  }
  if (sw > 150 * k) {
    ctx.font = `600 ${Math.round(11 * k)}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#FFD60A';
    ctx.fillText('Área segura · Reels', sx + 2 * k, sy - 5 * k);
    ctx.fillStyle = 'rgba(255,214,10,0.7)';
    ctx.fillText('limite do Stories', sx + 2 * k, stories - 4 * k);
  }
  ctx.restore();
}

function drawPreview() {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (state.safeArea) drawSafeArea(ctx, overlay.width, overlay.height);
  if (!hasCaptions()) return;
  const i = C.captionAt(state.captions, video.currentTime || 0);
  let c = i >= 0 ? state.captions[i] : null;
  let ghost = false;
  if (!c && state.tab === 'style') {
    c = state.captions.find((x) => state.selection.has(x.id)) || state.captions[0];
    ghost = true;
  }
  if (!c) return;
  ctx.globalAlpha = ghost ? 0.6 : 1;
  drawCaption(ctx, overlay.width, overlay.height, c.text, C.effectiveStyle(c, state.style));
  ctx.globalAlpha = 1;
}

function bindStage() {
  let drag = null;
  overlay.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      overlay.classList.add('dragging');
      if (state.styleScope === 'selected' && !state.selection.size) state.styleScope = 'all';
    }
    const r = overlay.getBoundingClientRect();
    applyStyle({
      posX: clamp(((e.clientX - r.left) / r.width) * 100, 5, 95),
      posY: clamp(((e.clientY - r.top) / r.height) * 100, 5, 95),
    }, 'pos');
  });
  const end = () => {
    if (!drag) return;
    overlay.classList.remove('dragging');
    if (!drag.moved) togglePlay();
    else if (state.tab === 'style') renderPanel();
    drag = null;
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);

  new ResizeObserver(() => { layoutOverlay(); drawWave(); }).observe(stage);
  // mudar só a altura não precisa remontar os blocos (a alça arrasta muitos quadros por segundo)
  let lastTlWidth = 0;
  new ResizeObserver(() => {
    if (timeline.clientWidth !== lastTlWidth) { lastTlWidth = timeline.clientWidth; renderTimeline(); }
    else { drawWave(); tick(); }
  }).observe(timeline);
  video.addEventListener('loadedmetadata', () => {
    // zoom inicial: vídeos curtos preenchem a linha do tempo; longos rolam
    const d = duration();
    if (d > 0 && timeline.clientWidth) state.zoom = clamp((timeline.clientWidth - 40) / d, 12, 120);
    layoutOverlay(); renderTimeline(); updateTransport();
  });
  video.addEventListener('play', () => { stopSkim(false); updateTransport(); requestAnimationFrame(loop); });
  video.addEventListener('pause', () => { updateTransport(); tick(); });
  video.addEventListener('seeked', tick);
  video.addEventListener('timeupdate', () => { if (video.paused) tick(); });
  video.addEventListener('error', () => {
    showStageMessage('O Chrome não consegue reproduzir este vídeo (por exemplo, ProRes). A transcrição ainda funciona; para ver a prévia, exporte uma versão H.264 ou HEVC.');
  });
  $('btnPlay').addEventListener('click', togglePlay);
}

// ---------------------------------------------------------------- linha do tempo

function renderTimeline() {
  const dur = duration();
  const width = Math.max(timeline.clientWidth, Math.ceil(dur * state.zoom) + 40);
  tlInner.style.width = `${width}px`;
  tlBlocks.replaceChildren(...state.captions.map((c) => {
    const w = Math.max(3, (c.end - c.start) * state.zoom);
    const first = c.text.split('\n')[0];
    return h('div', {
      class: 'tl-block', dataset: { id: c.id },
      style: `left:${c.start * state.zoom}px; width:${w}px`,
      title: c.text,
    },
    h('span', { class: first ? 'tl-label' : 'tl-label empty' }, first || 'Nova legenda'),
    h('span', { class: 'edge l' }), h('span', { class: 'edge r' }),
    w >= 34 ? h('button', {
      class: 'tl-add', type: 'button', title: 'Adicionar legenda depois desta',
      'aria-label': 'Adicionar legenda depois desta', html: ICONS.plus,
      onclick: (e) => { e.stopPropagation(); addCaptionAfter(c.id); },
    }) : null);
  }));
  updateRowStates();
  tick();
  drawWave();
}

function drawWave() {
  const dpr = window.devicePixelRatio || 1;
  const w = timeline.clientWidth, hgt = timeline.clientHeight;
  if (!w || !hgt) return;
  tlWave.style.width = `${w}px`;
  tlWave.width = Math.round(w * dpr);
  tlWave.height = Math.round(hgt * dpr);
  const ctx = tlWave.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  if (!state.peaks) return;
  ctx.fillStyle = '#cfcfd6';
  // Nada estica: blocos e onda têm altura fixa. Crescer a linha do tempo só abre
  // respiro — a onda fica centrada na área livre embaixo dos blocos.
  const top = tlBlocks.offsetTop + tlBlocks.offsetHeight;
  const area = Math.max(0, hgt - top);
  const waveH = Math.max(16, Math.min(WAVE_MAX_H, area - WAVE_PAD * 2));
  const mid = top + area / 2;
  const amp = waveH / 2;
  const scroll = timeline.scrollLeft;
  for (let x = 0; x < w; x += 2) {
    const b0 = Math.floor(((scroll + x) / state.zoom) * 100);
    const b1 = Math.max(b0 + 1, Math.floor(((scroll + x + 2) / state.zoom) * 100));
    let m = 0;
    for (let b = b0; b < b1 && b < state.peaks.length; b++) if (state.peaks[b] > m) m = state.peaks[b];
    const hh = Math.max(0.5, m * amp);
    ctx.fillRect(x, mid - hh, 1.4, hh * 2);
  }
}

function placeBlock(cap) {
  const el = tlBlocks.querySelector(`[data-id="${cap.id}"]`);
  if (!el) return;
  el.style.left = `${cap.start * state.zoom}px`;
  el.style.width = `${Math.max(3, (cap.end - cap.start) * state.zoom)}px`;
}

function refreshRowTime(cap) {
  const meta = els.list?.querySelector(`[data-id="${cap.id}"] .cap-time`);
  if (meta) meta.textContent = `${C.formatClock(cap.start, true)} – ${C.formatClock(cap.end, true)}`;
}

function bindTimeline() {
  timeline.addEventListener('scroll', drawWave, { passive: true });
  const timeAt = (clientX) => (clientX - tlInner.getBoundingClientRect().left) / state.zoom;

  // prévia seguindo o mouse, como a skimmer do Final Cut:
  // a cabeça preta fica parada; a linha amarela mostra o que você está espiando.
  tlInner.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || tlDragging || !state.skim || !video.paused) return;
    const dur = duration();
    if (!dur) return;
    if (!skim.active) { skim.active = true; skim.from = video.currentTime || 0; }
    const t = clamp(timeAt(e.clientX), 0, dur);
    tlSkimmer.hidden = false;
    tlSkimmer.style.left = `${t * state.zoom}px`;
    skim.pending = t;
    if (!skim.raf) {
      skim.raf = requestAnimationFrame(() => {
        skim.raf = 0;
        if (skim.active && skim.pending != null) seek(skim.pending);
      });
    }
  });
  tlInner.addEventListener('pointerleave', () => stopSkim());

  tlInner.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tl-add')) return;   // o + tem o clique dele
    const block = e.target.closest('.tl-block');
    if (!block) {
      const t = clamp(timeAt(e.clientX), 0, duration() || 0);
      stopSkim(false);
      seek(t);
      skim.from = t;
      return;
    }
    tlDragging = true;
    const id = block.dataset.id;
    const i = indexOfId(id);
    const c = state.captions[i];
    const prev = i > 0 ? state.captions[i - 1] : null;
    const next = i + 1 < state.captions.length ? state.captions[i + 1] : null;
    const edge = e.target.classList.contains('edge') ? (e.target.classList.contains('l') ? 'start' : 'end') : null;
    if (edge) e.preventDefault();
    block.setPointerCapture(e.pointerId);
    let started = false;

    stopSkim(false);
    const finish = () => {
      block.removeEventListener('pointermove', move);
      block.removeEventListener('pointerup', up);
      block.removeEventListener('pointercancel', up);
      block.classList.remove('moving');
      tlDragging = false;
      skim.from = video.currentTime || 0;
    };

    let move, up;
    if (edge) {
      const prevEnd = prev ? prev.end : 0;
      const nextStart = next ? next.start : duration() || c.end + 10;
      move = (ev) => {
        if (!started) { started = true; pushUndo(); }
        const t = timeAt(ev.clientX);
        if (edge === 'start') c.start = clamp(t, prevEnd, c.end - 0.1);
        else c.end = clamp(t, c.start + 0.1, nextStart);
        placeBlock(c);
        seek(edge === 'start' ? c.start + 0.001 : c.end - 0.001);
      };
      up = () => {
        finish();
        if (!started) return;
        refreshRowTime(c);
        scheduleSave();
      };
    } else {
      // arrastar o bloco inteiro: move a legenda no tempo e apara as vizinhas
      const mods = { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey };
      const x0 = e.clientX, t0 = c.start, len = c.end - c.start;
      const prevEnd0 = prev ? prev.end : 0, nextStart0 = next ? next.start : Infinity;
      const minStart = prev ? prev.start + 0.15 : 0;
      const maxEnd = next ? next.end - 0.15 : duration() || c.end + 10;
      move = (ev) => {
        if (!started) {
          if (Math.abs(ev.clientX - x0) < 4) return;
          started = true;
          pushUndo();
          block.classList.add('moving');
        }
        const delta = clamp((ev.clientX - x0) / state.zoom, minStart - t0, maxEnd - len - t0);
        c.start = t0 + delta;
        c.end = c.start + len;
        if (prev) { prev.end = Math.min(prevEnd0, c.start); placeBlock(prev); }
        if (next) { next.start = Math.max(nextStart0, c.end); placeBlock(next); }
        placeBlock(c);
        seek(c.start + 0.001);
      };
      up = () => {
        finish();
        if (!started) {
          select(id, mods);
          els.list?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          seek(c.start + 0.001);
          return;
        }
        const shift = c.start - t0;
        for (const w of c.words || []) { w.start += shift; w.end += shift; }
        for (const cap of [prev, c, next]) if (cap) refreshRowTime(cap);
        scheduleSave();
      };
    }
    block.addEventListener('pointermove', move);
    block.addEventListener('pointerup', up);
    block.addEventListener('pointercancel', up);
  });

  tlInner.addEventListener('dblclick', (e) => {
    const block = e.target.closest('.tl-block');
    if (!block) return;
    if (state.tab !== 'captions') { state.tab = 'captions'; renderPanel(); }
    state.search = '';
    renderList();
    focusCaption(block.dataset.id);
  });

  const zoomBy = (f) => {
    const t = video.currentTime || 0;
    state.zoom = clamp(state.zoom * f, 6, 400);
    renderTimeline();
    timeline.scrollLeft = t * state.zoom - timeline.clientWidth * 0.4;
  };
  $('zoomIn').addEventListener('click', () => zoomBy(1.5));
  $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.5));
}

function applyTimelineHeight() {
  app.style.setProperty('--tl-h', `${state.tlHeight}px`);
}

function bindTimelineGrip() {
  const grip = $('tlGrip');
  const top = () => Math.min(TL_MAX, Math.max(TL_MIN, Math.round(window.innerHeight * 0.7)));
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag = { y: e.clientY, h: state.tlHeight };
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    app.classList.add('resizing');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.tlHeight = clamp(Math.round(drag.h + (drag.y - e.clientY)), TL_MIN, top());
    applyTimelineHeight();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    grip.classList.remove('dragging');
    app.classList.remove('resizing');
    scheduleSave();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { state.tlHeight = TL_DEFAULT; applyTimelineHeight(); scheduleSave(); });
}

function bindTransportButtons() {
  $('btnUndo').innerHTML = ICONS.undo;
  $('btnRedo').innerHTML = ICONS.redo;
  $('btnAdd').addEventListener('click', () => addCaptionAfter());
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  const safe = $('btnSafe');
  safe.setAttribute('aria-pressed', String(state.safeArea));
  safe.addEventListener('click', () => {
    state.safeArea = !state.safeArea;
    safe.setAttribute('aria-pressed', String(state.safeArea));
    drawPreview();
    scheduleSave();
    toast(state.safeArea
      ? 'Área segura do Instagram ligada. É só um guia na prévia: não vai para o vídeo exportado.'
      : 'Área segura desligada.');
  });
  updateHistoryButtons();
}

// ---------------------------------------------------------------- exportar

function bindExport() {
  const menu = $('exportMenu');
  $('btnExport').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (!menu.hidden) menu.querySelector('button')?.focus();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true;
    if (popover && !e.target.closest('.menu') && !e.target.closest('.more-btn')) closePopover();
  });
  menu.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-export]')?.dataset.export;
    if (!kind) return;
    menu.hidden = true;
    if (kind === 'srt') exportSRT();
    else if (kind === 'fcpxml') openFcpxmlDialog();
    else exportMp4();
  });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !exporting) closeModal(); });
}

function exportSRT() {
  download(new Blob([C.toSRT(state.captions, state.style)], { type: 'text/plain;charset=utf-8' }), `${baseName()}.srt`);
  toast('Legenda SRT salva em Downloads.');
}

function openFcpxmlDialog() {
  const customUsed = usedCustomFonts();
  const info = state.info || { width: video.videoWidth || 1920, height: video.videoHeight || 1080, fps: 30 };
  const detected = C.nearestFps(info.fps || 30);
  const fpsSelect = h('select', { class: 'select', id: 'fpsSelect' },
    C.FPS_OPTIONS.map((o) => h('option', { value: o.label, selected: o === detected }, `${o.label} qps${o === detected ? ' (detectado)' : ''}`)));
  openModal(
    h('h2', null, 'Exportar para o Final Cut Pro'),
    h('p', null, `Cria um projeto “${baseName()} – Legendas” com um Basic Title por legenda, com a fonte, a cor, o contorno e a posição que você escolheu.`),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'fpsSelect' }, 'Taxa de quadros do seu projeto'), fpsSelect),
    h('ol', null,
      h('li', null, 'Dê duplo clique no arquivo baixado. O Final Cut importa o projeto.'),
      h('li', null, 'Abra esse projeto, clique na timeline e selecione todos os titles (⌘A). Copie (⌘C).'),
      h('li', null, 'No seu projeto, coloque o playhead no início do vídeo e use Editar › Colar como Clipe Conectado (⌥V).')),
    h('p', { class: 'note' }, 'A caixa de fundo não existe no Basic Title e não vai para o Final Cut. Fontes que não estiverem instaladas no Mac são trocadas por uma padrão.'),
    customUsed.length
      ? h('p', { class: 'note' }, `Atenção: ${customUsed.join(', ')} ${customUsed.length === 1 ? 'foi enviada' : 'foram enviadas'} por você aqui no app. Para o Final Cut mostrar igual, instale ${customUsed.length === 1 ? 'essa fonte' : 'essas fontes'} no Mac pelo Livro de Fontes.`)
      : null,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, 'Cancelar'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => {
        const fpsOption = C.FPS_OPTIONS.find((o) => o.label === fpsSelect.value) || detected;
        const xml = C.toFCPXML({
          caps: state.captions, style: state.style, fpsOption,
          width: info.width, height: info.height, duration: duration(),
          projectName: `${baseName()} – Legendas`,
        });
        download(new Blob([xml], { type: 'application/xml' }), `${baseName()} - Legendas.fcpxml`);
        closeModal();
        toast('Arquivo do Final Cut salvo em Downloads.');
      } }, 'Baixar FCPXML')),
  );
}

let exporting = false;
async function exportMp4() {
  if (!('VideoEncoder' in window)) {
    openModal(h('h2', null, 'Use o Google Chrome'), h('p', null, 'Este navegador não tem os recursos de vídeo necessários para gravar a legenda no MP4. Abra o FinalCaptions no Google Chrome.'),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: closeModal }, 'Entendi')));
    return;
  }
  const name = `${baseName()} - legendado.mp4`;
  let writable = null;
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Vídeo MP4', accept: { 'video/mp4': ['.mp4'] } }] });
      writable = await handle.createWritable();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      writable = null;
    }
  }
  const ctrl = new AbortController();
  const bar = h('span');
  const label = h('p', null, 'Preparando…');
  exporting = true;
  openModal(
    h('h2', null, 'Gravando o vídeo com a legenda'),
    h('div', { class: 'progress' }, bar),
    label,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn soft', type: 'button', onclick: () => ctrl.abort() }, 'Cancelar')),
  );
  const started = performance.now();
  try {
    const blob = await exportBurnedIn(state.file, {
      captions: state.captions, style: state.style, writable, signal: ctrl.signal,
      width: state.info?.width || video.videoWidth, height: state.info?.height || video.videoHeight,
      onProgress: (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        const elapsed = (performance.now() - started) / 1000;
        const left = p > 0.03 ? Math.max(0, elapsed / p - elapsed) : null;
        label.textContent = `${Math.round(p * 100)}%${left != null ? ` — cerca de ${Math.ceil(left)} s restantes` : ''}`;
      },
    });
    if (blob) download(blob, name);
    exporting = false;
    openModal(h('h2', null, 'Vídeo pronto'), h('p', null, writable ? `Salvo como “${name}”.` : `Salvo em Downloads como “${name}”.`),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: closeModal }, 'Fechar')));
  } catch (err) {
    exporting = false;
    try { await writable?.abort(); } catch { /* já fechado */ }
    if (ctrl.signal.aborted || /cancel/i.test(err?.name || '')) { closeModal(); toast('Exportação cancelada.'); return; }
    openModal(h('h2', null, 'Não foi possível gravar o vídeo'), h('p', { class: 'error' }, err?.message || String(err)),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: closeModal }, 'Fechar')));
  }
}

// ---------------------------------------------------------------- atalhos e arquivos

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('textarea, input, select');
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      closePopover();
      $('exportMenu').hidden = true;
      if (!$('modal').hidden && !exporting) closeModal();
    }
    if (typing || app.dataset.view !== 'work' || !$('modal').hidden) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key.toLowerCase() === 'n' && !mod && !e.altKey) { e.preventDefault(); addCaptionAfter(); }
    else if (e.key.toLowerCase() === 's' && !mod && !e.altKey) {
      e.preventDefault();
      state.skim = !state.skim;
      if (!state.skim) stopSkim();
      scheduleSave();
      toast(state.skim ? 'Prévia seguindo o mouse ligada.' : 'Prévia seguindo o mouse desligada.');
    }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && state.selection.size) { e.preventDefault(); deleteCaptions([...state.selection]); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.captions.length) {
      e.preventDefault();
      const t = video.currentTime || 0;
      const target = e.key === 'ArrowRight'
        ? state.captions.find((c) => c.start > t + 0.01)
        : [...state.captions].reverse().find((c) => c.start < t - 0.3) || state.captions[0];
      if (target) seek(target.start + 0.001);
    }
  });
}

function bindFiles() {
  const input = $('fileInput');
  $('btnChoose').addEventListener('click', () => input.click());
  $('btnNew').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { loadFile(input.files[0]); input.value = ''; });
  $('fontInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) installFont(f);
  });
  const drop = $('dropZone');
  window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = [...(e.dataTransfer?.files || [])];
    const font = files.find((f) => /\.(ttf|otf)$/i.test(f.name));
    if (font) { installFont(font); return; }
    const file = files.find((f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
    if (file) loadFile(file); else toast('Solte um arquivo de vídeo, como MP4 ou MOV.');
  });
  window.addEventListener('beforeunload', () => { if (state.fileKey) saveNow(); });
}

function checkEnvironment() {
  const missing = [];
  if (!('VideoDecoder' in window)) missing.push('WebCodecs');
  if (!('gpu' in navigator)) missing.push('WebGPU');
  if (location.protocol === 'file:') {
    const w = $('envWarning');
    w.hidden = false;
    w.textContent = 'Abra o FinalCaptions pelo arquivo “Abrir FinalCaptions.command”, não direto pelo index.html.';
  } else if (missing.length) {
    const w = $('envWarning');
    w.hidden = false;
    w.textContent = `Este navegador não tem ${missing.join(' e ')}. Para transcrever e exportar, use o Google Chrome atualizado.`;
  }
}

// ---------------------------------------------------------------- início

loadPrefs();
applyTimelineHeight();
bindFiles();
bindStage();
bindTimeline();
bindTimelineGrip();
bindTransportButtons();
bindExport();
bindKeys();
checkEnvironment();
updateTransport();
initFonts();
