# Installazione sul server Oracle (VPS)

Guida passo passo per mettere PokéPortfolio sul server Oracle Cloud (Ubuntu 24.04, ARM) e aggiornarlo. Tutti i comandi si lanciano **dal tuo PC**, dalla cartella del progetto, salvo dove è scritto "sul server".

| Script | Dove gira | A cosa serve |
|---|---|---|
| `npm run installa` (`deploy/installa.sh`) | PC → server | Installa o sistema il server. Si può rilanciare |
| `deploy/installa-server.sh` | server | Fa l'installazione vera, lo lancia `installa.sh` |
| `npm run db:trasferisci` (`deploy/trasferisci-database.sh`) | PC → server | Copia il database del PC sul server, una volta |
| `npm run deploy` (`deploy/aggiorna.sh`) | PC → server | Aggiorna l'app all'ultima versione su GitHub |

Ogni script accetta `--dry-run`: mostra cosa farebbe senza collegarsi al server.

Server e chiave predefiniti: `ubuntu@204.216.217.195` e `~/.ssh/pokeportfolio.key`. Se cambiano: `SERVER=ubuntu@<ip> CHIAVE=<percorso> npm run deploy`.

---

## 1. Aprire le porte su Oracle (dal pannello web)

Oltre al firewall del server, che sistema lo script, Oracle ha un suo firewall di rete: la **Security List**.

