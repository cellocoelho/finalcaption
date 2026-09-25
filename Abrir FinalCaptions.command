#!/bin/bash
# FinalCaptions — dê dois cliques neste arquivo para abrir o app no Google Chrome.
# Ele liga um pequeno servidor local (só no seu Mac) e abre o navegador.

cd "$(dirname "$0")/app" || exit 1
PORT=8765
URL="http://127.0.0.1:$PORT/"

abrir_navegador() {
  if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "$URL"
  else
    echo "Google Chrome não encontrado; abrindo no navegador padrão (o Chrome é o recomendado)."
    open "$URL"
  fi
}

# Já está rodando? Só abre o navegador.
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "O FinalCaptions já está aberto. Abrindo no navegador..."
  abrir_navegador
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Falta o Python 3, que vem com as Ferramentas de Linha de Comando da Apple."
  echo "Instale rodando no Terminal:  xcode-select --install"
  read -r -p "Pressione Enter para fechar."
  exit 1
fi

clear
echo ""
echo "  FinalCaptions está rodando em $URL"
echo ""
echo "  Deixe esta janela aberta enquanto usa o app."
echo "  Para fechar o FinalCaptions, feche esta janela."
echo ""
(sleep 1; abrir_navegador) &

# Servidor sem cache: depois de qualquer alteração no código, um ⌘R no Chrome já mostra a versão nova.
exec python3 - "$PORT" <<'PY'
import sys, http.server
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *args):
        pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
PY
