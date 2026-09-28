# PokéPortfolio

Web app per gestire la propria collezione di carte Pokémon: catalogo completo dei set, portfolio con valore aggiornato dai prezzi di **CardTrader**, lista dei desideri e condivisione della collezione con gli amici.

Gira interamente su **Google Apps Script**: niente server da mantenere. I dati vivono in Google Sheets (un foglio master condiviso più un foglio personale per ogni utente).

![Catalogo](docs/screenshots/catalogo.png)

---

## Funzionalità

### Catalogo
- Tutti i set Pokémon presenti su CardTrader, divisi fra **Internazionale** e **Giapponese**, ordinati per data di uscita e con il logo ufficiale.
- Le carte di un set si caricano solo quando lo espandi. Ogni set mostra il contatore delle carte possedute ("12/165").
- **Ricerca** delle carte per nome.
- Badge sulle miniature per le copie possedute e per le carte nella lista dei desideri (❤).
- **Set nascosti**: con ⊘ togli dalla vista un set che non ti interessa. La lista è personale di ogni account e si ripristina dal blocco "Set nascosti" in fondo al catalogo.
- **Aggiornamento dei set**: ⟳ riscarica carte e immagini di un singolo set, mentre "Aggiorna tutti i set" ricontrolla l'intero catalogo e riscrive solo i set cambiati. Serve per i set usciti da poco e salvati quando erano ancora incompleti.

![Set espanso](docs/screenshots/set-espanso.png)

### Scheda carta
- Scegli condizione, lingua e finitura e aggiungi la carta al portfolio o alla lista dei desideri.
- **Prezzo in tempo reale** dal marketplace di CardTrader per quella variante.
- Grafico dell'andamento del prezzo nel tempo.

![Scheda carta](docs/screenshots/modal-carta.png)

### Portfolio
- Valore totale della collezione, numero di carte e numero di set.
- Grafico dell'andamento del valore nel tempo, con filtro per periodo.
- Mini-grafico del prezzo accanto a ogni carta.
- Export in **CSV**.

![Portfolio](docs/screenshots/portfolio.png)

### Lista dei desideri
Le carte che vorresti, con il loro prezzo aggiornato e la sua storia. La lista non entra nel valore del portfolio.

![Lista dei desideri](docs/screenshots/wishlist.png)

### Amici
Consulti in sola lettura il portfolio degli altri utenti registrati.

### Mobile
Un'interfaccia dedicata per smartphone, con la barra di navigazione in basso e la scheda carta che si chiude trascinandola verso il basso.

<p align="center">
  <img src="docs/screenshots/mobile-catalogo.jpeg" width="30%" alt="Catalogo su mobile">
  <img src="docs/screenshots/mobile-carta.jpeg" width="30%" alt="Scheda carta su mobile">
  <img src="docs/screenshots/mobile-portfolio.jpeg" width="30%" alt="Portfolio su mobile">
</p>

---

## Come funziona

```
┌──────────────┐   google.script.run   ┌───────────────────────┐
│  Browser     │ ────────────────────▶ │  Google Apps Script   │
│  desktop /   │                       │  (Script/*.js → .gs)  │
│  mobile      │ ◀──────────────────── │                       │
└──────────────┘                       └───────┬───────┬───────┘
                                               │       │
                         ┌─────────────────────┘       └──────────────┐
                         ▼                                            ▼
             ┌────────────────────────┐                  ┌────────────────────┐
             │  Foglio MASTER         │                  │  API CardTrader    │
             │  utenti, SET_CACHE,    │                  │  set, carte,       │
             │  CACHE_CARDS,          │                  │  prezzi            │
             │  BATCH_STATE           │                  └────────────────────┘
             └────────────────────────┘
             ┌────────────────────────┐
             │  Foglio per utente     │
             │  CONFIG, PORTFOLIO,    │
             │  WISHLIST, storici     │
             └────────────────────────┘
```

- **Foglio master**: il primo foglio contiene gli utenti (username, hash SHA-256 della password, ID del foglio personale, API key CardTrader). Qui stanno anche il catalogo condiviso (`SET_CACHE`, `CACHE_CARDS`) e lo stato dei processi automatici (`BATCH_STATE`).
- **Foglio personale**: viene creato alla registrazione, in una cartella Drive dedicata. Contiene `CONFIG` (impostazioni, compresi i set nascosti), `PORTFOLIO`, `WISHLIST` e gli storici dei prezzi.
- **Processi automatici**: la sync del catalogo e l'aggiornamento dei prezzi di tutti gli utenti partono da trigger temporizzati. Apps Script ferma ogni esecuzione dopo 6 minuti, quindi lavorano a turni: salvano a che punto sono arrivati in `BATCH_STATE` e si riprogrammano da soli per il turno successivo.
- **Sessioni**: al login viene generato un token che dura 24 ore.

### Struttura del repository

