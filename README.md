# FinalCaptions

Editor de legendas automáticas que roda inteiro no navegador. Transcreve com o Whisper
(local, via WebGPU), deixa editar texto, tempos e estilo, e exporta:

- **MP4** com a legenda gravada na imagem;
- **SRT** para YouTube, Instagram e players;
- **FCPXML** para o Final Cut Pro, com um Basic Title editável por legenda.

O vídeo nunca sai do computador: a transcrição acontece na própria máquina.

## Rodar no Mac (uso local)

Dê dois cliques em `Abrir FinalCaptions.command`. Ele sobe um servidor local sem cache em
`http://127.0.0.1:8765/` e abre o Google Chrome. Veja o `LEIA-ME.txt` para as instruções completas.

## Rodar na web

O site é estático: são só os arquivos de `app/`, sem etapa de build e sem npm.

Na Vercel, o `vercel.json` já aponta o **Output Directory** para `app`. Se o deploy não encontrar a
página, ajuste nas configurações do projeto: *Framework Preset* = **Other** e
*Root Directory* = **app**.

Precisa ser servido por **HTTPS** (ou `localhost`). O navegador recomendado é o Google Chrome
atualizado, por causa de WebGPU e WebCodecs.

## Estrutura

```
app/index.html      interface
app/styles.css      visual
app/js/core.js      lógica pura (testável no Node)
app/js/render.js    desenho da legenda no canvas
app/js/media.js     leitura e exportação de vídeo (mediabunny)
app/js/fonts.js     fontes .ttf/.otf enviadas pelo usuário
app/js/transcriber.js + worker.js   Whisper
app/js/app.js       interface: estado, lista, estilo, linha do tempo, exportação
app/vendor/         bibliotecas + licenças
tests/              testes da lógica
```

Testes: `node tests/core.test.mjs`

## Bibliotecas

[Transformers.js](https://github.com/huggingface/transformers.js) (Apache 2.0),
[Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL 2.0),
modelos [Whisper](https://github.com/openai/whisper) (MIT). Licenças em `app/vendor/`.
