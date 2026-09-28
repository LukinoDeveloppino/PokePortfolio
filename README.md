# PokéPortfolio

Web app per gestire la propria collezione di carte Pokémon: catalogo completo dei set, portfolio con valore aggiornato dai prezzi di **CardTrader**, lista dei desideri e condivisione della collezione con gli amici.

Gira su un server **Node.js** con i dati in **PostgreSQL**: in locale sul tuo PC oppure su un servizio cloud (PaaS). La prima versione girava su Google Apps Script con i dati in Google Sheets; da lì si importa tutto con un comando (vedi [Importare i dati da Google Sheets](#importare-i-dati-da-google-sheets)).

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
┌──────────────┐   POST /api/rpc/…   ┌────────────────────────┐        ┌────────────────────┐
│  Browser     │ ──────────────────▶ │  Server Node (Fastify) │ ─────▶ │  API CardTrader    │
│  desktop /   │                     │  server/src            │        │  set, carte,       │
│  mobile      │ ◀────────────────── │  + job notturni        │        │  prezzi            │
└──────────────┘                     └───────────┬────────────┘        └────────────────────┘
                                                 │
                                                 ▼
                                     ┌────────────────────────┐
                                     │  PostgreSQL            │
                                     │  utenti, sessioni,     │
                                     │  catalogo, collezioni, │
                                     │  storici dei prezzi    │
                                     └────────────────────────┘
```

- **Frontend**: le pagine in `HTML/` sono quelle della versione Apps Script, servite così come sono. `server/public/gas-shim.js` ricrea `google.script.run` sopra `fetch`: ogni chiamata diventa `POST /api/rpc/<funzione>` con gli stessi argomenti e la stessa risposta di prima.
- **Database**: lo schema è in `server/src/db/migrations/`. Le migrazioni si applicano da sole all'avvio del server.
- **Job notturni**: alle 03:00 si aggiornano i prezzi di tutti gli utenti (con gli storici), alle 05:00 si scaricano i set nuovi. Senza il limite di 6 minuti di Apps Script ogni job gira dall'inizio alla fine, e la tabella `job_runs` impedisce due esecuzioni sovrapposte.
- **Sessioni**: al login viene generato un token che dura 24 ore. Ogni login ha la sua sessione, quindi più persone (e più dispositivi) restano collegate insieme. Le password sono salvate con scrypt.

### Struttura del repository

| Percorso | Contenuto |
|---|---|
| `server/src/index.js`, `app.js` | Avvio del server e registrazione delle rotte |
| `server/src/config.js` | Configurazione dalle variabili d'ambiente |
| `server/src/db/` | Connessione a PostgreSQL e migrazioni dello schema |
| `server/src/routes/rpc.js` | Le funzioni chiamate dal frontend |
| `server/src/routes/pagine.js` | Pagine desktop e mobile |
| `server/src/services/` | Logica: catalogo, prezzi, portfolio e wishlist, amici, autenticazione, client CardTrader |
| `server/src/jobs/scheduler.js` | Job notturni ed endpoint per un cron esterno |
| `server/src/import/sheets.js` | Import dei dati della versione Google Sheets |
| `server/scripts/` | Comandi da terminale (`npm run …`) |
| `server/test/` | Test automatici |
| `HTML/` | Interfaccia desktop e mobile e JavaScript del browser |
| `Script/`, `HTML/setup.html` | Versione Google Apps Script, non più usata dal server |

---

## Installazione in locale

Ti servono **Node.js 22** o successivo e un'API key di **CardTrader** (la trovi nella sezione API delle impostazioni del profilo su [cardtrader.com](https://www.cardtrader.com)).

```bash
npm install
cp .env.example .env        # poi scrivi la key in CARDTRADER_DEFAULT_TOKEN
```

Avvia PostgreSQL in un altro terminale. Senza Docker:

```bash
npm run db:local            # PostgreSQL scaricato via npm, dati in ./data/postgres
```

oppure con Docker: `docker compose up -d`. Poi:

```bash
npm run dev                 # http://localhost:3000, si riavvia a ogni modifica
```

Apri `http://localhost:3000`, registrati dalla pagina di accesso e scarica il catalogo con `npm run job -- catalog-sync`. La prima volta ci vuole un po': sono centinaia di set. Per la versione mobile apri `http://localhost:3000/?mobile=1`.

### Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Server di sviluppo con riavvio automatico |
| `npm start` | Server in modalità normale |
| `npm run db:local` | PostgreSQL locale senza Docker |
| `npm run migrate` | Applica le migrazioni dello schema |
| `npm run job -- catalog-sync` | Scarica i set non ancora in catalogo |
| `npm run job -- catalog-refresh` | Ricontrolla tutti i set e riscrive quelli cambiati |
| `npm run job -- prices` | Aggiorna i prezzi di tutti gli utenti e gli storici |
| `npm run import` | Importa i dati della versione Google Sheets |
| `npm run db:reset -- --conferma` | Cancella tutti i dati del database indicato da `DATABASE_URL` |
| `npm test` | Test automatici, su un database separato `<nome>_test` |

### Variabili d'ambiente

| Variabile | Descrizione |
|---|---|
| `DATABASE_URL` | Connessione a PostgreSQL (obbligatoria) |
| `DATABASE_SSL` | `true` per i database gestiti che richiedono SSL |
| `PORT` | Porta HTTP, predefinita 3000 |
| `TZ` | Fuso orario dei job e delle date, predefinito `Europe/Rome` |
| `CARDTRADER_DEFAULT_TOKEN` | API key per il catalogo e per gli utenti senza key personale |
| `SCHEDULER` | `false` per disattivare i job interni |
| `CRON_SECRET` | Abilita `POST /api/cron/prices` e `/api/cron/catalog-sync` |

---

## Importare i dati da Google Sheets

1. In Google Drive apri il foglio master e ogni foglio utente e scarica ciascuno con **File → Scarica → Microsoft Excel (.xlsx)**. Lascia i nomi proposti: `PokePortfolio - Master.xlsx` e `PokePortfolio-<utente>.xlsx`.
2. Mettili nella cartella `import/` del progetto (è esclusa da git).
3. Con il database vuoto lancia `npm run import`.

   Se il nome nel file di un utente non coincide con il suo username nel master (succede quando il foglio è stato rinominato), abbinalo a mano: `npm run import -- --abbina Astrid=snorlax`.

Vengono importati utenti (con la password di prima), API key personali, catalogo, set nascosti, portfolio, lista dei desideri, storico dei prezzi di ogni carta e storico del valore del portfolio. L'import avviene in una sola transazione: se qualcosa non va il database resta com'era. Alla fine conviene lanciare `npm run job -- catalog-refresh`, che corregge i numeri delle carte alterati da Sheets (per esempio "012" diventato 12).

Gli export contengono gli hash delle password e le API key, e nelle versioni più vecchie `CONFIG` può avere anche una riga `password` in chiaro, che l'import ignora. Dopo l'import conviene cancellare la cartella `import/`.

---

## Pubblicazione su un PaaS

L'app è un normale servizio web con un `Dockerfile` e l'health check su `/api/health`.

1. Crea un database PostgreSQL gestito (per esempio Neon, Supabase o quello del PaaS) e copia la stringa di connessione.
2. Crea il servizio web dal repository e imposta le variabili: `DATABASE_URL`, `DATABASE_SSL=true` se il database lo richiede, `CARDTRADER_DEFAULT_TOKEN`, `TZ`.
3. Per importare i dati, lancia `npm run import` dal tuo PC con `DATABASE_URL` che punta al database cloud.

Se il piano del PaaS mette in pausa l'app quando nessuno la usa, i job interni non partono. In quel caso imposta `SCHEDULER=false` e `CRON_SECRET`, e fai chiamare ogni notte a un servizio di cron esterno:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<la-tua-app>/api/cron/prices
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<la-tua-app>/api/cron/catalog-sync
```

---

## Crediti

- Dati di carte e prezzi: [CardTrader API](https://www.cardtrader.com/docs/api/full/reference)
- Loghi e date dei set: [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)
- Grafici: [Chart.js](https://www.chartjs.org/)
- Server: [Fastify](https://fastify.dev/), [node-postgres](https://node-postgres.com/), [Croner](https://croner.56k.guru/), [ExcelJS](https://github.com/exceljs/exceljs)

Pokémon e i nomi correlati sono marchi di Nintendo, Creatures Inc. e GAME FREAK inc. Questo progetto non è affiliato né approvato da loro.
