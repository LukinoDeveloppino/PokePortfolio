# Migrazione da Google Apps Script a server Node + PostgreSQL

Documento di passaggio di consegne: decisioni prese, stato attuale e prossimi passi. Aggiornato al 2 ottobre 2026.

---

## Regole da rispettare

- **Nessun merge fra `master` e `feat/backend-server`, mai.** Le due versioni vanno avanti in parallelo: `master` resta la versione Google Apps Script, `feat/backend-server` è la versione server. Si lavora solo sul branch indicato dall'utente, senza PR, merge o rebase fra i due. Se una modifica serve a entrambe, chiedere all'utente come portarla.
- **Niente PaaS.** L'app va sul VPS Oracle (vedi sotto). Non riproporre alternative a pagamento se l'utente non le chiede.
- **Niente segreti in chat o nella riga di comando**: API key e token DuckDNS stanno in `~/.config/pokeportfolio/server.env` sul PC e arrivano al server sullo standard input di SSH.
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
| Orari | Prezzi alle 03:00 e alle 15:00, set nuovi alle 05:00 (`TZ=Europe/Rome`) | Due aggiornamenti dei prezzi al giorno (in GAS era uno) |
| Database locale | `npm run db:local` (PostgreSQL scaricato via npm) | Sul PC dell'utente non ci sono né Docker né PostgreSQL |
| Hosting | **VPS Oracle Cloud, account Pay As You Go, entro le risorse Always Free** | Acceso 24/7, disco permanente, costo 0 €. Con Pay As You Go Oracle non recupera le macchine poco usate |
| Macchina | Una sola `VM.Standard.A1.Flex` (ARM), 2 OCPU, 12 GB, Ubuntu 24.04 | È il massimo gratuito; oltre si paga |
| Regione Oracle | Italy Northwest (Milan) o Germany Central (Frankfurt) | La home region non si cambia più dopo la registrazione |
| API key CardTrader | **Obbligatoria per ogni utente**, verificata con `/info` alla registrazione. I prezzi di un utente usano solo la sua key; quella del proprietario (`CARDTRADER_DEFAULT_TOKEN`) serve solo a sync e refresh del catalogo, e non si può usare per registrarsi | L'app diventa pubblica: con la key di default per tutti il limite di CardTrader del proprietario verrebbe saturato |
| Utenti importati senza key | Ricevono la key di default (migrazione `002` da `settings.default_token`, più un passo all'avvio da `CARDTRADER_DEFAULT_TOKEN`). La colonna resta **nullable** | In GAS avevano già una copia della key di default. Un `NOT NULL` nella migrazione fallirebbe (bloccando l'avvio) quando la key è solo nell'ambiente, perché la migrazione gira prima del passo all'avvio; il vincolo vero è nella registrazione. Utente senza key = nessuna chiamata a CardTrader |
| Installazione | Script in `deploy/`: `npm run installa`, `npm run db:trasferisci`, `npm run deploy`, `npm run password` | Un comando dal PC per ogni operazione, idempotenti, con `--dry-run` |
| Configurazione degli script | Nessun default personale: `SERVER`, `DOMINIO` (e le facoltative `CHIAVE`, `BRANCH`, `REPO_URL`) si leggono da `~/.config/pokeportfolio/server.env`, riga per riga, con precedenza alle variabili d'ambiente | Chiunque può installare la sua copia senza toccare gli script; sul PC del proprietario il file contiene già `SERVER` e `DOMINIO` del suo server |
| Documentazione pubblica | `README.md` = guida passo passo per principianti (Oracle, DuckDNS, `npm run installa`); `deploy/README.md` = riferimento tecnico degli script. La guida pubblica non cita `deploy`, `password`, `db:trasferisci` e `import` | Richiesta del proprietario: guida ridotta al minimo indispensabile |
| PostgreSQL sul server | **18 dal repository PGDG**, non il 16 di Ubuntu | Il PC ha il 18 (embedded-postgres) e `pg_restore` 16 non legge i dump custom del 18; stessa versione ovunque, pacchetti arm64 e aggiornamenti dal repository ufficiale |
| Trasferimento del database | `pg_dump` 18 del server attraverso un tunnel SSH inverso verso il PC | embedded-postgres non installa `pg_dump` sul PC; così non serve installare niente |
| Repository | Pubblico (verificato con `git ls-remote` anonimo): il server clona in HTTPS senza credenziali | Se diventa privato: deploy key read-only (vedi `deploy/README.md`) |
| Dominio | **`pokeportfolio.duckdns.org`** (DuckDNS, già puntato a `204.216.217.195`), IP aggiornato ogni 5 minuti da un timer sul server | Gratuito; Caddy ottiene il certificato Let's Encrypt da solo |
| Sicurezza del server | SSH solo con chiave + fail2ban, aggiornamenti automatici con riavvio alle 04:30, app su `127.0.0.1` dietro Caddy, servizio systemd con disco in sola lettura, PostgreSQL solo su localhost, header di sicurezza in Caddy, limite di 10 login/registrazioni al minuto per IP (`@fastify/rate-limit`) | Manutenzione zero: niente da fare a mano dopo l'installazione |
| Compressione | In Caddy (`encode zstd gzip`) invece di `@fastify/compress` | Un solo punto; gli storici da ~2 MB scendono a circa un decimo |
| CSP | Non impostata | Le pagine hanno molto JavaScript inline e risorse da cdnjs, Google Fonts, CardTrader e pokemontcg.io: una CSP andrebbe provata pagina per pagina nel browser. Ci sono `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy` e HSTS (solo con HTTPS) |

