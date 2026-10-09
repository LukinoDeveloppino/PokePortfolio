# Riconoscimento delle carte da foto: stato del lavoro

Appunti di passaggio fra una sessione e l'altra (ultimo aggiornamento:
9 ottobre 2026). Leggili prima di riprendere il lavoro sul branch
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

1. **Browser** (`HTML/tcg.html`, sezione *4b. RICONOSCIMENTO DA FOTO*).
   **Dal 9/10 il tasto 📷 apre un mirino** (fotocamera dentro la pagina,
   `getUserMedia`) con la **sagoma di una carta** disegnata sopra: chi
   fotografa ci allinea la carta. Allo scatto si tiene la zona della
   sagoma + 25% di margine (lato lungo 800 px) e `rifinisciSagoma()` cerca
   i bordi solo vicino ai lati della sagoma (±15% della larghezza):
   - per ogni lato, 48 linee perpendicolari; su ognuna i picchi del
     gradiente di colore nella direzione del lato;
   - Hough ristretta al lato (inclinazione ±10°) → fino a 4 rette per lato,
     con il loro "sostegno" (quante linee hanno un bordo sulla retta);
   - le combinazioni dei 4 lati si ordinano per sostegno, proporzioni da
     carta (63:88) e vicinanza alla sagoma; le 4 migliori, **ognuna anche
     allargata di una cornice** (3,5% della larghezza: spesso il bordo
     trovato è quello interno della cornice argentata), più la sagoma
     stessa vanno al server, che sceglie (`ritagliDaSagoma()`);
   - l'editor "Correggilo a mano" parte dalla sagoma se il risultato è dubbio.

   Il mirino richiede un **contesto sicuro** (HTTPS o localhost). Su
   `http://<IP del PC>:3000` dal telefono non c'è, e il tasto torna alla
   fotocamera del telefono senza sagoma (vedi sotto). Il tasto "🖼️ Galleria
   / Da file" del mirino porta allo stesso percorso senza sagoma:
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
correzione a mano.

**Foto vere (9/10/2026)**: 9 foto dal telefono di carte mostrate sul monitor
(Limitless), in `knn/dataset/esempi_foto/` (non versionata). Risultati:

| Prova | Carta giusta al 1° posto |
|---|---|
| Ritagli multipli sulla foto intera (vecchio metodo) | **0 su 9** |
| Angoli messi a mano | 7 su 9 |
| Mirino simulato: solo la sagoma (5 varianti a foto, 45) | 29 su 45 |
| Mirino simulato: sagoma + rifinitura (45) | **36 su 45** (41 fra i primi 5) |

Perché il vecchio metodo falliva: `quadrilateri()` usa `RETR_EXTERNAL` e i
4 contorni più grandi, ma la carta stava *dentro* la pagina e il monitor (e
il testo intorno si attaccava al bordo), quindi il suo contorno non veniva
mai considerato. Succederebbe anche con tovaglie a disegni o carte vicine.
"Mirino simulato": foto ruotate per avere la carta dritta (±4°), sagoma
sbagliata di ±8% nella dimensione e ±4% nella posizione. Wondrous Patch
sbaglia sempre anche con angoli a mano (forte riflesso: problema di colore,
non di ritaglio); Mega Kangaskhan ex 2 su 5. La similarità non separa bene
giuste (media 0,974, min 0,941) e sbagliate (media 0,965, max 0,97): la
soglia `SIMILARITA_SICURA` = 0,98 va ritarata con foto vere dal mirino.
Il mirino è stato provato nell'interfaccia vera (mobile e desktop) con una
fotocamera finta di Chromium: Slowking riconosciuta, nessun errore.

## Cosa fare dopo

1. **Provare il mirino dal telefono** con carte vere (serve HTTPS, vedi
   "Provare in locale") e raccogliere gli scatti che sbagliano.
2. Ritarare la soglia `SIMILARITA_SICURA` (0,98 in `tcg.html`) sulle foto
   vere dal mirino.
3. Riflessi e colore (Wondrous Patch): l'impronta 16×22 a colori soffre le
   dominanti. Idea: normalizzare luminosità/colore del ritaglio (e delle
   impronte di riferimento) prima del confronto.
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
telefono per scaricare OpenCV.js. Su http con l'IP il browser **non** apre
la fotocamera nella pagina (niente mirino): su Chrome Android si può
aggiungere l'indirizzo in `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
altrimenti serve HTTPS (es. la VPS). Sul PC, `http://localhost:3000` va bene.

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
