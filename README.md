# PokéPortfolio

Web app per gestire la tua collezione di carte Pokémon. Hai il catalogo completo dei set, il valore della collezione aggiornato con i prezzi di **CardTrader**, la lista dei desideri e la collezione dei tuoi amici.

> **Questa pagina è la versione Google Apps Script**: l'app gira nel tuo account Google e i dati stanno nel tuo Google Drive. Non serve un server. Se vuoi un'app su un server tutto tuo, c'è la [versione self-hosted](https://github.com/LukinoDeveloppino/PokePortfolio/tree/feat/backend-server).

![Catalogo](docs/screenshots/catalogo.png)

---

## Due versioni

PokéPortfolio esiste in due versioni. Fanno le stesse cose, cambia dove girano.

| | Google Apps Script (questa pagina) | Self-hosted |
|---|---|---|
| **Dove gira** | Nel tuo account Google | Su un server tuo (un VPS Oracle Cloud gratuito) |
| **Dove stanno i dati** | In fogli Google Sheets nel tuo Google Drive | In un database PostgreSQL sul server |
| **Costo** | 0 € | 0 € (risorse gratuite di Oracle) |
| **Difficoltà** | Bassa: copi dei file e premi qualche pulsante nel browser | Media: serve usare il terminale e creare un server |
| **Velocità** | Più lenta, con i limiti di Google | Più veloce, prezzi aggiornati due volte al giorno |
| **Adatta a** | Chi vuole provarla subito, da solo o con pochi amici | Chi vuole un'app sempre accesa con un indirizzo suo |
| **Guida** | [Installare la tua copia](#installare-la-tua-copia), qui sotto | [Branch `feat/backend-server`](https://github.com/LukinoDeveloppino/PokePortfolio/tree/feat/backend-server) |

---

## Cosa sa fare

- **Catalogo**: tutti i set Pokémon presenti su CardTrader, internazionali e giapponesi, con logo, ricerca per nome e contatore delle carte che possiedi ("12/165"). Puoi nascondere i set che non ti interessano e riscaricare un set (⟳) o tutti ("Aggiorna tutti i set").
- **Scheda carta**: scegli condizione, lingua e finitura, vedi il prezzo in tempo reale e il grafico del prezzo nel tempo.
- **Portfolio**: valore totale della collezione, grafico del valore nel tempo, export in CSV.
- **Lista dei desideri**: le carte che vorresti, con il loro prezzo.
- **Amici**: guardi la collezione degli altri utenti, in sola lettura.
- **Mobile**: un'interfaccia apposta per lo smartphone.

| Set espanso | Scheda carta |
|---|---|
| ![Set espanso](docs/screenshots/set-espanso.png) | ![Scheda carta](docs/screenshots/modal-carta.png) |
| **Portfolio** | **Lista dei desideri** |
| ![Portfolio](docs/screenshots/portfolio.png) | ![Lista dei desideri](docs/screenshots/wishlist.png) |

<p align="center">
  <img src="docs/screenshots/mobile-catalogo.jpeg" width="30%" alt="Catalogo su mobile">
  <img src="docs/screenshots/mobile-carta.jpeg" width="30%" alt="Scheda carta su mobile">
  <img src="docs/screenshots/mobile-portfolio.jpeg" width="30%" alt="Portfolio su mobile">
</p>

---

## Installare la tua copia

Questa guida parte da zero. Non serve saper programmare e non serve installare niente: si fa tutto nel browser, dal computer.

### Cos'è Google Apps Script

[Google Apps Script](https://script.google.com) è un servizio gratuito di Google. Ci incolli del codice e Google lo fa girare per te, sui suoi computer, con il tuo account. Per questo **non serve un server**: l'app vive nel tuo account Google e salva i dati in fogli di calcolo (Google Sheets) nel tuo Google Drive.

Tre parole che incontrerai:

- **API key**: una password che permette all'app di chiedere carte e prezzi a CardTrader. Non va condivisa.
- **Repository**: la cartella del progetto qui su GitHub, con tutti i file.
- **Branch**: una versione del progetto dentro il repository. Questa guida usa il branch `master`.

### 1. Cosa ti serve

- Un **account Google** (un indirizzo Gmail va benissimo).
- Un **account CardTrader** gratuito, per la API key.
- Un computer con un browser (Chrome, Firefox, Edge o Safari). Il telefono serve solo dopo, per usare l'app.
- Circa **mezz'ora**.

Costo: **0 €**.

### 2. Prendi la API key di CardTrader

1. Registrati su [cardtrader.com](https://www.cardtrader.com).
2. Apri le **impostazioni del profilo** e cerca la sezione **API**.
3. Lì trovi un codice lungo: è la tua API key. Copiala in un posto sicuro.

> Una API key è come una password: non condividerla e non pubblicarla.

### 3. Crea il progetto Apps Script

1. Apri [script.google.com](https://script.google.com) e accedi con il tuo account Google.
2. Premi **Nuovo progetto**. Si apre l'editor, con un file `Codice.gs` già presente (`Code.gs` se Google è in inglese).
3. In alto a sinistra clicca su **Progetto senza titolo** e scrivi un nome, per esempio `PokéPortfolio`.

### 4. Copia i file

Il progetto ha **13 file**: 9 file di codice (tipo *Script*) e 4 pagine (tipo *HTML*). Per ognuno crei un file nell'editor e ci incolli il contenuto.

**Come copiare il contenuto di un file da GitHub.** Clicca sul link del file nelle tabelle qui sotto. Nella pagina che si apre, sopra il codice, a destra, c'è un pulsante con due quadratini (**Copy raw file**): premilo e il contenuto è copiato. In alternativa premi **Raw**, seleziona tutto con `Ctrl` + `A` (`Cmd` + `A` su Mac) e copia con `Ctrl` + `C` (`Cmd` + `C`).

> Altra strada: nella pagina principale del repository premi **Code → Download ZIP**, estrai lo ZIP e apri i file con un editor di testo semplice (per esempio Blocco note su Windows). Su Mac, TextEdit mostra i file HTML come pagine e non come testo: lì conviene copiare da GitHub.

**Come creare un file nell'editor.** A sinistra, accanto alla voce **File**, premi **+**:

- scegli **Script** per i file di codice. Scrivi il nome **senza** `.gs` (per esempio `Auth`): l'editor lo aggiunge da solo;
- scegli **HTML** per le pagine. Scrivi il nome **senza** `.html` (per esempio `desktop`): anche qui l'estensione la aggiunge l'editor.

Poi clicca sul file nuovo, cancella quello che c'è dentro (`Ctrl` + `A`, poi `Canc`) e incolla il contenuto copiato (`Ctrl` + `V`).

**File di codice** (tipo *Script*). Per `Codice` non crearne uno nuovo: usa il file che c'è già e sostituisci tutto il suo contenuto.

| Nome nell'editor | Contenuto da copiare |
|---|---|
| `Codice` | [Script/Codice.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Codice.js) |
| `Auth` | [Script/Auth.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Auth.js) |
| `Cards` | [Script/Cards.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Cards.js) |
| `Friends` | [Script/Friends.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Friends.js) |
| `Portfolio` | [Script/Portfolio.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Portfolio.js) |
| `Prices` | [Script/Prices.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Prices.js) |
| `Setup` | [Script/Setup.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Setup.js) |
| `Utils` | [Script/Utils.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Utils.js) |
| `Wishlist` | [Script/Wishlist.js](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/Script/Wishlist.js) |

**Pagine** (tipo *HTML*). Qui il nome è **obbligatorio**, tutto minuscolo, esattamente come nella tabella: l'app cerca le pagine per nome.

| Nome nell'editor | Contenuto da copiare |
|---|---|
| `desktop` | [HTML/desktop.html](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/HTML/desktop.html) |
| `mobile` | [HTML/mobile.html](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/HTML/mobile.html) |
| `script` | [HTML/script.html](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/HTML/script.html) |
| `setup` | [HTML/setup.html](https://github.com/LukinoDeveloppino/PokePortfolio/blob/master/HTML/setup.html) |

Salva con l'icona del dischetto (o `Ctrl` + `S`). A sinistra devi vedere 9 file `.gs` e 4 file `.html`. Se un nome è sbagliato (per esempio `Desktop` o `desktop.html.html`), clicca sui tre puntini accanto al file e scegli **Rinomina**.

**Facoltativo, il fuso orario.** Gli aggiornamenti automatici usano il fuso orario del progetto. Dall'icona dell'ingranaggio a sinistra (**Impostazioni progetto**) controlla che sia il tuo, per esempio quello di Roma.

### 5. Pubblica l'app web

1. In alto a destra premi **Esegui il deployment → Nuovo deployment**.
2. Accanto a **Seleziona tipo** premi l'ingranaggio e scegli **App web**.
3. Compila così:
   - **Descrizione**: quello che vuoi, per esempio `prima versione`;
   - **Esegui come**: **Io** (con la tua email). L'app usa il tuo Drive per salvare i dati;
   - **Chi ha accesso**: **Chiunque**. Così anche i tuoi amici possono aprirla, senza bisogno di un account Google.
4. Premi **Esegui il deployment**.

**La schermata di autorizzazione.** La prima volta Google chiede il permesso di usare il tuo Drive, i tuoi fogli e la connessione a CardTrader:

1. premi **Autorizza accesso** e scegli il tuo account;
2. compare **"Google non ha verificato questa app"**. È normale: l'app l'hai creata tu e Google non l'ha controllata. Premi **Avanzate**, poi **Vai a PokéPortfolio (non sicuro)** (al posto di PokéPortfolio c'è il nome del tuo progetto);
3. controlla l'elenco dei permessi e premi **Consenti**.

Alla fine compare l'**URL dell'app web**, un indirizzo che finisce con `/exec`. Copialo: è il link della tua app.

### 6. Configurazione guidata al primo avvio

1. Apri il link `/exec` nel browser, con lo **stesso account Google** con cui hai creato il progetto.
2. Compare la pagina **Configurazione della tua installazione**, scheda **Nuova installazione**. Scegli un nome utente (almeno 3 caratteri), una password (almeno 6), ripetila e incolla la tua API key di CardTrader.
3. Premi **Configura PokéPortfolio**. In pochi secondi l'app crea nel tuo Drive il foglio **PokePortfolio - Master**, il tuo account e gli aggiornamenti automatici.
4. Compare **✓ PokéPortfolio è pronto**. Premi **Apri PokéPortfolio** ed entra con il nome utente e la password appena scelti.

Il catalogo si scarica da solo, a turni, in background. La prima volta ci vuole tempo, anche più di un'ora: finché non è pronto vedi **"Catalogo in preparazione"**. I set compaiono man mano: ricarica la pagina ogni tanto.

> Non cancellare il foglio **PokePortfolio - Master** dal Drive: contiene utenti e catalogo. Ogni utente ha anche un suo foglio personale, creato alla registrazione.

Se avevi già PokéPortfolio e hai ricreato il progetto, scegli la scheda **Ho già un foglio master** e incolla il link del tuo foglio master: utenti e collezioni restano come sono.

### 7. Usa l'app e invita gli amici

- **Versione mobile**: aggiungi `?mobile=1` in fondo al link, cioè `https://script.google.com/macros/s/.../exec?mobile=1`. Dal telefono puoi aggiungerla alla schermata Home dal menu del browser.
- **Amici**: manda loro il link `/exec`. Ognuno sceglie **Registrati** e crea il suo account. Per loro la API key CardTrader è facoltativa: se la lasciano vuota, l'app usa la tua.
- **Da sola**: ogni giorno, verso le 3 di notte, l'app aggiorna i prezzi di tutti; verso le 5 cerca i set nuovi.

### 8. Aggiornare il codice

Quando su GitHub esce una versione nuova:

1. nell'editor apri ogni file cambiato e sostituisci il contenuto con quello nuovo, come al passo 4. Se c'è un file nuovo, crealo con il suo nome;
2. salva;
3. premi **Esegui il deployment → Gestisci deployment**, seleziona il tuo deployment e premi la **matita** (Modifica);
4. in **Versione** scegli **Nuova versione** e premi **Esegui il deployment**.

Il link `/exec` resta lo stesso. Se salti i passi 3 e 4, il link continua a mostrare la versione vecchia. Se Google chiede di nuovo l'autorizzazione, ripeti i passi della schermata di autorizzazione.

### 9. Problemi frequenti

- **"App non ancora configurata" anche se il progetto è tuo**: il browser ti riconosce con un altro account Google. Apri il link in una finestra in incognito, accedi **solo** con l'account del progetto e riprova. Lo stesso vale per gli errori di autorizzazione quando nel browser hai più account Google aperti.
- **"Google non ha verificato questa app"**: è normale, vedi il passo 5.
- **Pagina bianca o errore su un file HTML che non si trova**: una pagina ha il nome sbagliato. Controlla i nomi del passo 4, poi crea una nuova versione del deployment (passo 8).
- **Hai cambiato il codice ma non vedi le novità**: manca la nuova versione del deployment (passo 8).
- **Il catalogo resta vuoto per ore**: la API key potrebbe essere sbagliata. Nel foglio **PokePortfolio - Master**, scheda **BATCH_STATE**, controlla la riga `default_token`. Nell'editor, alla voce **Esecuzioni** a sinistra, vedi se i processi automatici danno errori.
- **"Nome utente già in uso"** alla registrazione: scegline un altro.

---

## Come funziona

Questa parte è per chi è curioso di sapere com'è fatta l'app dentro.

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
             │  UTENTI, SET_CACHE,    │                  │  set, carte,       │
             │  CACHE_CARDS,          │                  │  prezzi            │
             │  BATCH_STATE           │                  └────────────────────┘
             └────────────────────────┘
             ┌────────────────────────┐
             │  Foglio per utente     │
             │  CONFIG, PORTFOLIO,    │
             │  WISHLIST, storici     │
             └────────────────────────┘
```

- **Configurazione**: nessun ID è scritto nel codice. Finché l'app non è configurata, `doGet` mostra `setup.html`. La configurazione salva l'ID del foglio master nelle **Proprietà script** (`MASTER_SHEET_ID`) con l'email del proprietario (`SETUP_OWNER`): chi copia il progetto ottiene un'installazione indipendente. Solo il proprietario del progetto può configurarla.
- **Foglio master**: il primo foglio (`UTENTI`) contiene gli utenti (username, hash SHA-256 della password, ID del foglio personale, API key CardTrader). Qui stanno anche il catalogo condiviso (`SET_CACHE`, `CACHE_CARDS`), lo stato dei processi automatici e la key di riserva `default_token` (`BATCH_STATE`).
- **Foglio personale**: viene creato alla registrazione, in una cartella Drive dedicata. Contiene `CONFIG` (impostazioni, compresi i set nascosti), `PORTFOLIO`, `WISHLIST` e gli storici dei prezzi.
- **Processi automatici**: la configurazione crea due trigger giornalieri, `updateAllUsersAllPrices` alle 3 e `syncCatalog` alle 5 (fuso orario del progetto), e avvia la prima sync del catalogo. Apps Script ferma ogni esecuzione dopo 6 minuti, quindi lavorano a turni: salvano a che punto sono arrivati in `BATCH_STATE` e si riprogrammano da soli per il turno successivo.
- **Sessioni**: al login viene generato un token che dura 24 ore.
- **Deployment**: il link `/exec` serve la versione pubblicata con l'ultimo deployment. Per provare le modifiche senza pubblicarle c'è il link `/dev` (**Esegui il deployment → Testa deployment**), che funziona solo per il proprietario.

### Struttura del repository

| Percorso | Contenuto |
|---|---|
| `Script/Codice.js` | Punto di ingresso (`doGet`), accesso ai fogli, configurazione |
| `Script/Setup.js` | Configurazione guidata: foglio master, primo account, trigger, prima sync |
| `Script/Auth.js` | Registrazione, login e sessioni |
| `Script/Cards.js` | Sync del catalogo da CardTrader, lettura dei set, set nascosti e aggiornamento dei set |
| `Script/Prices.js` | Prezzi in tempo reale, aggiornamento prezzi a turni, dashboard |
| `Script/Portfolio.js` | Gestione del portfolio ed export |
| `Script/Wishlist.js` | Gestione della lista dei desideri |
| `Script/Friends.js` | Portfolio degli amici in sola lettura |
| `Script/Utils.js` | Funzioni di supporto comuni |
| `HTML/setup.html` | Pagina della configurazione guidata |
| `HTML/desktop.html` | Interfaccia e stile desktop |
| `HTML/mobile.html` | Interfaccia e stile mobile |
| `HTML/script.html` | JavaScript del browser, condiviso da desktop e mobile |

---

## Crediti

- Dati di carte e prezzi: [CardTrader API](https://www.cardtrader.com/docs/api/full/reference)
- Loghi e date dei set: [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)
- Grafici: [Chart.js](https://www.chartjs.org/)

Pokémon e i nomi correlati sono marchi di Nintendo, Creatures Inc. e GAME FREAK inc. Questo progetto non è affiliato né approvato da loro.
