// Leitura e escrita de vídeo com Mediabunny (WebCodecs): metadados, áudio para a
// transcrição e exportação do MP4 com a legenda gravada.
import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, StreamTarget,
  WavOutputFormat, Mp4OutputFormat, QUALITY_HIGH, canEncodeVideo,
} from '../vendor/mediabunny.js';
import { captionAt, effectiveStyle } from './core.js';
import { drawCaption } from './render.js';
import { drawHook, hookAt } from './hooks.js';

export async function probe(file) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    if (!(await input.canRead())) throw new Error('Formato de arquivo não reconhecido.');
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    const info = { duration, width: 1920, height: 1080, fps: 30, hasAudio: !!audio, hasVideo: !!video };
    if (video) {
      info.width = video.displayWidth;
      info.height = video.displayHeight;
      try { info.fps = (await video.computePacketStats(120)).averagePacketRate || 30; } catch { /* mantém 30 */ }
    }
    return info;
  } finally {
    input.dispose();
  }
}

function parseWav(buffer) {
  const view = new DataView(buffer);
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Áudio intermediário inválido.');
  let pos = 12, format = 1, bits = 16, channels = 1, sampleRate = 16000;
  while (pos + 8 <= view.byteLength) {
    const id = tag(pos), size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      const len = Math.min(size, view.byteLength - body);
      const frames = Math.floor(len / (bits / 8) / channels);
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) {
          const o = body + (i * channels + c) * (bits / 8);
          acc += format === 3 && bits === 32 ? view.getFloat32(o, true) : bits === 16 ? view.getInt16(o, true) / 32768 : 0;
        }
        out[i] = acc / channels;
      }
      return { samples: out, sampleRate };
    }
    pos = body + size + (size % 2);
  }
  throw new Error('Áudio intermediário sem dados.');
}

/** Extrai o áudio como mono 16 kHz (Float32Array), o formato que o Whisper espera. */
export async function extractAudio(file, { onProgress, signal } = {}) {
  for (const codec of ['pcm-f32', 'pcm-s16']) {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
    try {
      const conversion = await Conversion.init({
        input, output, tracks: 'primary', showWarnings: false,
        video: { discard: true },
        audio: { numberOfChannels: 1, sampleRate: 16000, codec },
      });
      if (!conversion.isValid) {
        const reasons = conversion.discardedTracks.map((d) => d.reason).join(', ');
        if (codec === 'pcm-f32' && /no_encodable/.test(reasons)) continue;
        throw new Error(reasons.includes('undecodable') ? 'O Chrome não consegue ler o áudio deste arquivo.' : 'Este vídeo não tem áudio.');
      }
      conversion.onProgress = (p) => onProgress?.(p);
      const cancel = () => conversion.cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      await conversion.execute();
      signal?.removeEventListener('abort', cancel);
      return parseWav(output.target.buffer).samples;
    } finally {
      input.dispose();
    }
  }
  throw new Error('Não foi possível converter o áudio.');
}

/**
 * Exporta o vídeo com a legenda gravada (H.264 + áudio original).
 * `writable`: FileSystemWritableFileStream (grava direto no disco) ou null (retorna um Blob).
 */
export const VIDEO_CODECS = ['avc', 'hevc']; // H.264 primeiro (abre em qualquer lugar), HEVC como reserva

export async function exportBurnedIn(file, { captions, style, hooks = [], writable, onProgress, signal, width, height }) {
  let codec = null;
  for (const c of VIDEO_CODECS) {
    if (await canEncodeVideo(c, { width, height })) { codec = c; break; }
  }
  if (!codec) throw new Error('Este navegador não consegue gerar vídeo H.264. Abra o FinalCaptions no Google Chrome atualizado.');
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const target = writable ? new StreamTarget(writable, { chunked: true }) : new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }), target });

  let canvas = null, ctx = null;
  try {
    const conversion = await Conversion.init({
      input, output, tracks: 'primary', showWarnings: false,
      video: {
        codec,
        quality: QUALITY_HIGH,
        forceTranscode: true,
        process: (sample) => {
          const w = sample.displayWidth, h = sample.displayHeight;
          if (!canvas || canvas.width !== w || canvas.height !== h) {
            canvas = new OffscreenCanvas(w, h);
            ctx = canvas.getContext('2d');
          }
          sample.draw(ctx, 0, 0, w, h);
          const t = sample.timestamp + 1e-4;
          const hk = hookAt(hooks, t);
          if (hk) {
            drawHook(ctx, w, h, hk, t - hk.start);
          } else {
            const i = captionAt(captions, t);
            const c = i >= 0 ? captions[i] : null;
            // legendas cobertas por um hook não entram
            if (c && !hooks.some((x) => c.start < x.end - 0.01 && c.end > x.start + 0.01)) {
              drawCaption(ctx, w, h, c.text, effectiveStyle(c, style));
            }
          }
          return canvas;
        },
      },
    });
    const lostVideo = conversion.discardedTracks.some((d) => d.track.type === 'video');
    if (!conversion.isValid || lostVideo) {
      throw new Error('O Chrome não consegue recodificar a imagem deste vídeo (formato não suportado, como ProRes). Exporte uma versão H.264 ou HEVC e tente de novo.');
    }
    conversion.onProgress = (p) => onProgress?.(p);
    const cancel = () => conversion.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    await conversion.execute();
    signal?.removeEventListener('abort', cancel);
    return writable ? null : new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}
