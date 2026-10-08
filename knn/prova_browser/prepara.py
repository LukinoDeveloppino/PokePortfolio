#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
# prepara.py — PROVA DEL CODICE DEL BROWSER SU FOTO SIMULATE
# ════════════════════════════════════════════════════════════════════
# Genera foto difficili (vedi prova_ritaglio.py) e una pagina che fa
# girare su di esse le funzioni VERE di HTML/tcg.html (sezione 4b:
# ritagli candidati, raddrizzamento, impronte). Tutto finisce in
# knn/dataset/prova_browser/ (ignorata da git).
#
#   cd knn && .venv/bin/python prova_browser/prepara.py [--per-tipo 30]
#   cd dataset/prova_browser && python3 -m http.server 8765 --bind 127.0.0.1
#   chromium --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-prova about:blank
#   node ../../prova_browser/cdp.mjs http://127.0.0.1:8765/index.html risultato.txt
#   cd ../../.. && node --env-file=.env knn/prova_browser/valuta.mjs   (server con le impronte calcolate)
# ════════════════════════════════════════════════════════════════════

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

KNN = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KNN))
import knn_carte as k
import prova_ritaglio as pr

USCITA = k.CARTELLA / 'prova_browser'
TCG_HTML = KNN.parent / 'HTML' / 'tcg.html'

PAGINA = """<!doctype html><html><head><meta charset="utf-8"><title>prova</title></head><body><pre id="out">in corso</pre>
<script>
// Funzioni copiate da HTML/tcg.html (sezione 4b), senza modifiche.
%s
fetch('elenco.json').then(function(r){return r.json();}).then(function(nomi){
  return caricaOpenCV().then(function(){
    var risultati = [], inizio = Date.now();
    return nomi.reduce(function(p, nome){
      return p.then(function(){
        return fetch('scene/' + nome + '.jpg').then(function(r){return r.blob();}).then(leggiFoto).then(function(foto){
          var ritagli = trovaCandidati(window.cv, foto), impronte = [];
          ritagli.forEach(function(angoli){
            var carta = raddrizzaCarta(window.cv, foto, angoli);
            var v = impronta(carta.getContext('2d').getImageData(0,0,CARTA_L,CARTA_A).data, CARTA_L, CARTA_A);
            impronte.push(v, improntaCapovolta(v));
          });
          risultati.push({ nome: nome, impronte: impronte });
        });
      });
    }, Promise.resolve()).then(function(){
      document.getElementById('out').textContent = 'FATTO' + JSON.stringify({ ms: (Date.now() - inizio) / nomi.length, risultati: risultati });
    });
  });
}).catch(function(e){ document.getElementById('out').textContent = 'ERRORE ' + e.message; });
</script></body></html>"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--per-tipo', type=int, default=30)
    parser.add_argument('--seme', type=int, default=99)
    arg = parser.parse_args()

    (USCITA / 'scene').mkdir(parents=True, exist_ok=True)
    for vecchia in (USCITA / 'scene').glob('*.jpg'):
        vecchia.unlink()
    carte = [c for c in k.leggi_carte() if c['rarita'] in k.RARITA_BASE]
    rng, scelta, elenco = np.random.default_rng(arg.seme), random.Random(arg.seme), []
    for tipo in pr.TIPI_SCENA:
        for _ in range(arg.per_tipo):
            carta = scelta.choice(carte)
            altre = [Image.open(k.percorso_immagine(scelta.choice(carte))) for _ in range(2)]
            nome = f"{tipo}__{carta['id']}"
            pr.scena(Image.open(k.percorso_immagine(carta)), rng, tipo, altre).save(USCITA / 'scene' / f'{nome}.jpg', quality=85)
            elenco.append(nome)
    (USCITA / 'elenco.json').write_text(json.dumps(elenco))

    testo = TCG_HTML.read_text()
    codice = testo[testo.index('var URL_OPENCV'):testo.index('// ---- Finestra della scansione ----')]
    (USCITA / 'index.html').write_text(PAGINA % codice)
    print(f'{len(elenco)} foto e pagina di prova in {USCITA}')


if __name__ == '__main__':
    main()
