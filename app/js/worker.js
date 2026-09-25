// Worker de transcrição: Whisper (transformers.js) rodando no navegador, via WebGPU.
import { pipeline, env } from '../vendor/transformers.js';

env.allowLocalModels = false; // modelos vêm do Hugging Face e ficam no cache do navegador

let asr = null;

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'load') {
      asr = await pipeline('automatic-speech-recognition', msg.model, {
        device: msg.device,
        dtype: msg.dtype,
        progress_callback: (p) => {
          if (p.status === 'progress_total') {
            self.postMessage({ type: 'download', loaded: p.loaded, total: p.total });
          }
        },
      });
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'transcribe') {
      const options = { return_timestamps: 'word', task: 'transcribe' };
      if (msg.language) options.language = msg.language;
      const out = await asr(msg.audio, options);
      self.postMessage({ type: 'result', id: msg.id, chunks: out.chunks || [], text: out.text || '' });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err?.message || String(err) });
  }
};
