# Migrazione da Google Apps Script a server Node + PostgreSQL

Documento di passaggio di consegne: decisioni prese, stato attuale e prossimi passi. Aggiornato al 28 settembre 2026.

---

## Regole da rispettare

- **Nessun merge fra `master` e `feat/backend-server`, mai.** Le due versioni vanno avanti in parallelo: `master` resta la versione Google Apps Script, `feat/backend-server` è la versione server. Si lavora solo sul branch indicato dall'utente, senza PR, merge o rebase fra i due. Se una modifica serve a entrambe, chiedere all'utente come portarla.
- **Niente PaaS.** L'app va su un VPS (vedi sotto). Non riproporre alternative a pagamento se l'utente non le chiede.
- Password e API key non vanno mai nei commit: `.env`, `import/` e `data/` sono esclusi da git.

---

## Decisioni prese

| Tema | Decisione | Motivo |
|---|---|---|
| Stack | Node.js 22 + Fastify + PostgreSQL (`pg`), job con `croner` | Il codice GAS era già JavaScript: la logica si è portata quasi riga per riga |
| Database | PostgreSQL | Gira identico in locale e sul server; i dati sono relazionali |
| Frontend | Le pagine in `HTML/` restano quelle della versione GAS | `server/public/gas-shim.js` ricrea `google.script.run` sopra `fetch`; ogni chiamata diventa `POST /api/rpc/<funzione>` con gli stessi argomenti e le stesse risposte |
| Sessioni | Tabella `sessions`, token di 24 ore, uno per login | In GAS stavano nelle UserProperties del proprietario: esisteva una sola sessione valida alla volta |
| Password | scrypt con salt | Gli hash SHA-256 importati da Sheets vengono convertiti al primo login riuscito |
| Job | Un ciclo unico per job, senza turni | Il limite di 6 minuti di GAS non esiste più; `job_runs` impedisce esecuzioni sovrapposte |
| Orari | Prezzi alle 03:00, set nuovi alle 05:00 (`TZ=Europe/Rome`) | Stessi orari dei trigger GAS |
| Database locale | `npm run db:local` (PostgreSQL scaricato via npm) | Sul PC dell'utente non ci sono né Docker né PostgreSQL |
| Hosting | **VPS Oracle Cloud, account Pay As You Go, entro le risorse Always Free** | Acceso 24/7, disco permanente, costo 0 €. Con Pay As You Go Oracle non recupera le macchine poco usate |
| Macchina | Una sola `VM.Standard.A1.Flex` (ARM), 2 OCPU, 12 GB, Ubuntu 24.04 | È il massimo gratuito; oltre si paga |
| Regione Oracle | Italy Northwest (Milan) o Germany Central (Frankfurt) | La home region non si cambia più dopo la registrazione |

Stima del traffico: circa 1,4 GB al mese contro 10 TB gratuiti. Le immagini delle carte arrivano direttamente da CardTrader e pokemontcg.io, non dal server.

---

## Stato attuale

**Branch `feat/backend-server`: l'app funziona in locale con i dati reali.**

- Backend completo: catalogo, autenticazione, portfolio, wishlist, prezzi, amici, export CSV, job notturni ed endpoint `/api/cron/<job>` protetto da `CRON_SECRET`.
- Dati importati da Google Sheets con `npm run import`: 3 utenti, 507 voci, 83.729 prezzi storici delle carte e 770 punti di storico del valore. I totali sono verificati al centesimo contro i fogli originali.
  - Abbinamento dei file: Lukino → `Lukino`, file `Astrid` → utente `snorlax`, file `Carcio` → utente `ndelpopolo` (`--abbina Astrid=snorlax --abbina Carcio=ndelpopolo`).
- Catalogo reale da CardTrader: 124 set e 18.685 carte; il refresh ha corretto i numeri alterati da Sheets.
- Provato nel browser (Chromium headless) desktop e mobile: registrazione, login, ricerca, aggiunta carte con prezzo in tempo reale, portfolio, wishlist, amici, export CSV, "Aggiorna tutti i set".
- 21 test automatici (`npm test`) su un database separato `<nome>_test`.
- Il database locale è in `data/postgres/` (escluso da git), gli export `.xlsx` in `import/` (esclusi da git, contengono hash e API key).

