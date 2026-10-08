# Riconoscimento delle carte da foto: stato del lavoro

Appunti di passaggio fra una sessione e l'altra (ultimo aggiornamento:
8 ottobre 2026). Leggili prima di riprendere il lavoro sul branch
`test-knn-dataset`.

## In breve

Nella **Collezione di gioco** (non nel portfolio) c'è un tasto 📷: fotografi
una carta, il sito la riconosce e la aggiungi con +1 / +4. Funziona su
desktop e mobile. È tutto sul branch **`test-knn-dataset`**, nato da
`feat/backend-server`. **Non è in produzione** e non è stato unito a
nessun altro branch: `master` (versione Google Apps Script) e
`feat/backend-server` vanno avanti in parallelo e non si fanno merge fra
loro. Per portarlo in produzione va prima deciso con l'utente.

## Come funziona

1. **Browser** (`HTML/tcg.html`, sezione *4b. RICONOSCIMENTO DA FOTO*):
   - la foto si riduce a 800 px sul lato lungo;
   - OpenCV.js (`@techstark/opencv-js@4.10.0-release.1` da jsDelivr, ~10 MB,
     caricato solo al primo uso) cerca **più ritagli candidati** della
     carta con 5 metodi: bordi Canny, Canny con soglie dalla mediana,
     Otsu su luminosità e saturazione, differenza dal colore del tavolo
     (stimato dalla cornice della foto). Si aggiungono la foto intera e due
     rettangoli al centro. Massimo 12 ritagli, cercati su una copia a 480 px;
   - ogni ritaglio si raddrizza a 224×312 e se ne calcola l'**impronta**:
     miniatura 16×22 a colori = 1056 numeri, dritta e capovolta.
2. **Server** (`server/src/services/riconoscimento.js`, RPC `recognizeTcgCard`):
   - confronta le impronte (similarità coseno) con quelle di tutte le carte
     legali in Standard in **versione base** (Common, Uncommon, Rare,
     Double Rare, ACE SPEC Rare: niente full art, illustration rare, promo);
   - vince l'impronta con il vicino più simile (`best_index` dice quale
     ritaglio); i 5 vicini votano la **carta di gioco** (`game_key`);
   - risponde con 5 candidati, `best_similarity` e le copie possedute.
3. **Finestra dei risultati**: la foto ritagliata accanto alla carta più
   probabile; sotto "Non è questa?" con le alternative. Se
   `best_similarity < 0,98` mostra "Non sono sicuro" e tutti i candidati
   in elenco. Il link **"✂️ Ritaglio sbagliato? Correggilo a mano"** apre un
   editor in cui si trascinano i 4 angoli sulla carta e si riconosce di nuovo.
4. **Impronte delle carte**: tabella `tcg_card_vectors` (migrazione
   `004_riconoscimento.sql`). Le calcola il job `tcg-sync` (lo stesso del
   catalogo da gioco) solo per le carte nuove o con immagine cambiata. Al
   primo avvio senza impronte la sync parte da sola (`server/src/index.js`):
   circa 4000 immagini da scaricare, qualche minuto, ~500 MB di traffico.
   Dipendenza nuova: `pngjs` (JavaScript puro).

L'impronta va calcolata **identica** in `tcg.html` (`impronta()`) e in
`riconoscimento.js` (`impronta()`): se ne cambi una, cambia anche l'altra.

## Numeri misurati (foto simulate, non foto vere)

| Prova | Carta giusta al 1° posto |
|---|---|
| Foto da tavolo semplici (100, codice vero del browser + server) | 92% (96% fra i primi 5) |
| Foto difficili, ritaglio vecchio a un solo contorno (300, Python) | 58% |
| Foto difficili, ritagli multipli (180, codice vero del browser + server) | **85%** (87% fra i primi 5) |

Per tipo di foto difficile (ritagli multipli): normale 100%, tavolo chiaro
90%, carta molto vicina 80%, dito sul bordo 100%, **altre carte vicine 40%**,
sfondo scuro e poca luce 100%. Tempo nel browser: ~270 ms a foto su PC.

Con foto vere dal telefono l'utente aveva segnalato che il ritaglio (allora
a un solo contorno) sbagliava spesso: da qui i ritagli multipli e la
correzione a mano. **La versione nuova non è ancora stata provata con foto
vere.**

## Cosa fare dopo

1. **Provare dal telefono con foto vere** (vedi "Provare in locale") e
   raccogliere qualche foto che sbaglia: copiarle sul PC e provarle con
   `knn/knn_carte.py riconosci` o adattando `knn/prova_browser/`.
2. Ritarare la soglia `SIMILARITA_SICURA` (0,98 in `tcg.html`) sulle foto vere.
3. Caso debole: **più carte vicine** nella foto. Idee: separare le regioni
   che si toccano, oppure chiedere di fotografare una carta alla volta su
   sfondo uniforme (suggerimento in pagina).
4. Facoltativo: salvare in collezione la stampa fotografata (oggi
   `addTcgCopies` salva la stampa scelta in automatico dal catalogo; per il
   conteggio non cambia nulla).
5. Facoltativo: servire OpenCV.js dal nostro server invece che da jsDelivr.
6. Decidere con l'utente se e come portarlo in produzione.

## Provare in locale

```bash
git checkout test-knn-dataset && git pull
npm install                      # aggiunge pngjs
npm run db:local                 # in un terminale a parte (PostgreSQL locale)
npm run dev                      # al primo avvio calcola le impronte (qualche minuto)
npm test                         # 57 test, compresi quelli del riconoscimento
```

Dal telefono, sulla stessa rete Wi-Fi: `http://<IP del PC>:3000` (il server
stampa l'indirizzo all'avvio), poi Collezione → 📷. Serve internet sul
telefono per scaricare OpenCV.js.

## La cartella `knn/` (esperimento in Python)

Dove è stato scelto il metodo. Vedi `knn/README.md`. Da rifare su un PC
nuovo: `.venv` e `dataset/` non sono versionati.

```bash
cd knn
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # torch solo per l'estrattore cnn
.venv/bin/python knn_carte.py scarica          # ~3000 immagini, ~400 MB
.venv/bin/python knn_carte.py addestra --estrattore pixel --aumenti 0
.venv/bin/python prova_ritaglio.py             # confronto dei metodi di ritaglio
```

- `knn_carte.py`: scarica, addestra, valuta, riconosci, mappa (pagina HTML
  con le carte su un piano, t-SNE).
- `prova_ritaglio.py`: foto difficili simulate e confronto dei ritagli.
- `prova_browser/`: fa girare il codice vero di `tcg.html` in Chromium
  headless su foto simulate (`prepara.py`, `cdp.mjs`, `valuta.mjs`) e
  fotografa la finestra della scansione (`ui.mjs`). Istruzioni in testa ai file.

Scelte già fatte, con i motivi:
- **Estrattore "pixel"** (16×22 a colori): veloce e semplice da rifare in
  JavaScript. La scala di grigi andava peggio (il colore aiuta); hog non
  meglio di pixel; cnn (ResNet-50) non finita di provare, scartata
  dall'utente per ora.
- **Niente copie deformate** delle carte di riferimento: stessa precisione
  con la sola immagine ufficiale.
- **Solo versioni base**: chiesto dall'utente.
