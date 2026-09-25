// Testes da lógica central (sem navegador). Rode com: node tests/core.test.mjs
import assert from 'node:assert/strict';
const C = await import(new URL('../app/js/core.js', import.meta.url));

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`); };

// Transcrição simulada no formato do Whisper: espaço inicial, pontuação solta, tokens especiais
const raw = [
  [' Eu', 0.0, 0.2], [' comecei', 0.2, 0.6], [' a', 0.6, 0.7], [' desenvolver', 0.7, 1.3], [' os', 1.3, 1.4], [' assets', 1.4, 1.9], ['.', 1.9, 1.95],
  [' Depois', 3.0, 3.4], [' fiz', 3.4, 3.6], [' a', 3.6, 3.7], [' animação', 3.7, 4.3], [' no', 4.3, 4.4], [' After', 4.4, 4.7], [' Effects', 4.7, 5.2], ['!', 5.2, 5.25],
  [' [Música]', 5.5, 6.0], [' Legendas', 7, 7.3], [' pela', 7.3, 7.5], [' comunidade', 7.5, 8], [' Amara.org', 8, 8.6],
].map(([text, start, end]) => ({ text, start, end }));
const words = C.sanitizeWords(raw);

test('limpa tokens especiais e alucinações', () => {
  assert.ok(words.some((w) => w.text === 'assets.'));
  assert.ok(!words.some((w) => /Música|Amara/i.test(w.text)));
});

test('divide em palavras, linhas e frases sem sobreposição', () => {
  for (const mode of ['words', 'lines', 'sentences']) {
    const caps = C.segment(words, { ...C.DEFAULT_SEGMENTATION, mode, wordsPerCaption: 3, maxCharsPerLine: 16, maxLines: 2 });
    for (let i = 1; i < caps.length; i++) assert.ok(caps[i].start >= caps[i - 1].end - 1e-9);
  }
  assert.equal(C.segment(words, { ...C.DEFAULT_SEGMENTATION, wordsPerCaption: 1 }).length, words.length);
  assert.equal(C.segment(words, { ...C.DEFAULT_SEGMENTATION, mode: 'sentences' }).length, 2);
});

const caps = C.segment(words, { ...C.DEFAULT_SEGMENTATION, mode: 'sentences' });

test('edição de texto mantém os tempos das palavras iguais', () => {
  const tw = C.timedWords({ ...caps[1], text: 'Depois eu fiz a animação no After Effects!' });
  assert.equal(tw.find((w) => w.text === 'animação').start, 3.7);
});

test('dividir no cursor e juntar', () => {
  const [a, b] = C.splitCaption(caps[0], 2);
  assert.equal(a.text, 'Eu comecei');
  assert.equal(b.text, 'a desenvolver os assets.');
  assert.equal(b.start, 0.6);
  assert.equal(C.mergeCaptions(a, b).text, caps[0].text);
});

test('realinhar com uma transcrição deslocada', () => {
  const shifted = words.map((w) => ({ ...w, start: w.start + 0.5, end: w.end + 0.5 }));
  const re = C.realign(caps, shifted);
  assert.ok(Math.abs(re[0].start - 0.5) < 1e-9);
});

test('captionAt', () => {
  assert.equal(C.captionAt(caps, 0.1), 0);
  assert.equal(C.captionAt(caps, 2.5), -1);
  assert.equal(C.captionAt(caps, 3.5), 1);
});

test('maiúsculas e pontuação', () => {
  assert.equal(C.renderText('Olá,  você   está\nbem?', { ...C.DEFAULT_STYLE, textCase: 'upper', stripPunct: true }), 'OLÁ VOCÊ ESTÁ\nBEM');
});

test('SRT', () => {
  assert.match(C.toSRT(caps, C.DEFAULT_STYLE), /^1\n00:00:00,000 --> 00:00:01,900\nEu comecei a desenvolver os assets\.\n/);
});

test('FCPXML com offsets exatos em quadros', () => {
  const fps = C.nearestFps(29.95);
  assert.equal(fps.label, '29,97');
  const xml = C.toFCPXML({ caps, style: C.DEFAULT_STYLE, fpsOption: fps, width: 1920, height: 1080, duration: 6, projectName: 'Teste & "vídeo"' });
  assert.match(xml, /offset="108000000\/30000s"/);   // 3600s + 0 quadros
  assert.match(xml, /offset="108090090\/30000s"/);   // 3600s + 90 quadros (3,003 s)
  assert.match(xml, /Teste &amp; &quot;vídeo&quot;/);
  assert.match(xml, /strokeWidth="-4"/);
});

console.log(`\n${passed} testes passaram.`);