### Difetti noti, già presenti in GAS e lasciati così

- `HTML/script.html:2346` chiama `reloadPortfolio` prima di `initApp()`: una chiamata senza token, rifiutata senza conseguenze.
- Sul grafico del prezzo mobile le etichette dell'asse sono arrotondate (compare "€2" due volte).

### Da sapere sui dati di origine

- Nel foglio `CONFIG` di un utente c'è una riga `password` **in chiaro**. L'import la ignora, ma resta nel foglio Google e nel file `.xlsx`: l'utente è stato avvisato di cambiarla.

---

## Prossimi passi

### 1. Oracle Cloud (lo fa l'utente)

1. Registrazione su oracle.com/cloud/free:
   - **Account Type: Individual** (non serve un'azienda);
   - **Cloud Account Name**: un nome univoco a piacere, non modificabile;
   - **Home Region**: Milan o Frankfurt.
2. Subito dopo: *Billing & Cost Management → Upgrade and Manage Payment* → **Pay As You Go**.
3. *Billing → Budgets*: budget con avviso a **1 €**.
4. *Compute → Instances → Create instance*: Ubuntu 24.04, forma `VM.Standard.A1.Flex` con **2 OCPU e 12 GB** ("Always Free-eligible"). Scaricare e conservare la chiave SSH.
5. Se compare *Out of capacity*: riprovare più tardi o cambiare *availability domain*.
6. Comunicare a Claude l'**IP pubblico** e se c'è un dominio da usare (altrimenti se ne sceglie uno gratuito).

### 2. Script di installazione per il VPS (da preparare nel branch)

Uno script unico da lanciare sul server che:

1. installa Node.js 22, PostgreSQL (dai pacchetti di Ubuntu, non `embedded-postgres`) e Caddy;
2. crea utente e database PostgreSQL, raggiungibili solo in locale;
3. clona il branch `feat/backend-server`, esegue `npm ci --omit=dev` e scrive `.env` (`DATABASE_URL`, `CARDTRADER_DEFAULT_TOKEN`, `TZ=Europe/Rome`, `NODE_ENV=production`);
4. crea un servizio **systemd** per l'app (avvio al boot, riavvio automatico). Con il processo sempre acceso bastano i job interni (`SCHEDULER=true`);
5. configura **Caddy** come reverse proxy con HTTPS automatico verso la porta 3000;
6. apre solo le porte 22, 80 e 443, sia nel firewall di Ubuntu sia nelle *Security List* della rete Oracle. Le immagini Ubuntu di Oracle hanno regole `iptables` restrittive di serie.

Il server è ARM: Node, PostgreSQL e Caddy hanno pacchetti arm64; `embedded-postgres` non serve in produzione.

### 3. Trasferimento del database

- Dal PC: `pg_dump` del database locale (formato custom), da fare con `npm run db:local` acceso.
- Copia del file sul VPS con `scp`, poi `pg_restore` nel database del server.
- In alternativa si rifà l'import dagli `.xlsx` sul server e poi `npm run job -- catalog-sync`, ma si perdono il refresh e il giro prezzi già fatti.
- Verifica: stessi conteggi per utente (voci, punti di storico, valore del portfolio) fra locale e server.

### 4. Miglioramenti proposti, non ancora fatti

- **Compressione delle risposte** (`@fastify/compress`): gli storici arrivano a circa 2 MB per l'utente con la wishlist più grande e compressi pesano circa un decimo.
- **Backup notturno** del database sul VPS (`pg_dump` a rotazione).
- Eventuale rimozione di `Script/` e `HTML/setup.html` **da questo branch** (il server non li usa). Su `master` restano.

---

## Riferimenti rapidi

| Comando | Cosa fa |
|---|---|
| `npm run db:local` | PostgreSQL locale (primo terminale) |
| `npm run dev` | Server di sviluppo su `http://localhost:3000` (secondo terminale) |
| `npm test` | Test automatici |
| `npm run job -- catalog-sync` / `catalog-refresh` / `prices` | Job a mano |
| `npm run import -- --abbina <file>=<utente>` | Import dagli export di Google Sheets |
| `npm run db:reset -- --conferma` | Cancella tutti i dati del database di `DATABASE_URL` |

Struttura del codice e variabili d'ambiente: vedi il `README.md`.
