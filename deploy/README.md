# Script del server: riferimento tecnico

La guida all'installazione, passo per passo, è nel [README principale](../README.md#installare-la-tua-copia). Qui ci sono i dettagli degli script di `deploy/`: cosa fanno, come si configurano e i comandi di manutenzione.

Tutti i comandi `npm run …` si lanciano **dal PC**, dalla cartella del progetto. Ogni script accetta `--dry-run`, che mostra cosa farebbe senza collegarsi al server.

| Comando | Script | Dove gira | A cosa serve |
|---|---|---|---|
| `npm run installa` | `installa.sh` → `installa-server.sh` | PC → server | Installa o sistema il server. Si può rilanciare |
| `npm run deploy` | `aggiorna.sh` → `remoto/aggiorna-sul-server.sh` | PC → server | Aggiorna l'app all'ultimo commit su GitHub |
| `npm run password -- <utente>` | `cambia-password.sh` | PC → server | Nuova password per un utente |
| `npm run db:trasferisci` | `trasferisci-database.sh` → `remoto/ricevi-database.sh` | PC → server | Sostituisce il database del server con quello del PC |

`comune.sh` contiene le parti in comune (impostazioni, opzioni SSH, controlli).

---

## Impostazioni

Gli script leggono le impostazioni da `~/.config/pokeportfolio/server.env` sul PC (permessi 600; un altro file con `FILE_SEGRETI=<percorso>`). Una riga per valore, `NOME=valore`, senza spazi né virgolette.

| Riga | Obbligatoria | Significato |
|---|---|---|
| `SERVER` | sì | Utente e IP del server, per esempio `ubuntu@1.2.3.4` |
| `DOMINIO` | sì, per `installa` | Dominio dell'app, per esempio `tuonome.duckdns.org`. `nessuno` = HTTP sull'IP, solo per prove |
| `CARDTRADER_DEFAULT_TOKEN` | sì, per `installa` | API key CardTrader usata dal server per il catalogo (segreta) |
| `DUCKDNS_TOKEN` | se il dominio è `*.duckdns.org` | Token di duckdns.org (segreto) |
| `CHIAVE` | no | Chiave SSH, predefinita `~/.ssh/pokeportfolio.key` |
| `BRANCH` | no | Branch da installare, predefinito `feat/backend-server` |
| `REPO_URL` | no | Repository da clonare, predefinito `https://github.com/LukinoDeveloppino/PokePortfolio.git` (per chi usa un fork) |

- Il file non viene eseguito: gli script leggono solo queste righe, una alla volta.
- Una variabile d'ambiente ha la precedenza sul file: `SERVER=ubuntu@5.6.7.8 npm run deploy`.
- Se manca `SERVER` o `DOMINIO`, lo script si ferma e dice quale riga aggiungere.
- Se il file non esiste, `npm run installa` lo crea vuoto (permessi 600) e si ferma.
- I segreti arrivano al server sullo **standard input** della connessione SSH: mai sulla riga di comando, mai nei log, mai nel repository. Al server arrivano solo `CARDTRADER_DEFAULT_TOKEN`, `DUCKDNS_TOKEN`, `DOMINIO`, `BRANCH` e `REPO_URL`.
- Dominio, branch e repository vengono controllati (anche sul server) prima di finire in un comando o nel Caddyfile.

---

## `npm run installa`

Copia `installa-server.sh` sul server e lo esegue con `sudo`. Ogni passo controlla cosa c'è già: rilanciarlo non cambia password del database, `.env` e dati. Sul server:

