// Orquestra a transcrição: divide o áudio em trechos de até ~28 s cortando nos silêncios,
// transcreve cada trecho com timestamps por palavra e junta tudo.
//
// Por que reiniciar o worker de tempos em tempos: há um vazamento de memória conhecido no
// Whisper via WebGPU (transformers.js, issue #1739, ~650 MB por trecho de 30 s). Encerrar o
// worker devolve toda a memória de vídeo; o modelo recarrega do cache em poucos segundos.
import { sanitizeWords } from './core.js';

export const SAMPLE_RATE = 16000;

export const MODELS = {
  fast: { id: 'onnx-community/whisper-base_timestamped', label: 'Rápida', note: '~150 MB, menos precisa', restartEvery: 8 },
  balanced: { id: 'onnx-community/whisper-small_timestamped', label: 'Equilibrada', note: '~500 MB, recomendada', restartEvery: 5 },
  best: { id: 'onnx-community/whisper-large-v3-turbo_timestamped', label: 'Máxima', note: '~1,6 GB, mais precisa', restartEvery: 3 },
};

export const LANGUAGES = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: '', label: 'Detectar automaticamente' },
];

async function pickDevice() {
  try {
    if ('gpu' in navigator) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return { device: 'webgpu', f16: adapter.features.has('shader-f16') };
    }
  } catch { /* sem WebGPU */ }
  return { device: 'wasm', f16: false };
}

function dtypeFor(key, { device, f16 }) {
  if (device !== 'webgpu') return { encoder_model: 'q8', decoder_model_merged: 'q8' };
  if (key === 'best' && f16) return { encoder_model: 'fp16', decoder_model_merged: 'fp16' };
  return { encoder_model: 'fp32', decoder_model_merged: 'q4' };
}

// ---------- Divisão do áudio nos silêncios ----------

const FRAME = 320; // 20 ms

function frameLoudness(samples) {
  const n = Math.floor(samples.length / FRAME);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let acc = 0;
    for (let i = f * FRAME, end = i + FRAME; i < end; i++) acc += samples[i] * samples[i];
    rms[f] = Math.sqrt(acc / FRAME);
  }
  // suaviza (100 ms) para achar pausas de verdade, não o vale entre duas sílabas
  const sm = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let acc = 0, k = 0;
    for (let j = Math.max(0, f - 2); j <= Math.min(n - 1, f + 2); j++) { acc += rms[j]; k++; }
    sm[f] = acc / k;
  }
  return sm;
}

export function planWindows(samples, maxLen = 28, minLen = 16) {
  const loud = frameLoudness(samples);
  const sorted = Float32Array.from(loud).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const silenceThreshold = Math.max(0.0015, p95 * 0.06);

  const windows = [];
  let start = 0;
  const N = samples.length;
  while (start < N) {
    let end;
    if (N - start <= maxLen * SAMPLE_RATE) {
      end = N;
    } else {
      const fLo = Math.floor((start + minLen * SAMPLE_RATE) / FRAME);
      const fHi = Math.min(loud.length - 1, Math.floor((start + maxLen * SAMPLE_RATE) / FRAME));
      let best = fHi;
      for (let f = fLo; f <= fHi; f++) if (loud[f] < loud[best]) best = f;
      end = best * FRAME + FRAME / 2;
    }
    let peak = 0;
    for (let f = Math.floor(start / FRAME); f < Math.min(loud.length, Math.ceil(end / FRAME)); f++) peak = Math.max(peak, loud[f]);
    windows.push({ start, end, silent: peak < silenceThreshold });
    start = end;
  }
  return windows;
}

// ---------- Worker ----------

class WhisperWorker {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.nextId = 1;
    this.onDownload = null;
    this.readyWaiter = null;
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'download') this.onDownload?.(data);
      else if (data.type === 'ready') this.readyWaiter?.resolve();
      else if (data.type === 'result') { this.pending.get(data.id)?.resolve(data); this.pending.delete(data.id); }
      else if (data.type === 'error') {
        const err = new Error(data.message);
        if (data.id && this.pending.has(data.id)) { this.pending.get(data.id).reject(err); this.pending.delete(data.id); }
        else this.readyWaiter?.reject(err);
      }
    };
    this.worker.onerror = (e) => this.fail(new Error(e.message || 'Falha no worker de transcrição'));
  }

  load(model, dtype, device) {
    return new Promise((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
      this.worker.postMessage({ type: 'load', model, dtype, device });
    });
  }

  transcribe(audio, language) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer]);
    });
  }

  fail(err) {
    this.readyWaiter?.reject(err);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  terminate() {
    this.fail(new DOMException('Cancelado', 'AbortError'));
    this.worker.terminate();
  }
}

/**
 * Transcreve amostras mono 16 kHz. `onStatus` recebe:
 *  { phase: 'load', loaded, total }   — baixando/carregando o modelo
 *  { phase: 'transcribe', progress, text } — progresso 0–1 e o texto parcial
 */
export async function transcribe(samples, { modelKey = 'balanced', language = 'pt', onStatus, signal } = {}) {
  const model = MODELS[modelKey] || MODELS.balanced;
  const dev = await pickDevice();
  const dtype = dtypeFor(modelKey, dev);
  const windows = planWindows(samples);
  const total = samples.length;

  let worker = null;
  let used = 0;
  let done = 0;
  const words = [];
  let partial = '';

  const abort = () => worker?.terminate();
  signal?.addEventListener('abort', abort, { once: true });

  const startWorker = async () => {
    worker?.terminate();
    worker = new WhisperWorker();
    worker.onDownload = ({ loaded, total: t }) => onStatus?.({ phase: 'load', loaded, total: t, device: dev.device });
    onStatus?.({ phase: 'load', loaded: 0, total: 0, device: dev.device });
    await worker.load(model.id, dtype, dev.device);
    used = 0;
  };

  try {
    for (const w of windows) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      if (!w.silent) {
        if (!worker || used >= model.restartEvery) await startWorker();
        const audio = samples.slice(w.start, w.end); // cópia, transferida ao worker
        const result = await worker.transcribe(audio, language);
        used++;
        const offset = w.start / SAMPLE_RATE;
        const dur = (w.end - w.start) / SAMPLE_RATE;
        for (const ch of result.chunks) {
          let [s, e] = ch.timestamp || [];
          if (s == null) continue;
          if (e == null || e < s) e = s + 0.3;
          s = Math.min(Math.max(s, 0), dur);
          e = Math.min(Math.max(e, s + 0.02), dur);
          words.push({ text: ch.text, start: offset + s, end: offset + e });
        }
        partial = (partial + ' ' + result.text).trim().slice(-160);
      }
      done += w.end - w.start;
      onStatus?.({ phase: 'transcribe', progress: done / total, text: partial, device: dev.device });
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    worker?.terminate();
  }
  return sanitizeWords(words.sort((a, b) => a.start - b.start));
}