1. Su [cloud.oracle.com](https://cloud.oracle.com): menu ☰ → **Networking → Virtual Cloud Networks**.
2. Apri la VCN del server → **Subnets** → la subnet del server → **Security Lists** → **Default Security List for …**
3. **Add Ingress Rules** e aggiungi due regole:

   | Campo | Regola 1 | Regola 2 |
   |---|---|---|
   | Stateless | no (lasciare vuoto) | no |
   | Source Type | CIDR | CIDR |
   | Source CIDR | `0.0.0.0/0` | `0.0.0.0/0` |
   | IP Protocol | TCP | TCP |
   | Destination Port Range | `80` | `443` |
   | Description | HTTP | HTTPS |

4. La regola per la porta **22** (SSH) c'è già: non toccarla.

---

## 2. Chiave SSH

La chiave privata scaricata da Oracle deve stare in `~/.ssh/pokeportfolio.key`, leggibile solo da te:

```bash
chmod 600 ~/.ssh/pokeportfolio.key
ssh -i ~/.ssh/pokeportfolio.key ubuntu@204.216.217.195 'echo collegato'
```

La prima volta SSH chiede di confermare l'impronta del server: rispondi `yes`. Non mettere mai la chiave nella cartella del progetto (`keys/`, `*.key` e `*.pem` sono comunque esclusi da git).

---

## 3. Dominio DuckDNS (gratuito)

Il dominio è **`pokeportfolio.duckdns.org`** (già creato su [duckdns.org](https://www.duckdns.org) e già puntato a `204.216.217.195`): è il predefinito degli script. L'app sarà in **HTTPS** con un certificato Let's Encrypt che Caddy ottiene e rinnova da solo.

Il **token** di DuckDNS è in alto nella pagina di duckdns.org dopo l'accesso: serve al passo successivo. Non condividerlo. L'IP non va più toccato: lo comunica il server da solo ogni 5 minuti, anche se Oracle dovesse cambiarlo.

Senza dominio (`DOMINIO=nessuno`, vedi sotto) l'app funziona in HTTP sull'IP: va bene solo per provare, perché password e sessioni viaggiano in chiaro.

---

## 4. File dei segreti sul PC

I segreti non passano mai dalla chat, dalla riga di comando o da git: stanno in un file sul tuo PC, che `npm run installa` manda al server dentro la connessione SSH.

Il file è `~/.config/pokeportfolio/server.env`, con permessi 600 (`chmod 600 ~/.config/pokeportfolio/server.env`). Se non esiste, lo script lo crea vuoto e si ferma. Contiene:

```bash
CARDTRADER_DEFAULT_TOKEN=...      # la stessa key che hai in .env nel progetto
DUCKDNS_TOKEN=...                 # il token di duckdns.org
# DOMINIO=nessuno                 # facoltativo: solo per restare in HTTP sull'IP
```

`DOMINIO` non serve: il predefinito è `pokeportfolio.duckdns.org`.

---

## 5. Installare

Il server scarica il codice da **GitHub** (repository pubblico, branch `feat/backend-server`), non dal PC: prima pubblica gli ultimi commit.

```bash
git push origin feat/backend-server
npm run installa -- --dry-run     # controllo: mostra cosa farebbe
npm run installa                  # installazione vera, qualche minuto
```

Cosa fa sul server, in ordine:

- Node.js 22 (NodeSource), **PostgreSQL 18** (repository ufficiale PGDG), Caddy (binario della release ufficiale su GitHub, con verifica del checksum: il repository apt di Caddy è firmato con una chiave scaduta), git;
- **aggiornamenti automatici** ogni notte: sicurezza di Ubuntu e versioni minori di Node 22, PostgreSQL 18 e Caddy; se serve un riavvio (kernel) il server si riavvia alle **04:30**, fra il giro dei prezzi (03:00) e quello dei set (05:00). App, database e Caddy ripartono da soli;
- **SSH solo con chiave** (password e accesso di root disattivati) e **fail2ban**, che blocca per un'ora chi sbaglia 5 accessi in 10 minuti. La configurazione di SSH viene verificata con `sshd -t` prima di essere applicata: se non va bene resta quella di prima;
- utente di sistema `pokeportfolio` senza login, codice in `/opt/pokeportfolio`;
- database `pokeportfolio` con password casuale, raggiungibile solo dal server stesso;
- `/opt/pokeportfolio/.env` (permessi 600) con connessione al database, API key, `HOST=127.0.0.1`, `SCHEDULER=true`;
- `npm ci --omit=dev` e migrazioni;
- servizio **systemd** `pokeportfolio` (avvio al boot, riavvio automatico se si ferma, disco in sola lettura per l'app);
- **DuckDNS**: aggiornamento dell'IP ogni 5 minuti;
- **Caddy** davanti all'app: HTTPS automatico, compressione, header di sicurezza;
- **firewall**: porte 80 e 443 aperte in `iptables` (permanenti), SSH lasciato com'è;
- **backup** del database ogni notte alle 02:30 in `/var/backups/pokeportfolio` (ultimi 14);
- log di sistema limitati a 500 MB.

Alla fine stampa l'indirizzo dell'app e i comandi utili. Rilanciarlo non rompe niente: password del database, `.env` e dati restano.

> **Perché PostgreSQL 18 e non il 16 di Ubuntu.** Sul PC il database è un PostgreSQL 18 (embedded-postgres). `pg_restore` 16 non legge i dump fatti con `pg_dump` 18, quindi con il 16 bisognerebbe passare da un dump SQL e sperare che non usi nulla di nuovo. Con la stessa versione ai due capi il trasferimento è un dump/restore diretto, e il repository PGDG ha i pacchetti per arm64 e gli aggiornamenti di sicurezza.

---

## 6. Trasferire il database dal PC

Da fare una volta, dopo l'installazione. **Il database del server viene sostituito** da quello del PC (prima lo script ne fa un backup).

Primo terminale:

```bash
npm run db:local
```

Secondo terminale:

```bash
npm run db:trasferisci -- --dry-run   # controllo
npm run db:trasferisci
```

Come funziona: embedded-postgres sul PC non installa `pg_dump`. Lo script apre un tunnel SSH inverso e il `pg_dump` 18 del server legge il database del PC attraverso la connessione SSH (nessuna porta aperta, niente da installare sul PC). Poi ferma l'app, fa `pg_restore`, la riavvia e confronta i conteggi (utenti, voci, storici, set, carte) fra PC e server. Il dump resta sul server in `/var/backups/pokeportfolio/pokeportfolio-dal-pc-*.dump`.

Al riavvio l'app applica le migrazioni mancanti e assegna la key di default agli utenti importati che non ne hanno una (vedi `docs/MIGRAZIONE.md`).

<details>
<summary>Alternativa a mano: pg_dump sul PC, scp, pg_restore</summary>

Serve il client PostgreSQL 18 sul PC (il repository PGDG deve supportare la tua versione di Ubuntu):

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-client-18

# con npm run db:local acceso
PGPASSWORD=pokeportfolio pg_dump -h 127.0.0.1 -p 5432 -U pokeportfolio -Fc -f pokeportfolio.dump pokeportfolio
scp -i ~/.ssh/pokeportfolio.key pokeportfolio.dump ubuntu@204.216.217.195:
ssh -i ~/.ssh/pokeportfolio.key ubuntu@204.216.217.195
```

Sul server:

```bash
sudo -u postgres pokeportfolio-backup prima-trasferimento
sudo install -o postgres -g postgres -m 600 ~/pokeportfolio.dump /var/backups/pokeportfolio/dal-pc.dump
rm ~/pokeportfolio.dump
sudo systemctl stop pokeportfolio
sudo -u postgres pg_restore -d pokeportfolio --clean --if-exists --no-owner --no-acl \
  --role=pokeportfolio --single-transaction /var/backups/pokeportfolio/dal-pc.dump
sudo systemctl start pokeportfolio
```

</details>

Poi apri **https://pokeportfolio.duckdns.org** e accedi con il tuo utente.

---

## 7. Aggiornare l'app

Dopo aver committato e pubblicato le modifiche:

```bash
git push origin feat/backend-server
npm run deploy
```

Sul server: controlla che il codice non sia stato modificato a mano, scarica da GitHub, fa un **backup** del database, aggiorna il codice, esegue `npm ci` solo se `package-lock.json` è cambiato, applica le migrazioni, riavvia e controlla `/api/health`. Se l'app non risponde **torna da sola al commit di prima** e mostra le ultime righe del log. Alla fine stampa da che commit a che commit è passato.

Se sul PC ci sono commit non pubblicati su GitHub, lo script lo dice e chiede se continuare.

Una migrazione già applicata non si annulla tornando al commit di prima: in quel caso c'è il backup `pokeportfolio-aggiornamento-*.dump` (vedi [Ripristinare un backup](#ripristinare-un-backup)).

---

## Manutenzione

Normalmente non serve fare niente: aggiornamenti, riavvii, rinnovo del certificato, IP su DuckDNS e backup sono automatici.

Comandi utili, sul server (`ssh -i ~/.ssh/pokeportfolio.key ubuntu@204.216.217.195`):

| Comando | Cosa fa |
|---|---|
| `sudo systemctl status pokeportfolio` | Stato dell'app |
| `sudo journalctl -u pokeportfolio -f` | Log in diretta (Ctrl+C per uscire) |
| `sudo systemctl restart pokeportfolio` | Riavvio dell'app |
| `sudo -u postgres pokeportfolio-backup` | Backup manuale |
| `sudo ls -lh /var/backups/pokeportfolio` | Elenco dei backup |
| `systemctl list-timers 'pokeportfolio-*'` | Prossimo backup e prossimo aggiornamento DuckDNS |
| `sudo fail2ban-client status sshd` | IP bloccati da fail2ban |
| `sudo journalctl -u caddy -n 50` | Log di Caddy (certificato HTTPS) |
| `cat /var/log/unattended-upgrades/unattended-upgrades.log` | Aggiornamenti automatici installati |

### Copiare un backup sul PC

I backup stanno sullo stesso server: se ogni tanto vuoi una copia a casa,

```bash
ssh -i ~/.ssh/pokeportfolio.key ubuntu@204.216.217.195 \
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

### Cambiare dominio

Aggiungi `DOMINIO=<nuovo dominio>` (e se serve il nuovo `DUCKDNS_TOKEN`) in `~/.config/pokeportfolio/server.env` e rilancia `npm run installa`. Con `DOMINIO=nessuno` si passa all'HTTP sull'IP.

### Repository privato

Oggi il repository è pubblico e il server lo scarica in HTTPS senza credenziali. Se un giorno diventa privato, l'installazione e gli aggiornamenti si fermano con un messaggio. Per sistemare, sul server:

```bash
sudo -u pokeportfolio mkdir -p -m 700 /var/lib/pokeportfolio/.ssh
sudo -u pokeportfolio -H ssh-keygen -t ed25519 -N '' -f /var/lib/pokeportfolio/.ssh/id_ed25519
sudo cat /var/lib/pokeportfolio/.ssh/id_ed25519.pub
```

Su GitHub: repository → **Settings → Deploy keys → Add deploy key**, incolla la chiave, **senza** "Allow write access". Poi, sempre sul server:

```bash
sudo -u pokeportfolio -H ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # risponde "successfully authenticated"
sudo -u pokeportfolio git -C /opt/pokeportfolio remote set-url origin git@github.com:LukinoDeveloppino/PokePortfolio.git
```

### Problemi frequenti

- **Il sito non si apre**: controlla le regole della Security List (passo 1) e `sudo systemctl status pokeportfolio caddy`.
- **HTTPS non funziona**: il dominio deve puntare all'IP del server (`getent hosts pokeportfolio.duckdns.org` deve dare l'IP pubblico) e la porta 80 deve essere aperta. Guarda `sudo journalctl -u caddy -n 50`.
- **SSH rifiuta la chiave**: `chmod 600 ~/.ssh/pokeportfolio.key`. Se hai sbagliato troppe volte, fail2ban blocca il tuo IP per un'ora.

## Cambiare la password di un utente

```
npm run password -- <username>
```

Si collega al server e chiede la nuova password due volte, senza mostrarla. La salva come hash scrypt e chiude le sessioni aperte di quell'utente, che deve rifare il login. Serve un terminale normale: il comando non funziona dentro programmi che non hanno un terminale interattivo.