- Node.js 22 (NodeSource), **PostgreSQL 18** (repository ufficiale PGDG), Caddy (binario della release ufficiale su GitHub, con verifica del checksum SHA-512: il repository apt di Caddy è firmato con una chiave scaduta), git;
- **aggiornamenti automatici** ogni notte: sicurezza di Ubuntu e versioni minori di Node 22 e PostgreSQL 18. Se serve un riavvio avviene alle **04:30**, fra il giro dei prezzi (03:00) e quello dei set (05:00). Caddy ha una versione fissa (`VERSIONE_CADDY`): si aggiorna rilanciando l'installazione;
- **SSH solo con chiave** (password e accesso di root disattivati, configurazione verificata con `sshd -t` prima di applicarla) e **fail2ban** (5 errori in 10 minuti = IP bloccato per un'ora);
- utente di sistema `pokeportfolio` senza login, codice in `/opt/pokeportfolio`;
- database `pokeportfolio` con password casuale, raggiungibile solo dal server;
- `/opt/pokeportfolio/.env` (permessi 600) con database, API key, `HOST=127.0.0.1`, `SCHEDULER=true`;
- `npm ci --omit=dev` e migrazioni;
- servizio **systemd** `pokeportfolio` (avvio al boot, riavvio se si ferma, disco in sola lettura per l'app);
- **DuckDNS**: IP comunicato ogni 5 minuti (token in `/etc/pokeportfolio/duckdns.env`, root, 600);
- **Caddy** davanti all'app: HTTPS automatico con Let's Encrypt, compressione, header di sicurezza;
- **firewall**: porte 80 e 443 aperte in `iptables` (permanenti), SSH lasciato com'è;
- **backup** del database ogni notte alle 02:30 in `/var/backups/pokeportfolio` (ultimi 14);
- log di sistema limitati a 500 MB.

Dominio, repository e branch usati vengono ricordati in `/etc/pokeportfolio/installazione.conf`.

> **Perché PostgreSQL 18 e non il 16 di Ubuntu.** Sul PC il database di sviluppo è un PostgreSQL 18 (embedded-postgres) e `pg_restore` 16 non legge i dump fatti con `pg_dump` 18. Con la stessa versione ai due capi il trasferimento è un dump/restore diretto.

Le porte 80 e 443 vanno aperte anche nella **Security List** della rete su Oracle (vedi il README principale, passo 4): lo script non può farlo.

### Cambiare dominio

Cambia la riga `DOMINIO` (e se serve `DUCKDNS_TOKEN`) nel file delle impostazioni e rilancia `npm run installa`. Con `DOMINIO=nessuno` si passa all'HTTP sull'IP.

---

## `npm run deploy`

Il server scarica il codice da GitHub (branch `BRANCH`), non dal PC: chi ha modifiche sue fa prima `git push`. Lo script avvisa se sul PC ci sono commit non pubblicati e chiede se continuare (`--si` per non chiedere).

Sul server: controlla che il codice non sia stato modificato a mano, scarica da GitHub (se non c'è niente di nuovo si ferma), fa un **backup** del database, porta il codice all'ultimo commit, esegue `npm ci` solo se `package-lock.json` è cambiato, applica le migrazioni, riavvia e controlla `/api/health`. Se l'app non risponde **torna da sola al commit di prima**.

Una migrazione già applicata non si annulla tornando al commit di prima: in quel caso c'è il backup `pokeportfolio-aggiornamento-*.dump` (vedi [Ripristinare un backup](#ripristinare-un-backup)).

---

## `npm run password -- <utente>`

Si collega al server e avvia `server/scripts/cambia-password.js` come utente `pokeportfolio`. La nuova password si digita due volte nel terminale, senza che compaia. Viene salvata come hash scrypt e le sessioni aperte dell'utente vengono chiuse. Serve un terminale interattivo normale.

---

## `npm run db:trasferisci`

Sostituisce il database del server con quello del PC (prima ne fa un backup). Serve una volta, per esempio dopo aver importato i dati della versione Google Sheets sul PC.

```bash
npm run db:local                      # primo terminale
npm run db:trasferisci -- --dry-run   # secondo terminale: controllo
npm run db:trasferisci
```

embedded-postgres non installa `pg_dump` sul PC: lo script apre un tunnel SSH inverso e il `pg_dump` 18 del server legge il database del PC attraverso la connessione SSH (nessuna porta aperta, niente da installare sul PC). Poi ferma l'app, fa `pg_restore`, la riavvia e confronta i conteggi fra PC e server. Il dump resta in `/var/backups/pokeportfolio/pokeportfolio-dal-pc-*.dump`. Porta del PostgreSQL del PC: `DB_LOCAL_PORT`, predefinita 5432.

### Import dalla versione Google Sheets

1. In Google Drive scarica il foglio master e ogni foglio utente con **File → Scarica → Microsoft Excel (.xlsx)**, lasciando i nomi proposti (`PokePortfolio - Master.xlsx`, `PokePortfolio-<utente>.xlsx`).
2. Mettili nella cartella `import/` del progetto (esclusa da git).
3. Con `npm run db:local` acceso e il database vuoto: `npm run import`. Se il nome nel file di un utente non coincide con il suo username nel master: `npm run import -- --abbina <nome-nel-file>=<username>`.
4. `npm run job -- catalog-refresh` corregge i numeri delle carte alterati da Sheets (per esempio "012" diventato 12).
5. `npm run db:trasferisci` copia tutto sul server.

L'import avviene in una sola transazione. Gli export contengono hash delle password e API key: dopo l'import cancella la cartella `import/`.

---

## Manutenzione sul server

Per entrare nel server: `ssh -i ~/.ssh/pokeportfolio.key ubuntu@<IP-del-tuo-server>` (`exit` per uscire).

| Comando | Cosa fa |
|---|---|
| `sudo systemctl status pokeportfolio` | Stato dell'app |
| `sudo journalctl -u pokeportfolio -f` | Log in diretta (Ctrl+C per uscire) |
| `sudo systemctl restart pokeportfolio` | Riavvio dell'app |
| `sudo -u postgres pokeportfolio-backup` | Backup manuale |
| `sudo ls -lh /var/backups/pokeportfolio` | Elenco dei backup |
| `systemctl list-timers 'pokeportfolio-*'` | Prossimo backup e prossimo aggiornamento DuckDNS |
| `sudo journalctl -u pokeportfolio-duckdns -n 20` | Esito degli aggiornamenti DuckDNS |
| `sudo journalctl -u caddy -n 50` | Log di Caddy (certificato HTTPS) |
| `sudo fail2ban-client status sshd` | IP bloccati da fail2ban |
| `cat /var/log/unattended-upgrades/unattended-upgrades.log` | Aggiornamenti automatici installati |

### Lanciare un job a mano

```bash
sudo -u pokeportfolio -H bash -c 'cd /opt/pokeportfolio && node --env-file=.env server/scripts/job.js catalog-sync'
```

Al posto di `catalog-sync` (set nuovi): `catalog-refresh` (ricontrolla tutti i set) o `prices` (prezzi di tutti gli utenti). Se lo stesso job è già in corso, il comando lo dice e si ferma.

### Copiare un backup sul PC

Dal PC, l'ultimo backup:

```bash
ssh -i ~/.ssh/pokeportfolio.key ubuntu@<IP-del-tuo-server> \
  'sudo sh -c "cat \$(ls -1t /var/backups/pokeportfolio/*.dump | head -n 1)"' > pokeportfolio-backup.dump
```

### Ripristinare un backup

Sul server:

```bash
sudo ls -lh /var/backups/pokeportfolio
sudo systemctl stop pokeportfolio
sudo -u postgres pg_restore -d pokeportfolio --clean --if-exists --no-owner --no-acl \
  --role=pokeportfolio --single-transaction /var/backups/pokeportfolio/<file>.dump
sudo systemctl start pokeportfolio
```

### Repository privato

Il repository è pubblico e il server lo scarica in HTTPS senza credenziali. Se un fork è privato, installazione e aggiornamenti si fermano con un messaggio. Per sistemare, sul server:

```bash
sudo -u pokeportfolio mkdir -p -m 700 /var/lib/pokeportfolio/.ssh
sudo -u pokeportfolio -H ssh-keygen -t ed25519 -N '' -f /var/lib/pokeportfolio/.ssh/id_ed25519
sudo cat /var/lib/pokeportfolio/.ssh/id_ed25519.pub
```

Su GitHub: repository → **Settings → Deploy keys → Add deploy key**, incolla la chiave, **senza** "Allow write access". Poi, sul server:

```bash
sudo -u pokeportfolio -H ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # risponde "successfully authenticated"
sudo -u pokeportfolio git -C /opt/pokeportfolio remote set-url origin git@github.com:<proprietario>/<repository>.git
```

Per una nuova installazione da un fork privato metti `REPO_URL=git@github.com:<proprietario>/<repository>.git` nel file delle impostazioni.

### Problemi

- **Il sito non si apre**: controlla la Security List su Oracle (porte 80 e 443) e `sudo systemctl status pokeportfolio caddy`.
- **HTTPS non funziona**: il dominio deve puntare all'IP del server (`getent hosts tuonome.duckdns.org`) e la porta 80 deve essere aperta. Guarda `sudo journalctl -u caddy -n 50`.
- **SSH rifiuta la chiave**: `chmod 600 ~/.ssh/pokeportfolio.key`. Dopo troppi errori fail2ban blocca il tuo IP per un'ora.