Stima del traffico: circa 1,4 GB al mese contro 10 TB gratuiti. Le immagini delle carte arrivano direttamente da CardTrader e pokemontcg.io, non dal server.

---

## Stato attuale

> **In produzione dal 1° ottobre 2026 su https://pokeportfolio.duckdns.org** (VPS Oracle Cloud, Milano, 204.216.217.195, Ubuntu 24.04 ARM). Installato con `npm run installa`, database copiato dal PC con `npm run db:trasferisci` (conteggi identici: 3 utenti, 507 voci, 84.225 punti di storico delle carte, 773 dello storico del valore, 124 set, 18.685 carte). Gli aggiornamenti si fanno con `npm run deploy`. Caddy è installato dal binario della release GitHub (versione fissa `VERSIONE_CADDY` in `deploy/installa-server.sh`) perché il repository apt di Caddy è firmato con una chiave scaduta.

**Branch `feat/backend-server`: l'app funziona in locale con i dati reali.**

- Backend completo: catalogo, autenticazione, portfolio, wishlist, prezzi, amici, export CSV, job notturni ed endpoint `/api/cron/<job>` protetto da `CRON_SECRET`.
- Dati importati da Google Sheets con `npm run import`: 3 utenti, 507 voci, 83.729 prezzi storici delle carte e 770 punti di storico del valore. I totali sono verificati al centesimo contro i fogli originali.
  - Abbinamento dei file: Lukino → `Lukino`, file `Astrid` → utente `snorlax`, file `Carcio` → utente `ndelpopolo` (`--abbina Astrid=snorlax --abbina Carcio=ndelpopolo`).
- Catalogo reale da CardTrader: 124 set e 18.685 carte; il refresh ha corretto i numeri alterati da Sheets.
- Provato nel browser (Chromium headless) desktop e mobile: registrazione, login, ricerca, aggiunta carte con prezzo in tempo reale, portfolio, wishlist, amici, export CSV, "Aggiorna tutti i set".
- 27 test automatici (`npm test`) su un database separato `<nome>_test`.
- API key CardTrader obbligatoria (vedi le decisioni). Sul database locale i 3 utenti importati hanno ancora la key vuota: la riceveranno al primo avvio del server con questa versione (migrazione `002`), sul PC o sul server dopo il trasferimento.
- Script di installazione e aggiornamento del VPS in `deploy/` (riferimento in `deploy/README.md`), usati per la messa in produzione. Dal 2 ottobre 2026 non hanno più default personali: server e dominio stanno nel file `server.env` del PC (vedi le decisioni).
- Guida pubblica per installare la propria copia nel `README.md` di questo branch; il `README.md` di `master` ha la guida della versione Apps Script.
- Il database locale è in `data/postgres/` (escluso da git), gli export `.xlsx` in `import/` (esclusi da git, contengono hash e API key).

### Difetti noti, già presenti in GAS e lasciati così

- `HTML/script.html:2346` chiama `reloadPortfolio` prima di `initApp()`: una chiamata senza token, rifiutata senza conseguenze.
- Sul grafico del prezzo mobile le etichette dell'asse sono arrotondate (compare "€2" due volte).

### Da sapere sui dati di origine

- Nel foglio `CONFIG` di un utente c'è una riga `password` **in chiaro**. L'import la ignora, ma resta nel foglio Google e nel file `.xlsx`: l'utente è stato avvisato di cambiarla.

---

## Prossimi passi

### 1. Oracle Cloud (fatto)

Account Pay As You Go e VM `VM.Standard.A1.Flex` creati; IP pubblico `204.216.217.195`, chiave SSH in `~/.ssh/pokeportfolio.key` sul PC.

### 2. Messa in produzione (fatta il 1° ottobre 2026)

1. Nella **Security List** della VCN su Oracle: regole di ingresso TCP per le porte **80** e **443** da `0.0.0.0/0`.
2. `~/.config/pokeportfolio/server.env` sul PC (permessi 600) con `SERVER`, `DOMINIO`, `CARDTRADER_DEFAULT_TOKEN` e `DUCKDNS_TOKEN`.
3. `git push origin feat/backend-server`, poi `npm run installa -- --dry-run` e `npm run installa`.
4. Con `npm run db:local` acceso: `npm run db:trasferisci`. Lo script confronta i conteggi fra PC e server.
5. Aprire https://pokeportfolio.duckdns.org e provare login, prezzi e portfolio.
6. Da lì in poi: `npm run deploy` dopo ogni `git push`.

### 3. Miglioramenti possibili, non ancora fatti

- **Cambio della API key dall'app**: oggi non c'è una schermata per farlo. Gli utenti importati usano la key del proprietario finché non ne viene impostata una loro (per ora solo a mano nel database).
- **Copia dei backup fuori dal server**: oggi stanno sulla stessa VM (c'è il comando per scaricarne uno sul PC in `deploy/README.md`).
- **Content-Security-Policy**, dopo averla provata nel browser su tutte le pagine.
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
| `npm run installa` | Installa o sistema il server (dal PC) |
| `npm run db:trasferisci` | Copia il database del PC sul server |
| `npm run deploy` | Aggiorna il server da GitHub |

Struttura del codice e variabili d'ambiente: vedi il `README.md`.
