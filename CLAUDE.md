# FinalCaptions — contexto para o Claude Code

## Com quem você está falando

Cello (Marcelo Coelho), motion designer brasileiro. **Não programa.** Segue instruções muito bem e
prefere ir passo a passo.

- Responda sempre em **português do Brasil**, com linguagem simples e direta.
- Explique **o que mudou e como ver**, não o código.
- Depois de cada alteração, diga exatamente o que conferir no app. Exemplo: "recarregue o Chrome
  (⌘R), abra a aba Estilo e veja o novo botão X".
- Se algo der errado, peça um print da tela ou da mensagem de erro.
- Nunca peça para ele editar código à mão.

## O que é o app

Um editor de legendas estilo CapCut que roda no Chrome do Mac. O fluxo:

1. Arrastar o vídeo para a janela.
2. Transcrever com o Whisper, local e grátis (WebGPU).
3. Editar texto, divisão, tempos e estilo.
4. Exportar: MP4 com a legenda gravada, SRT, ou FCPXML para o Final Cut Pro (um Basic Title
   editável por legenda).

Ele substituiu uma tentativa anterior de plugin (Workflow Extension) para o Final Cut. O Cello
achou que o plugin tinha passos demais.

## Como rodar e testar

- O Cello abre o app com dois cliques em `Abrir FinalCaptions.command`.
  - Esse script sobe um servidor Python **sem cache** em `http://127.0.0.1:8765/` e abre o Chrome.
  - Depois de alterar qualquer arquivo, basta ele dar **⌘R** no Chrome.
- **Não mude a porta nem o host** (`127.0.0.1:8765`). Dependem dessa origem exata:
  - o cache do modelo Whisper (centenas de MB);
  - os projetos salvos no `localStorage`.
- Não há etapa de build nem npm. São arquivos estáticos com ES modules. Mantenha assim.
- As bibliotecas ficam dentro de `app/vendor/`. Não troque por CDN:
  - `mediabunny.js` (mediabunny 1.59.1, bundle `.mjs` renomeado para `.js`);
  - `transformers.js` (@huggingface/transformers 4.3.0, `dist/transformers.min.js`).
- Testes da lógica (sem navegador): `node tests/core.test.mjs`.
  - Se o Node não estiver instalado, **pergunte ao Cello antes de instalar qualquer coisa**.
- Para checar só a sintaxe de um módulo: `node --check app/js/arquivo.js`.
- Teste de interface sem baixar o modelo: `tests/mock-transcriber.js` imita a API de
  `app/js/transcriber.js` e devolve palavras falsas com tempos realistas. Formas de usar:
  - com Playwright, interceptando a rota `**/js/transcriber.js`;
  - trocando o import temporariamente em `app/js/app.js` e **desfazendo depois**.

## Estrutura

```
Abrir FinalCaptions.command   lançador (servidor sem cache + abre o Chrome)
LEIA-ME.txt                   instruções para o Cello
app/index.html                esqueleto da interface
app/styles.css                visual (tokens no :root)
app/js/core.js                lógica pura, sem DOM (testável no Node)
app/js/render.js              drawCaption: desenha a legenda num canvas
app/js/media.js               mediabunny: probe, extractAudio, exportBurnedIn
app/js/fonts.js               fontes .ttf/.otf enviadas: lê o nome real, registra e guarda no IndexedDB
app/js/transcriber.js         divide o áudio, gerencia o worker, junta as palavras
app/js/worker.js              Web Worker com o pipeline do Whisper
app/js/app.js                 interface: estado, painel, lista, estilo, linha do tempo, exportação
app/vendor/                   bibliotecas + licenças
tests/                        testes do core + mock do transcritor
```

O que cada módulo contém:

- `core.js`:
  - estilos e divisão padrão;
  - `sanitizeWords` (remove alucinações do Whisper, como "Amara.org" e "[Música]");
  - `segment` (modos palavras, linhas e frases), `normalizeTiming`;
  - `retime` e `timedWords` (LCS entre o texto editado e as palavras transcritas), `realign`;
  - `splitCaption`, `mergeCaptions`, `captionAt`;
  - `renderText` (maiúsculas e pontuação), `toSRT`, `toFCPXML`.
