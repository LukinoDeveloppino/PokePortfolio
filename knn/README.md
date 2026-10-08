# Prova: riconoscimento delle carte con KNN

Esperimento separato dall'app: si riconosce una carta da una foto cercando,
fra le immagini ufficiali delle carte dello Standard (Pokémon, Allenatori e
Strumenti, simboli H-I-J), quella più vicina (k-nearest neighbors).

## Preparazione

```bash
cd knn
python3 -m venv .venv
.venv/bin/pip install numpy pillow pillow-heif scikit-learn scikit-image opencv-python-headless
# solo per l'estrattore "cnn" (versione CPU):
.venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

## Uso

```bash
.venv/bin/python knn_carte.py scarica                       # ~3000 immagini, ~400 MB in dataset/
.venv/bin/python knn_carte.py addestra --estrattore pixel
.venv/bin/python knn_carte.py valuta   --estrattore pixel --forza 1.0
.venv/bin/python knn_carte.py valuta   --estrattore pixel --scena --esempi 10
.venv/bin/python knn_carte.py riconosci foto.jpg --estrattore pixel
.venv/bin/python knn_carte.py mappa    --estrattore pixel --foto foto.jpg
```

- **Estrattori**: `pixel` (miniatura 16×22 a colori), `grigio` (32×44 in scala
  di grigi), `hog` (forme + istogramma dei colori), `cnn` (ResNet-50 pre-addestrata).
- **Rarità**: per default si riconoscono solo le versioni base (Common,
  Uncommon, Rare, Double Rare, ACE SPEC Rare); `addestra --rarita tutte`
  include anche full art, illustration rare, hyper rare e promo.
- **Ritaglio**: `riconosci` e `valuta --scena` cercano la carta nella foto con
  OpenCV e la raddrizzano prima del confronto; carta dritta e capovolta si
  provano entrambe.
- **Mappa**: `dataset/mappa_<estrattore>.html`, da aprire nel browser. Le carte
  proiettate su un piano con t-SNE; clic su una carta per i suoi vicini veri.

- **Ritaglio su foto difficili**: `prova_ritaglio.py` simula tavolo chiaro,
  carta vicina, dito sul bordo, altre carte, poca luce e confronta il
  ritaglio a un solo contorno con i ritagli multipli usati nel sito.
- **Codice del browser**: `prova_browser/` fa girare le funzioni vere di
  `HTML/tcg.html` in Chromium headless (istruzioni in `prepara.py`).

Le "foto" della valutazione sono simulate deformando le immagini ufficiali:
i numeri sono ottimisti rispetto a foto vere.

Lo stato dell'integrazione nel sito e i prossimi passi sono in
`docs/RICONOSCIMENTO-FOTO.md`.
