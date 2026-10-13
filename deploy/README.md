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
| `OCI_BUCKET_BACKUP` | no | Bucket di Oracle Object Storage su cui copiare ogni backup (vedi [Backup su Oracle Object Storage](#backup-su-oracle-object-storage)). `nessuno` = copia spenta. Non è segreto |
| `OCI_NAMESPACE` | no | Namespace Object Storage della tenancy; se manca lo ricava il server con la OCI CLI |

- Il file non viene eseguito: gli script leggono solo queste righe, una alla volta.
- Una variabile d'ambiente ha la precedenza sul file: `SERVER=ubuntu@5.6.7.8 npm run deploy`.
- Se manca `SERVER` o `DOMINIO`, lo script si ferma e dice quale riga aggiungere.
- Se il file non esiste, `npm run installa` lo crea vuoto (permessi 600) e si ferma.
- I segreti arrivano al server sullo **standard input** della connessione SSH: mai sulla riga di comando, mai nei log, mai nel repository. Al server arrivano solo `CARDTRADER_DEFAULT_TOKEN`, `DUCKDNS_TOKEN`, `DOMINIO`, `BRANCH`, `REPO_URL` e, se ci sono, `OCI_BUCKET_BACKUP` e `OCI_NAMESPACE`.
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
- facoltativa, con `OCI_BUCKET_BACKUP`: **copia di ogni backup su Oracle Object Storage** (OCI CLI in `/opt/oci-cli`, autenticazione come istanza, vedi sotto);
- log di sistema limitati a 500 MB.

Dominio, repository, branch, bucket e namespace usati vengono ricordati in `/etc/pokeportfolio/installazione.conf`: togliendo una riga dal file delle impostazioni il server continua a usare l'ultimo valore.

> **Perché PostgreSQL 18 e non il 16 di Ubuntu.** Sul PC il database di sviluppo è un PostgreSQL 18 (embedded-postgres) e `pg_restore` 16 non legge i dump fatti con `pg_dump` 18. Con la stessa versione ai due capi il trasferimento è un dump/restore diretto.

Le porte 80 e 443 vanno aperte anche nella **Security List** della rete su Oracle (vedi il README principale, passo 4): lo script non può farlo.

### Cambiare dominio

Cambia la riga `DOMINIO` (e se serve `DUCKDNS_TOKEN`) nel file delle impostazioni e rilancia `npm run installa`. Con `DOMINIO=nessuno` si passa all'HTTP sull'IP.

---

## `npm run deploy`

Il server scarica il codice da GitHub (branch `BRANCH`), non dal PC: chi ha modifiche sue fa prima `git push`. Lo script avvisa se sul PC ci sono commit non pubblicati e chiede se continuare (`--si` per non chiedere).

Sul server: controlla che il codice non sia stato modificato a mano, scarica da GitHub (se non c'è niente di nuovo si ferma), fa un **backup** del database (e, se attiva, la sua copia su Object Storage: se la copia non riesce compare solo un avviso), porta il codice all'ultimo commit, esegue `npm ci` solo se `package-lock.json` è cambiato, applica le migrazioni, riavvia e controlla `/api/health`. Se l'app non risponde **torna da sola al commit di prima**.

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
| `sudo -u postgres pokeportfolio-backup` | Backup manuale (solo locale) |
| `sudo systemctl start pokeportfolio-backup` | Backup come quello notturno, poi copia su Object Storage se attiva |
| `sudo journalctl -u 'pokeportfolio-backup*' -n 50` | Esito dei backup e delle copie su Object Storage |
| `systemctl --failed` | Servizi falliti (anche una copia su Object Storage non riuscita) |
| `sudo ls -lh /var/backups/pokeportfolio` | Elenco dei backup |
| `systemctl list-timers 'pokeportfolio-*'` | Prossimo backup e prossimo aggiornamento DuckDNS |
| `sudo journalctl -u pokeportfolio-duckdns -n 20` | Esito degli aggiornamenti DuckDNS |
| `sudo journalctl -u caddy -n 50` | Log di Caddy (certificato HTTPS) |
| `sudo fail2ban-client status sshd` | IP bloccati da fail2ban |
| `cat /var/log/unattended-upgrades/unattended-upgrades.log` | Aggiornamenti automatici installati |

### Backup su Oracle Object Storage

Facoltativa: con la riga `OCI_BUCKET_BACKUP=<nome-bucket>` nel file delle impostazioni, ogni backup viene copiato anche in un bucket privato di Oracle Object Storage, così resta anche se il disco della VM si perde. I passi su Oracle (bucket, regola di lifecycle, dynamic group, policy) sono nel README principale, sezione [Backup anche fuori dal server](../README.md#backup-anche-fuori-dal-server-facoltativo). Poi `npm run installa`.

**Cosa installa** `installa-server.sh` (sezione 10b):

- la **OCI CLI** ufficiale da PyPI in un virtualenv Python in `/opt/oci-cli` (pacchetto `python3-venv`), con il collegamento `/usr/local/bin/oci`. Niente script scaricati ed eseguiti. A ogni `npm run installa` lo script lancia `pip install --upgrade oci-cli`: per aggiornare la CLI basta rilanciare l'installazione. La cartella è leggibile solo da root e dal gruppo `pokeportfolio-backup`;
- l'utente di sistema **`pokeportfolio-backup`**, senza login e senza home. Può solo **leggere** la cartella dei backup: la cartella resta di `postgres`, ma ha il gruppo `pokeportfolio-backup` con permessi 2750, e i dump nuovi nascono 640;
- `/etc/pokeportfolio/backup-remoto.conf` (bucket e namespace, nessun segreto);
- lo script `/usr/local/sbin/pokeportfolio-backup-remoto` e la unit **`pokeportfolio-backup-remoto@<etichetta>.service`**, eseguita come `pokeportfolio-backup` con le protezioni di systemd (disco in sola lettura, niente privilegi, solo rete);
- un drop-in `pokeportfolio-backup.service.d/remoto.conf` con `OnSuccess=pokeportfolio-backup-remoto@notte.service`: la copia parte **solo dopo un backup notturno riuscito**.

L'autenticazione è solo con l'**instance principal**: è la VM a essere autorizzata, tramite il dynamic group e la policy. Sul server non c'è nessuna chiave API e nessun file `~/.oci/config`. Alla fine dell'installazione lo script prova in sola lettura (`oci os bucket get` e `oci os object list`). Se la prova non riesce compare un avviso con le cause probabili, e il resto dell'installazione continua.

**Nomi degli oggetti**: `pokeportfolio/<anno>/<nome del file>`, per esempio `pokeportfolio/2026/pokeportfolio-notte-20261002-023000.dump`. Il nome contiene data e ora, quindi è sempre nuovo.

**Niente cancellazioni né sovrascritture.** La policy dà alla VM solo `OBJECT_CREATE` e `OBJECT_INSPECT`: può caricare oggetti nuovi ed elencarli, ma non può leggerli, cancellarli o sovrascriverli. Le copie vecchie le cancella la regola di lifecycle del bucket (30 giorni). Lo script:

- controlla con `oci os object list` che il nome sia libero; se l'oggetto esiste già si ferma con un errore;
- carica con `oci os object put --no-multipart --content-md5 … --verify-checksum` **senza `--force`**. Così la CLI fa una `HeadObject` e, se il nome è libero, carica con `If-None-Match: *`: anche un oggetto comparso nel frattempo non viene toccato. In più, senza il permesso `OBJECT_OVERWRITE`, Object Storage rifiuta comunque una sovrascrittura;
- in caso di errore riprova fino a 3 volte, a un minuto di distanza. Se dopo un errore di rete l'oggetto risulta già caricato con lo stesso MD5, il caricamento conta come riuscito.

**Se qualcosa non va**: il backup locale resta valido. Un `pg_dump` fallito lascia in stato *failed* `pokeportfolio-backup.service`, con la riga `[BACKUP LOCALE FALLITO]`, e la copia non parte. Una copia fallita lascia in stato *failed* `pokeportfolio-backup-remoto@notte.service`, con la riga `[BACKUP REMOTO FALLITO]`. Tutte e due si vedono con `systemctl --failed` e nel journal. Prima di un aggiornamento (`npm run deploy`) la copia è `pokeportfolio-backup-remoto@aggiornamento.service`: se non riesce, l'aggiornamento continua con un avviso.

**Prova manuale**, sul server:

```bash
sudo systemctl start pokeportfolio-backup.service        # backup locale; la copia parte subito dopo
sleep 30                                                  # il tempo di caricare il file
systemctl status --no-pager 'pokeportfolio-backup-remoto@notte.service'
sudo journalctl -u pokeportfolio-backup -u 'pokeportfolio-backup-remoto@*' -n 30 --no-pager
```

Se va tutto bene, l'ultima riga del journal dice `Copiato su Object Storage: pokeportfolio/<anno>/…`. Per l'elenco degli oggetti nel bucket (namespace in `/etc/pokeportfolio/backup-remoto.conf`):

```bash
sudo oci os object list --auth instance_principal --namespace <namespace> \
  --bucket-name <nome-bucket> --prefix pokeportfolio/ --all \
  --fields name,size,timeCreated --query 'data[].[name,size,"time-created"]' --output table
```

Per spegnere la copia: `OCI_BUCKET_BACKUP=nessuno` nel file delle impostazioni, poi `npm run installa`. Gli oggetti già caricati restano nel bucket finché la regola di lifecycle non li cancella.

> **Rischio residuo.** L'instance principal vale per tutta la VM: un processo qualunque della VM che può usare la rete potrebbe chiedere le credenziali al servizio dei metadati di Oracle, anche senza la CLI, e caricare o elencare oggetti nel bucket. La cartella della CLI chiusa agli altri utenti limita solo l'uso più semplice. Il rischio è accettabile: la policy non permette di leggere, cancellare o sovrascrivere i backup, e copre solo questo bucket.

### Lanciare un job a mano

```bash
sudo -u pokeportfolio -H bash -c 'cd /opt/pokeportfolio && node --env-file=.env server/scripts/job.js catalog-sync'
```

Al posto di `catalog-sync` (set nuovi): `catalog-refresh` (ricontrolla tutti i set), `prices` (prezzi di tutti gli utenti) o `tcg-sync` (carte da gioco per collezione e mazzi). Se lo stesso job è già in corso, il comando lo dice e si ferma.

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

### Ripristinare da un backup su Object Storage

Dal server la policy permette solo di caricare ed elencare, non di scaricare (manca `OBJECT_READ`, ed è voluto: chi entra nel server non legge le copie). Per riportare un backup sul server ci sono due strade.

**A. Dal pannello di Oracle**, senza cambiare la policy. Menu ☰ → **Storage** → **Buckets** → il bucket → cartella `pokeportfolio/<anno>/` → **⋮** accanto all'oggetto → **Download**. Poi dal PC:

```bash
scp -i ~/.ssh/pokeportfolio.key pokeportfolio-notte-<data>-<ora>.dump ubuntu@<IP-del-tuo-server>:
```

**B. Con la CLI sul server**, concedendo per un momento la lettura. Nella policy aggiungi `request.permission = 'OBJECT_READ'` dentro `any {…}` e aspetta qualche minuto. Poi, sul server:

```bash
sudo oci os object list --auth instance_principal --namespace <namespace> \
  --bucket-name <nome-bucket> --prefix pokeportfolio/ --all --query 'data[].name' --output table
sudo oci os object get --auth instance_principal --namespace <namespace> \
  --bucket-name <nome-bucket> --name pokeportfolio/<anno>/<file>.dump --file /home/ubuntu/<file>.dump
```

Finito il ripristino, **togli `OBJECT_READ` dalla policy**.

In tutti e due i casi il file finisce in `/home/ubuntu`. Mettilo nella cartella dei backup e ripristinalo, come in [Ripristinare un backup](#ripristinare-un-backup). Prima conviene fare un backup dello stato attuale:

```bash
sudo install -o postgres -g postgres -m 600 /home/ubuntu/<file>.dump /var/backups/pokeportfolio/<file>.dump
rm /home/ubuntu/<file>.dump
sudo -u postgres pokeportfolio-backup prima-ripristino      # stato attuale, per sicurezza
sudo systemctl stop pokeportfolio
sudo -u postgres pg_restore -d pokeportfolio --clean --if-exists --no-owner --no-acl \
  --role=pokeportfolio --single-transaction --exit-on-error /var/backups/pokeportfolio/<file>.dump
sudo systemctl start pokeportfolio
curl -fsS http://127.0.0.1:3000/api/health && echo " ok"
```

`--single-transaction` con `--exit-on-error` vuol dire che, se qualcosa va storto, il database resta com'era prima. `--role=pokeportfolio` con `--no-owner` lascia le tabelle all'utente dell'app. Il dump va ripristinato con `pg_restore` 18, quello del server.

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