- `render.js`: a mesma função `drawCaption` serve à prévia e ao MP4, então o resultado é WYSIWYG.
- `media.js`:
  - `extractAudio` converte para WAV mono 16 kHz com `Conversion` do mediabunny;
  - `exportBurnedIn` faz `Conversion` para MP4 com `video.process`, desenhando o quadro e a legenda
    num OffscreenCanvas. A saída é H.264 (ou HEVC de reserva), e o áudio é copiado.
- `app.js`:
  - estado global `state`;
  - lista estilo CapCut (textareas; Enter vai para a próxima, Shift+Enter quebra linha);
  - dividir no cursor, juntar, excluir; seleção com ⌘ e ⇧;
  - adicionar legenda vazia (`addCaptionAfter`) em três lugares: chip "+ Legenda" na barra, o `+`
    ao lado dos ícones da linha e o `.tl-add` no canto do bloco (aparece no hover, só em blocos
    com 34 px ou mais). Sem alvo explícito usa a selecionada, senão a ativa, senão a anterior à
    cabeça. Ocupa o vão livre (até 1 s); se estiver tudo colado, tira metade da próxima legenda;
    tecla N faz o mesmo. Legenda vazia não sai no SRT, no FCPXML nem no MP4;
  - aba Estilo com escopo "Todas as legendas" ou "Selecionadas";
  - linha do tempo com forma de onda, blocos e bordas arrastáveis;
  - a altura da linha do tempo é ajustável pela alça `#tlGrip` (92 px até 70% da janela, no máximo
    560; duplo clique volta a 150). A faixa de pegada é a largura toda, 18 px de altura. **Nada
    estica:** os blocos têm altura fixa (48 px no CSS, `.tl-blocks`) e a onda tem teto de
    `WAVE_MAX_H` (96 px), centrada na área livre abaixo dos blocos — o espaço que sobra vira
    respiro. `drawWave` lê `tlBlocks.offsetTop + offsetHeight`, então o CSS é quem manda;
  - prévia seguindo o mouse (skimming, como no Final Cut): `#tlSkimmer` amarelo acompanha o ponteiro
    e o vídeo mostra aquele ponto, enquanto a cabeça preta fica parada em `skim.from`. Sair da linha
    do tempo volta para a cabeça; dar play toca de onde o mouse estava; a tecla S liga e desliga
    (guardado nas preferências). O seek é limitado a um por quadro com `requestAnimationFrame`;
  - arrastar o corpo de um bloco move a legenda no tempo e apara as vizinhas (as palavras andam junto);
  - arrastar a legenda no vídeo muda a posição nos dois eixos;
  - botões de desfazer/refazer na barra de transporte, ao lado do zoom;
  - botão "Safe area": guias do Instagram só na prévia, nunca no MP4. As medidas são as que a Meta
    publica para 9:16 — topo 14%, laterais 6%, rodapé 35% no Reels e 20% no Stories. O retângulo
    pontilhado forte é o do Reels (o mais apertado) e a linha fina embaixo é o limite do Stories;
  - desfazer/refazer (60 snapshots);
  - salvamento automático no `localStorage`.

## Decisões técnicas importantes (não desfaça sem motivo)

### Transcrição

- Modelos `onnx-community/whisper-*_timestamped`. Só eles têm cross-attentions, necessárias para
  timestamps por palavra.
  - Rápida: `base`.
  - Equilibrada (padrão): `small`.
  - Máxima: `large-v3-turbo`.
- dtype no WebGPU: `{encoder_model:'fp32', decoder_model_merged:'q4'}`.
  - O turbo usa fp16/fp16 quando há `shader-f16`.
  - Sem WebGPU, usa WASM com q8.
- Usamos `return_timestamps: 'word'`. Evitamos `true` (nível de segmento) por causa da regressão
  #1590 da v4.
