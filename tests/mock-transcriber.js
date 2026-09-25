// Mock de app/js/transcriber.js para testar a interface sem baixar o modelo Whisper.
// Mesma API (SAMPLE_RATE, MODELS, LANGUAGES, transcribe). Devolve uma frase fixa com tempos realistas.
// Use via Playwright (page.route('**/js/transcriber.js', ...)) ou trocando o import em app.js
// temporariamente — e desfaça depois.
import { sanitizeWords } from './core.js';

export const SAMPLE_RATE = 16000;
export const MODELS = {
  fast: { id: 'mock', label: 'Rápida', note: '~150 MB, menos precisa', restartEvery: 8 },
  balanced: { id: 'mock', label: 'Equilibrada', note: '~500 MB, recomendada', restartEvery: 5 },
  best: { id: 'mock', label: 'Máxima', note: '~1,6 GB, mais precisa', restartEvery: 3 },
};
export const LANGUAGES = [{ code: 'pt', label: 'Português' }, { code: 'en', label: 'English' }];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function transcribe(samples, { onStatus } = {}) {
  for (let p = 0; p <= 1; p += 0.25) { onStatus?.({ phase: 'load', loaded: p * 5e8, total: 5e8, device: 'webgpu' }); await wait(60); }
  const text = 'Eu comecei a desenvolver os assets. Depois fiz a animação no After Effects, e finalmente exportei tudo para o Final Cut. Ficou incrível!';
  const words = [];
  let t = 0.3;
  text.split(' ').forEach((w, i) => {
    if (i === 6 || i === 17) t += 0.9;
    const d = 0.18 + w.length * 0.035;
    words.push({ text: ' ' + w, start: t, end: t + d });
    t += d + 0.06;
  });
  for (let p = 0; p <= 1; p += 0.2) { onStatus?.({ phase: 'transcribe', progress: p, text: text.slice(0, Math.floor(p * text.length)), device: 'webgpu' }); await wait(60); }
  return sanitizeWords(words);
}