| Percorso | Contenuto |
|---|---|
| `Script/Codice.js` | Punto di ingresso (`doGet`), accesso ai fogli, configurazione |
| `Script/Auth.js` | Registrazione, login e sessioni |
| `Script/Cards.js` | Sync del catalogo da CardTrader, lettura dei set, set nascosti e aggiornamento dei set |
| `Script/Prices.js` | Prezzi in tempo reale, aggiornamento prezzi a turni, dashboard |
| `Script/Portfolio.js` | Gestione del portfolio ed export |
| `Script/Wishlist.js` | Gestione della lista dei desideri |
| `Script/Friends.js` | Portfolio degli amici in sola lettura |
| `Script/Utils.js` | Funzioni di supporto comuni |
| `Script/Setup.js` | Configurazione guidata della prima installazione |
| `HTML/desktop.html` | Interfaccia e stile desktop |
| `HTML/mobile.html` | Interfaccia e stile mobile |
| `HTML/script.html` | JavaScript del browser, condiviso da desktop e mobile |
| `HTML/setup.html` | Pagina di configurazione guidata |

---

## Installazione

Non serve saper programmare. Ti servono un **account Google** e un **account CardTrader**, che è gratuito. Tutti i dati restano nel tuo Google Drive.

### 1. Procurati l'API key di CardTrader
Registrati su [cardtrader.com](https://www.cardtrader.com) e copia il tuo token API dalla sezione API delle impostazioni del profilo. Ti servirà al passo 4.

### 2. Crea il progetto Apps Script
1. Vai su [script.google.com](https://script.google.com) e clicca **Nuovo progetto**. Dagli un nome, per esempio *PokéPortfolio*.
2. Per ogni file di questo repository crea nell'editor un file con lo stesso nome e incolla il contenuto:

   | File nel repository | File da creare nell'editor |
   |---|---|
   | `Script/Codice.js` | `Codice.gs`, rinominando il `Codice.gs` che c'è già |
   | `Script/Auth.js`, `Cards.js`, `Friends.js`, `Portfolio.js`, `Prices.js`, `Setup.js`, `Utils.js`, `Wishlist.js` | Uno **Script** per ciascuno, con lo stesso nome (`Auth`, `Cards`, …) |
   | `HTML/desktop.html`, `mobile.html`, `script.html`, `setup.html` | Un file **HTML** per ciascuno, chiamato `desktop`, `mobile`, `script`, `setup` (l'editor aggiunge da solo `.html`) |

3. Salva tutto (icona del dischetto o `Ctrl+S`).

### 3. Pubblica la web app
1. In alto a destra: **Esegui il deployment → Nuovo deployment**.
2. Clicca l'ingranaggio accanto a *Seleziona tipo* e scegli **App web**.
3. Imposta *Esegui come*: **Io** e *Chi ha accesso*: **Chiunque**. Poi clicca **Esegui il deployment**.
4. Google ti chiede di autorizzare l'app a usare Fogli, Drive e le connessioni esterne. Compare l'avviso *"Google non ha verificato questa app"*, normale per un progetto personale: clicca **Avanzate → Vai a PokéPortfolio (non sicuro)** e poi **Consenti**.
5. Copia l'**URL dell'app web**, quello che finisce con `/exec`. È il link della tua installazione.

### 4. Configura l'app dal browser
Apri il link `/exec`. Al primo avvio compare la **configurazione guidata**: inserisci nome utente, password e API key di CardTrader e clicca **Configura PokéPortfolio**. In pochi secondi l'app:

- crea nel tuo Drive il foglio master con catalogo e utenti;
- crea il tuo account;
- imposta gli aggiornamenti automatici: prezzi ogni notte e nuovi set ogni giorno;
- avvia il primo download del catalogo, che continua in background e richiede un po' di tempo.

Fatto. Condividi il link con gli amici: potranno registrarsi dalla pagina di accesso. Per la versione mobile aggiungi `?mobile=1` in fondo al link.

> Solo tu, come proprietario del progetto, puoi completare la configurazione. Chi apre il link prima di te vede il messaggio "App non ancora configurata".

### Aggiornare il codice
Quando incolli una nuova versione dei file, vai su **Esegui il deployment → Gestisci deployment**, clicca la matita, scegli *Versione*: **Nuova versione** e poi **Esegui il deployment**. Il link `/exec` resta lo stesso. Per provare le modifiche prima di pubblicarle puoi usare il link di test `/dev` (*Esegui il deployment → Testa i deployment*).

### Problemi frequenti
- **Vedo "App non ancora configurata" anche se sono il proprietario.** Succede spesso quando nel browser sono aperti più account Google: apri il link in una finestra in incognito con il solo account proprietario.
- **Avevo già PokéPortfolio prima di questa versione.** Nella configurazione guidata scegli **"Ho già un foglio master"** e incolla il link del tuo foglio master: utenti, portfolio e catalogo restano come sono, e i trigger esistenti vengono mantenuti.
- **Il catalogo resta vuoto.** Controlla l'API key nel foglio master, tab `BATCH_STATE`, riga `default_token`, e i log in *Esecuzioni* nell'editor di Apps Script.

---

## Crediti

- Dati di carte e prezzi: [CardTrader API](https://www.cardtrader.com/docs/api/full/reference)
- Loghi e date dei set: [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)
- Grafici: [Chart.js](https://www.chartjs.org/)

Pokémon e i nomi correlati sono marchi di Nintendo, Creatures Inc. e GAME FREAK inc. Questo progetto non è affiliato né approvato da loro.