- **Divisão própria do áudio:** trechos de até ~28 s, cortados no ponto mais silencioso. Cada trecho
  vai ao pipeline sem `chunk_length_s`. Motivos:
  - evita bugs antigos do chunking da biblioteca (#1357, #1358);
  - permite barra de progresso real.
  Trechos silenciosos são pulados.
- **O worker é reiniciado a cada N trechos** (`restartEvery` em `MODELS`: 8, 5 e 3).
  - Contorna o vazamento de memória do Whisper no WebGPU: issue #1739, cerca de 650 MB por
    trecho. O PR #1755 ainda não entrou em 4.3.0.
  - No Apple silicon esse vazamento chegou a travar a máquina inteira.
  - O modelo recarrega do cache em segundos.
  - Se atualizar o transformers.js para uma versão com o PR #1755, dá para aumentar ou remover o
    `restartEvery`.

### Estilo

- Tamanhos em px numa altura de referência de 1080. `posY` é a porcentagem a partir do topo e
  `posX` a porcentagem a partir da esquerda (50 = centro). Fora do centro, `drawCaption` encolhe a
  largura de quebra para o texto não sair do quadro.
- Há um estilo global mais um override parcial por legenda (`caption.style`).
- Editar no escopo "Todas as legendas" apaga aquela chave dos overrides.
- Aplicar um modelo pronto em "Todas as legendas" zera todos os overrides.

### FCPXML

- Versão 1.10: um gap com start `3600s` e os titles na lane 1.
- Os offsets são `3600s + n frames`, em racional exato.
- Chave de posição do Basic Title: `9999/999166631/999166633/1/100/101`.
- O `strokeWidth` é negativo, para o contorno ficar por fora.
- A caixa de fundo não existe no Basic Title e não é exportada. O app avisa o usuário.
- `Position` leva os dois eixos: `"<x> <y>"` em px, com origem no centro do quadro.
- Se alguma legenda usa uma fonte enviada pelo usuário, a janela de exportação avisa que ela precisa
  estar instalada no Mac (Livro de Fontes) para o Final Cut mostrar igual.

### Fontes enviadas (.ttf/.otf)

- `fonts.js` lê a tabela `name` do arquivo para achar o nome real da família (nameID 16, senão 1) e
  `OS/2` para o peso e o itálico; assim o nome bate com o da fonte instalada no Mac.
- Registra com a FontFace API, então a mesma fonte vale para a prévia e para o MP4 (o export roda na
  thread principal e usa `document.fonts`).
- Os arquivos ficam no IndexedDB `finalcaptions-fonts`, não no `localStorage` (que é pequeno).
- Dá para arrastar o `.ttf`/`.otf` direto para a janela.

### Exportação MP4

- Verifica `canEncodeVideo` antes de começar.
- Se a trilha de vídeo for descartada, mostra um erro. Nunca gera um arquivo só com áudio.
- Grava direto no disco via `showSaveFilePicker` + `StreamTarget`. O StreamTarget fecha o arquivo
  sozinho.

### Visual

Limpo, estilo Apple:

- cores: branco `#fff`, névoa `#f5f5f7`, tinta `#1d1d1f`, cinza `#6e6e73`;
- **amarelo de legenda `#FFD60A`** como única cor forte (legenda ativa e linha do tempo);
- fonte do sistema e botões em pílula preta.

Textos da interface em português, frases curtas, em caixa normal.

## O que ainda não foi testado de verdade

O app foi testado num Chromium sem acesso ao Hugging Face e sem codificador H.264. Por isso, duas
partes nunca rodaram num Mac real:

1. A **transcrição real** com o Whisper. A interface foi testada com o mock.
2. O **MP4 em H.264**. O pipeline de gravação foi validado forçando VP9.

Se o Cello relatar problemas, comece por essas duas partes. Peça o print do console do Chrome:
⌥⌘J abre as Ferramentas do Desenvolvedor na aba Console.
