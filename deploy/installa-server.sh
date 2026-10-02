#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# installa-server.sh — INSTALLAZIONE DI POKÉPORTFOLIO SUL VPS
# ════════════════════════════════════════════════════════════════════
# Da eseguire SUL SERVER (Ubuntu 24.04, anche ARM64), con sudo:
#
#   sudo DOMINIO=tuonome.duckdns.org bash installa-server.sh
#   sudo DOMINIO=nessuno bash installa-server.sh      (HTTP sull'IP)
#
# Di solito non lo si lancia a mano ma dal PC con deploy/installa.sh, che
# lo copia sul server e gli passa i segreti sullo standard input
# (opzione --segreti-da-stdin: righe NOME=valore), così non compaiono
# mai sulla riga di comando né nei log.
#
# Si può rilanciare quando si vuole: ogni passo controlla cosa c'è già e
# non tocca quello che è a posto (password del database, .env, dati).
#
# Variabili:
#   DOMINIO                  dominio dell'app → HTTPS automatico con Caddy
#                            (Let's Encrypt), per esempio
#                            tuonome.duckdns.org; DOMINIO=nessuno = HTTP
#                            sull'IP, porta 80 (solo per prove). Obbligatoria
#                            al primo lancio (installa.sh la manda sempre),
#                            poi viene ricordata per i lanci successivi.
#   DUCKDNS_TOKEN            token di duckdns.org (segreto), serve se
#                            DOMINIO è un *.duckdns.org: ogni 5 minuti il
#                            server comunica il suo IP a DuckDNS. Viene
#                            salvato in /etc/pokeportfolio/duckdns.env (600).
#   REPO_URL                 repository da clonare (predefinito: GitHub,
#                            LukinoDeveloppino/PokePortfolio)
#   BRANCH                   branch da installare (feat/backend-server)
#   CARDTRADER_DEFAULT_TOKEN API key CardTrader del proprietario. Se manca
#                            e non è già in .env, viene chiesta a video
#                            (senza mostrarla).
#   OCI_BUCKET_BACKUP        facoltativa, non segreta: bucket di Oracle
#                            Object Storage su cui copiare i backup del
#                            database (sezione 10b). Viene ricordata per i
#                            lanci successivi; OCI_BUCKET_BACKUP=nessuno
#                            spegne la copia.
#   OCI_NAMESPACE            facoltativa: namespace Object Storage della
#                            tenancy; se manca lo ricava la OCI CLI.
#
# Cosa fa: Node.js 22, PostgreSQL 18 (repository ufficiale PGDG), Caddy,
# aggiornamenti automatici con riavvio, SSH solo con chiave e fail2ban,
# utente di sistema dedicato, database, .env, dipendenze e migrazioni,
# servizio systemd, DuckDNS, firewall (porte 80 e 443), backup notturno
# del database (con copia facoltativa su Oracle Object Storage) e limite
# ai log.
# ════════════════════════════════════════════════════════════════════

set -euo pipefail

UTENTE_APP=pokeportfolio
CARTELLA_APP=/opt/pokeportfolio
HOME_APP=/var/lib/pokeportfolio
NOME_DB=pokeportfolio
VERSIONE_PG=18
VERSIONE_NODE=22
# Caddy dalle release ufficiali su GitHub (vedi sezione 1). Per
# aggiornarlo: cambia il numero e rilancia npm run installa.
VERSIONE_CADDY=2.11.4
PORTA_APP=3000
CARTELLA_BACKUP=/var/backups/pokeportfolio
BACKUP_DA_TENERE=14
FILE_IMPOSTAZIONI=/etc/pokeportfolio/installazione.conf
# Copia dei backup su Oracle Object Storage (sezione 10b).
UTENTE_BACKUP_REMOTO=pokeportfolio-backup
CARTELLA_OCI=/opt/oci-cli
FILE_BACKUP_REMOTO=/etc/pokeportfolio/backup-remoto.conf

REPO_PREDEFINITO=https://github.com/LukinoDeveloppino/PokePortfolio.git
BRANCH_PREDEFINITO=feat/backend-server
# Un nome a dominio: etichette di lettere minuscole, cifre e trattini,
# separate da punti, con un suffisso di sole lettere.
REGEX_DOMINIO='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'

passo()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info()   { printf '    %s\n' "$*"; }
avviso() { printf '\033[1;33m[ATTENZIONE]\033[0m %s\n' "$*" >&2; }
errore() { printf '\033[1;31m[ERRORE]\033[0m %s\n' "$*" >&2; exit 1; }

# Comandi eseguiti come utente dell'app, con la sua HOME (cache di npm).
come_app() { sudo -u "$UTENTE_APP" -H "$@"; }


# ════════════════════════════════════════════════════════════════════
# CONTROLLI INIZIALI
# ════════════════════════════════════════════════════════════════════

[ "$(id -u)" -eq 0 ] || errore "Lancia lo script con sudo: sudo bash $0"

# Segreti dallo standard input (da deploy/installa.sh): accetto solo le
# variabili previste, una per riga, NOME=valore. Poi l'ingresso passa a
# /dev/null, così nessun comando successivo resta in attesa.
SEGRETI_DA_STDIN=0
for argomento in "$@"; do
  case "$argomento" in
    --segreti-da-stdin) SEGRETI_DA_STDIN=1 ;;
    *) errore "Opzione sconosciuta: $argomento" ;;
  esac
done
if [ "$SEGRETI_DA_STDIN" = 1 ]; then
  while IFS= read -r riga || [ -n "$riga" ]; do
    riga=${riga%$'\r'}
    case "$riga" in
      ''|'#'*) ;;
      CARDTRADER_DEFAULT_TOKEN=*) CARDTRADER_DEFAULT_TOKEN=${riga#*=} ;;
      DUCKDNS_TOKEN=*)            DUCKDNS_TOKEN=${riga#*=} ;;
      DOMINIO=*)                  DOMINIO=${riga#*=} ;;
      BRANCH=*)                   BRANCH=${riga#*=} ;;
      REPO_URL=*)                 REPO_URL=${riga#*=} ;;
      OCI_BUCKET_BACKUP=*)        OCI_BUCKET_BACKUP=${riga#*=} ;;
      OCI_NAMESPACE=*)            OCI_NAMESPACE=${riga#*=} ;;
      *) avviso "Riga ignorata nei segreti: ${riga%%=*}" ;;
    esac
  done
  exec < /dev/null
fi
[ -r /etc/os-release ] || errore "Sistema non riconosciuto (manca /etc/os-release)."
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = ubuntu ] || errore "Questo script è pensato per Ubuntu (trovato: ${ID:-sconosciuto})."
CODENAME=${VERSION_CODENAME:-noble}
[ "${VERSION_ID:-}" = 24.04 ] || avviso "Provato su Ubuntu 24.04, qui c'è la ${VERSION_ID:-?}: proseguo."

# Impostazioni dei lanci precedenti (dominio, repository, branch).
# Le variabili passate ora (o sullo standard input) hanno la precedenza.
if [ -r "$FILE_IMPOSTAZIONI" ]; then
  # shellcheck disable=SC1090
  . "$FILE_IMPOSTAZIONI"
fi
DOMINIO=${DOMINIO:-${DOMINIO_SALVATO:-}}
DOMINIO=$(printf '%s' "$DOMINIO" | tr '[:upper:]' '[:lower:]')
[ -n "$DOMINIO" ] || errore "Manca il dominio dell'app. Dal PC: aggiungi la riga
        DOMINIO=tuonome.duckdns.org in ~/.config/pokeportfolio/server.env e
        lancia npm run installa. A mano sul server:
        sudo DOMINIO=tuonome.duckdns.org bash $0   (DOMINIO=nessuno = HTTP sull'IP)"
if [ "$DOMINIO" = nessuno ]; then
  DOMINIO=
elif ! [[ "$DOMINIO" =~ $REGEX_DOMINIO ]]; then
  # Il dominio finisce nel Caddyfile: solo nomi a dominio veri.
  errore "Dominio non valido: '$DOMINIO' (scrivi solo il nome, per esempio tuonome.duckdns.org)."
fi
REPO_URL=${REPO_URL:-${REPO_URL_SALVATO:-$REPO_PREDEFINITO}}
BRANCH=${BRANCH:-${BRANCH_SALVATO:-$BRANCH_PREDEFINITO}}
[[ "$REPO_URL" =~ ^(https://|git@)[A-Za-z0-9._/:@~-]+$ ]] || errore "REPO_URL non valido: '$REPO_URL'."
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || errore "BRANCH non valido: '$BRANCH'."
# Copia dei backup su Object Storage: attiva solo con un bucket. Nomi di
# bucket e namespace finiscono in comandi e file di configurazione: solo
# lettere, cifre, punti, trattini e trattini bassi.
OCI_BUCKET_BACKUP=${OCI_BUCKET_BACKUP:-${OCI_BUCKET_BACKUP_SALVATO:-}}
OCI_NAMESPACE=${OCI_NAMESPACE:-${OCI_NAMESPACE_SALVATO:-}}
[[ "$OCI_BUCKET_BACKUP" =~ ^[A-Za-z0-9._-]{0,256}$ ]] || errore "OCI_BUCKET_BACKUP non valido: '$OCI_BUCKET_BACKUP'."
[[ "$OCI_NAMESPACE" =~ ^[A-Za-z0-9._-]{0,128}$ ]] || errore "OCI_NAMESPACE non valido: '$OCI_NAMESPACE'."
if [ -n "$OCI_BUCKET_BACKUP" ] && [ "$OCI_BUCKET_BACKUP" != nessuno ]; then BACKUP_REMOTO=1; else BACKUP_REMOTO=0; fi

export DEBIAN_FRONTEND=noninteractive


# ════════════════════════════════════════════════════════════════════
# 1. PACCHETTI DI BASE E REPOSITORY UFFICIALI
# ════════════════════════════════════════════════════════════════════

# ---- Caddy: niente repository apt ----
# Il repository ufficiale di Caddy su Cloudsmith firma i pacchetti con una
# sottochiave scaduta il 2024-03-30 e apt lo rifiuta (EXPKEYSIG
# 531A6B20FA058A70, guasto loro: caddyserver/dist#140). Caddy si installa
# dal binario della release GitHub, più sotto. Se un lancio precedente ha
# aggiunto il repository lo tolgo PRIMA di qualunque apt-get update, che
# altrimenti fallirebbe.
rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg

# SSH porta sul server la lingua del PC (it_IT): la genero, così perl e
# apt non riempiono l'output di avvisi sulle impostazioni locali.
locale -a 2>/dev/null | grep -qi '^it_IT\.utf-\?8$' || locale-gen it_IT.UTF-8 >/dev/null

passo "Pacchetti di base"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git debian-keyring debian-archive-keyring \
  apt-transport-https unattended-upgrades
install -d -m 755 /etc/apt/keyrings

# Scarica la chiave di un repository e la salva in formato binario.
chiave_repo() { # <url> <file>
  curl -fsSL "$1" | gpg --dearmor --yes -o "$2.tmp"
  mv "$2.tmp" "$2"
  chmod 644 "$2"
}

# ---- Node.js 22 (NodeSource, ha i pacchetti arm64) ----
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$VERSIONE_NODE" ]; then
  passo "Node.js $VERSIONE_NODE (repository NodeSource)"
  chiave_repo https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${VERSIONE_NODE}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  RICARICA_APT=1
fi

# ---- PostgreSQL 18 (PGDG, apt.postgresql.org) ----
# Non quello di Ubuntu (16): il database del PC è un PostgreSQL 18 e
# pg_restore 16 non legge i dump custom fatti con pg_dump 18. Con la
# stessa versione ovunque il trasferimento è un dump/restore diretto.
if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
  passo "Repository PostgreSQL (PGDG)"
  install -d -m 755 /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  RICARICA_APT=1
fi


[ "${RICARICA_APT:-0}" = 1 ] && apt-get update -q

passo "Node.js, PostgreSQL $VERSIONE_PG, iptables-persistent"
# iptables-persistent chiede a video se salvare le regole: rispondo sì.
echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | debconf-set-selections
echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | debconf-set-selections
apt-get install -y -q nodejs "postgresql-$VERSIONE_PG" "postgresql-client-$VERSIONE_PG" \
  iptables-persistent netfilter-persistent fail2ban python3-systemd
info "Node $(node -v), npm $(npm -v)"

# ---- Caddy dalla release GitHub, con verifica del checksum ----
passo "Caddy $VERSIONE_CADDY (release ufficiale su GitHub)"
if [ "$(caddy version 2>/dev/null | cut -d' ' -f1)" = "v$VERSIONE_CADDY" ]; then
  info "Già installato."
else
  ARCH_CADDY=$(dpkg --print-architecture)   # arm64 su Oracle Ampere, amd64 altrove
  URL_CADDY=https://github.com/caddyserver/caddy/releases/download/v$VERSIONE_CADDY
  FILE_CADDY=caddy_${VERSIONE_CADDY}_linux_${ARCH_CADDY}.tar.gz
  TMP_CADDY=$(mktemp -d)
  curl -fsSL -o "$TMP_CADDY/$FILE_CADDY" "$URL_CADDY/$FILE_CADDY"
  curl -fsSL -o "$TMP_CADDY/checksums.txt" "$URL_CADDY/caddy_${VERSIONE_CADDY}_checksums.txt"
  # Il file dei checksum elenca tutte le piattaforme: controllo solo la mia.
  ( cd "$TMP_CADDY" && grep " $FILE_CADDY\$" checksums.txt | sha512sum -c --quiet - ) \
    || errore "Checksum di $FILE_CADDY non valido: download corrotto o manomesso."
  tar -xzf "$TMP_CADDY/$FILE_CADDY" -C "$TMP_CADDY" caddy
  install -m 755 "$TMP_CADDY/caddy" /usr/bin/caddy.nuovo
  mv /usr/bin/caddy.nuovo /usr/bin/caddy
  rm -rf "$TMP_CADDY"
  info "Installato $(caddy version | cut -d' ' -f1) (checksum SHA-512 verificato)."
fi

# Utente e servizio come nel pacchetto ufficiale (caddyserver/dist).
getent group caddy >/dev/null || groupadd --system caddy
getent passwd caddy >/dev/null || useradd --system --gid caddy --create-home \
  --home-dir /var/lib/caddy --shell /usr/sbin/nologin --comment "Caddy web server" caddy
install -d -m 755 /etc/caddy
cat > /etc/systemd/system/caddy.service <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio (dal caddy.service ufficiale).
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload


# ════════════════════════════════════════════════════════════════════
# 2. AGGIORNAMENTI AUTOMATICI
# ════════════════════════════════════════════════════════════════════
# Ogni notte: aggiornamenti di sicurezza di Ubuntu e versioni minori di
# Node 22 e PostgreSQL 18 (i repository restano sulla stessa versione
# principale, quindi niente salti di versione). Caddy è un binario a
# versione fissa (VERSIONE_CADDY): si aggiorna rilanciando l'installazione. Se serve un
# riavvio (kernel) avviene alle 04:30, fra il giro dei prezzi delle 03:00
# e quello dei set delle 05:00; al boot app, PostgreSQL e Caddy ripartono
# da soli (servizi abilitati).

passo "Aggiornamenti automatici"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52pokeportfolio-upgrades <<'EOF'
// Scritto da installa-server.sh di PokéPortfolio.
Unattended-Upgrade::Origins-Pattern {
  "site=apt.postgresql.org";
  "site=deb.nodesource.com";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
EOF
systemctl enable --now unattended-upgrades.service >/dev/null 2>&1 || true
info "Attivi (log in /var/log/unattended-upgrades/)."


# ════════════════════════════════════════════════════════════════════
# 2b. SSH SOLO CON CHIAVE E FAIL2BAN
# ════════════════════════════════════════════════════════════════════
# Il file in sshd_config.d inizia con 00- perché in sshd vale il primo
# valore letto: così vince su quelli di cloud-init. Prima di ricaricare
# controllo la configurazione con sshd -t; se non va bene tolgo il file e
# non ricarico, così l'accesso resta com'era. Le sessioni aperte non
# vengono chiuse da un reload.

passo "SSH: accesso solo con chiave"
FILE_SSHD=/etc/ssh/sshd_config.d/00-pokeportfolio.conf
UTENTE_SSH=${SUDO_USER:-ubuntu}
CHIAVI_SSH=$(getent passwd "$UTENTE_SSH" | cut -d: -f6)/.ssh/authorized_keys
if [ "$UTENTE_SSH" = root ] || [ ! -s "$CHIAVI_SSH" ]; then
  avviso "Non trovo chiavi SSH per l'utente $UTENTE_SSH ($CHIAVI_SSH): lascio SSH com'è
        per non chiuderti fuori. Lancia lo script con sudo dall'utente che entra con la chiave."
else
  cat > "$FILE_SSHD" <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio: solo chiavi SSH.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
EOF
  chmod 644 "$FILE_SSHD"
  install -d -m 755 /run/sshd
  VERIFICA_SSHD=$(mktemp)
  if sshd -t 2>"$VERIFICA_SSHD"; then
    systemctl try-reload-or-restart ssh.service
    info "Password e accesso di root disattivati (entra solo chi ha la chiave, come $UTENTE_SSH)."
  else
    rm -f "$FILE_SSHD"
    avviso "La verifica di sshd non è passata: tolgo $FILE_SSHD e non ricarico SSH."
    sed 's/^/        /' "$VERIFICA_SSHD" >&2
  fi
  rm -f "$VERIFICA_SSHD"
fi

passo "fail2ban sul servizio SSH"
cat > /etc/fail2ban/jail.d/pokeportfolio.conf <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio.
# 5 tentativi falliti in 10 minuti → IP bloccato per un'ora.
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban
info "Attivo (stato: sudo fail2ban-client status sshd)."


# ════════════════════════════════════════════════════════════════════
# 3. UTENTE DI SISTEMA E CODICE
# ════════════════════════════════════════════════════════════════════

passo "Utente di sistema $UTENTE_APP"
if ! id "$UTENTE_APP" >/dev/null 2>&1; then
  useradd --system --home-dir "$HOME_APP" --create-home --shell /usr/sbin/nologin "$UTENTE_APP"
  info "Creato (senza login)."
else
  info "Già presente."
fi

passo "Codice da $REPO_URL (branch $BRANCH)"
if [ ! -d "$CARTELLA_APP/.git" ]; then
  if ! come_app env GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1; then
    errore "Non riesco a leggere il branch $BRANCH da $REPO_URL.
        Controlla la connessione e il nome del branch. Se il repository è
        diventato privato, vedi la sezione \"Repository privato\" in deploy/README.md."
  fi
  install -d -o "$UTENTE_APP" -g "$UTENTE_APP" -m 755 "$CARTELLA_APP"
  come_app git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$CARTELLA_APP"
  info "Clonato in $CARTELLA_APP."
else
  info "Già clonato in $CARTELLA_APP: non lo aggiorno (per quello c'è deploy/aggiorna.sh)."
fi
chown "$UTENTE_APP:$UTENTE_APP" "$CARTELLA_APP"


# ════════════════════════════════════════════════════════════════════
# 4. DATABASE
# ════════════════════════════════════════════════════════════════════
# Il cluster ascolta solo su localhost; l'app si collega con utente e
# password (scram-sha-256, il predefinito per 127.0.0.1).

passo "PostgreSQL: cluster $VERSIONE_PG, ruolo e database"
if ! pg_lsclusters -h | awk -v v="$VERSIONE_PG" '$1 == v && $2 == "main" { trovato = 1 } END { exit !trovato }'; then
  pg_createcluster "$VERSIONE_PG" main --start
fi
PORTA_PG=$(pg_lsclusters -h | awk -v v="$VERSIONE_PG" '$1 == v && $2 == "main" { print $3 }')
cat > "/etc/postgresql/$VERSIONE_PG/main/conf.d/pokeportfolio.conf" <<'EOF'
# Scritto da installa-server.sh: database raggiungibile solo dal server.
listen_addresses = 'localhost'
EOF
systemctl enable postgresql.service >/dev/null 2>&1 || true
systemctl enable --now "postgresql@$VERSIONE_PG-main" >/dev/null
systemctl restart "postgresql@$VERSIONE_PG-main"
sleep 2
# Verifica: nessun indirizzo diverso da 127.0.0.1 e ::1 in ascolto.
INDIRIZZI_PG=$(ss -Hltn "sport = :$PORTA_PG" | awk '{ print $4 }')
if printf '%s\n' "$INDIRIZZI_PG" | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | grep -q .; then
  errore "PostgreSQL è in ascolto anche fuori da localhost: $INDIRIZZI_PG
        Controlla listen_addresses in /etc/postgresql/$VERSIONE_PG/main/."
fi
info "Cluster $VERSIONE_PG/main sulla porta $PORTA_PG, solo su localhost ($(echo "$INDIRIZZI_PG" | tr '\n' ' '))."

psql_admin() { sudo -u postgres psql -p "$PORTA_PG" -X -q -v ON_ERROR_STOP=1 "$@"; }

FILE_ENV="$CARTELLA_APP/.env"
# Valore di una variabile in .env (vuoto se manca).
valore_env() { [ -f "$FILE_ENV" ] && sed -n "s/^$1=//p" "$FILE_ENV" | tail -n 1 || true; }

DATABASE_URL_ESISTENTE=$(valore_env DATABASE_URL)
RUOLO_ESISTE=$(psql_admin -tA -c "SELECT 1 FROM pg_roles WHERE rolname = '$UTENTE_APP'")

if [ -n "$DATABASE_URL_ESISTENTE" ] && [ "$RUOLO_ESISTE" = 1 ]; then
  DATABASE_URL=$DATABASE_URL_ESISTENTE
  info "Ruolo $UTENTE_APP già presente, password invariata (quella in .env)."
else
  PASSWORD_DB=$(openssl rand -hex 24)
  # La password arriva a psql dallo standard input, non dalla riga di
  # comando (che si vedrebbe con ps).
  if [ "$RUOLO_ESISTE" = 1 ]; then
    psql_admin <<< "ALTER ROLE $UTENTE_APP WITH LOGIN PASSWORD '$PASSWORD_DB';"
    info "Ruolo $UTENTE_APP già presente ma senza .env: nuova password."
  else
    psql_admin <<< "CREATE ROLE $UTENTE_APP WITH LOGIN PASSWORD '$PASSWORD_DB';"
    info "Ruolo $UTENTE_APP creato."
  fi
  DATABASE_URL="postgresql://$UTENTE_APP:$PASSWORD_DB@127.0.0.1:$PORTA_PG/$NOME_DB"
fi

if [ "$(psql_admin -tA -c "SELECT 1 FROM pg_database WHERE datname = '$NOME_DB'")" != 1 ]; then
  psql_admin -c "CREATE DATABASE $NOME_DB OWNER $UTENTE_APP ENCODING 'UTF8' TEMPLATE template0"
  info "Database $NOME_DB creato."
else
  info "Database $NOME_DB già presente: i dati restano dove sono."
fi
# Nessun altro ruolo (a parte i superutenti) può collegarsi al database.
psql_admin -c "REVOKE CONNECT ON DATABASE $NOME_DB FROM PUBLIC"


# ════════════════════════════════════════════════════════════════════
# 5. FILE .env
# ════════════════════════════════════════════════════════════════════

passo "Configurazione $FILE_ENV"
TOKEN=${CARDTRADER_DEFAULT_TOKEN:-$(valore_env CARDTRADER_DEFAULT_TOKEN)}
if [ -z "$TOKEN" ]; then
  if [ -t 0 ]; then
    echo "    Serve l'API key CardTrader del proprietario (catalogo e set)."
    echo "    La trovi su cardtrader.com → impostazioni del profilo → sezione API."
    read -r -s -p "    Incollala qui (non verrà mostrata) e premi Invio: " TOKEN
    echo
  fi
  [ -n "$TOKEN" ] || errore "API key CardTrader mancante. Rilancia lo script da un terminale
        (ssh -t ...) e incollala quando viene chiesta."
fi
case "$TOKEN" in
  *[[:space:]\"\'\$\`\\]*) errore "L'API key contiene spazi o caratteri strani: ricopiala da CardTrader." ;;
esac

CRON_SECRET_ESISTENTE=$(valore_env CRON_SECRET)

# Scrivo in un file temporaneo leggibile solo da root, poi lo sposto:
# l'API key non passa mai dalla riga di comando né dal terminale.
FILE_TMP=$(mktemp)
chmod 600 "$FILE_TMP"
cat > "$FILE_TMP" <<EOF
# Scritto da installa-server.sh. Rilanciandolo, password e API key restano.
DATABASE_URL=$DATABASE_URL
NODE_ENV=production
TZ=Europe/Rome
PORT=$PORTA_APP
HOST=127.0.0.1
SCHEDULER=true
CARDTRADER_DEFAULT_TOKEN=$TOKEN
EOF
[ -n "$CRON_SECRET_ESISTENTE" ] && echo "CRON_SECRET=$CRON_SECRET_ESISTENTE" >> "$FILE_TMP"
install -o "$UTENTE_APP" -g "$UTENTE_APP" -m 600 "$FILE_TMP" "$FILE_ENV"
rm -f "$FILE_TMP"
unset TOKEN CARDTRADER_DEFAULT_TOKEN PASSWORD_DB
info "Scritto (permessi 600, proprietario $UTENTE_APP)."


# ════════════════════════════════════════════════════════════════════
# 6. DIPENDENZE E MIGRAZIONI
# ════════════════════════════════════════════════════════════════════

passo "Dipendenze (npm ci --omit=dev) e migrazioni"
come_app bash -c "cd '$CARTELLA_APP' && npm ci --omit=dev --no-audit --no-fund"
come_app bash -c "cd '$CARTELLA_APP' && npm run --silent migrate"


# ════════════════════════════════════════════════════════════════════
# 7. SERVIZIO SYSTEMD
# ════════════════════════════════════════════════════════════════════

passo "Servizio pokeportfolio.service"
cat > /etc/systemd/system/pokeportfolio.service <<EOF
# Scritto da installa-server.sh di PokéPortfolio.
[Unit]
Description=PokéPortfolio (server Node)
After=network-online.target postgresql@$VERSIONE_PG-main.service
Wants=network-online.target postgresql@$VERSIONE_PG-main.service

[Service]
Type=simple
User=$UTENTE_APP
Group=$UTENTE_APP
WorkingDirectory=$CARTELLA_APP
EnvironmentFile=$FILE_ENV
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=5
# Arresto pulito: l'app chiude richieste e connessioni su SIGTERM.
KillSignal=SIGTERM
TimeoutStopSec=30

# Protezioni: l'app legge solo il suo codice e parla in rete con
# PostgreSQL, CardTrader e GitHub. Non scrive file: con ProtectSystem=strict
# e nessun ReadWritePaths tutto il disco è in sola lettura per lei.
NoNewPrivileges=true
ProtectSystem=strict
InaccessiblePaths=-/etc/pokeportfolio -$CARTELLA_BACKUP -/etc/ssh -/root
ProtectProc=invisible
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
CapabilityBoundingSet=
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable pokeportfolio.service >/dev/null
systemctl restart pokeportfolio.service

# Attendo che risponda (le migrazioni sono già applicate: pochi secondi).
SALUTE=
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORTA_APP/api/health" >/dev/null 2>&1; then SALUTE=ok; break; fi
  sleep 2
done
if [ "$SALUTE" = ok ]; then
  info "L'app risponde su 127.0.0.1:$PORTA_APP."
else
  avviso "L'app non risponde ancora. Ultime righe del log:"
  journalctl -u pokeportfolio -n 30 --no-pager || true
fi


# ════════════════════════════════════════════════════════════════════
# 7b. DUCKDNS
# ════════════════════════════════════════════════════════════════════
# Se il dominio è un *.duckdns.org, ogni 5 minuti un timer comunica a
# DuckDNS l'IP pubblico del server (ip= vuoto: lo rileva DuckDNS). Così,
# se Oracle cambia l'IP, il dominio lo segue da solo. Il token sta solo
# in /etc/pokeportfolio/duckdns.env (root, 600) e arriva a curl dallo
# standard input, mai sulla riga di comando (che altri vedrebbero in ps).

FILE_DUCKDNS=/etc/pokeportfolio/duckdns.env
install -d -m 755 /etc/pokeportfolio
case "$DOMINIO" in
  *.duckdns.org)
    passo "DuckDNS per $DOMINIO"
    SOTTODOMINIO=${DOMINIO%.duckdns.org}
    case "$SOTTODOMINIO" in
      *[!a-z0-9-]*|'') errore "Dominio DuckDNS non valido: $DOMINIO (es. tuonome.duckdns.org)." ;;
    esac
    if [ -z "${DUCKDNS_TOKEN:-}" ] && [ -r "$FILE_DUCKDNS" ]; then
      DUCKDNS_TOKEN=$(sed -n 's/^DUCKDNS_TOKEN=//p' "$FILE_DUCKDNS" | tail -n 1)
    fi
    if [ -z "${DUCKDNS_TOKEN:-}" ] && [ -t 0 ]; then
      read -r -s -p "    Token di DuckDNS (lo trovi in alto su duckdns.org dopo l'accesso, non verrà mostrato): " DUCKDNS_TOKEN
      echo
    fi
    [ -n "${DUCKDNS_TOKEN:-}" ] || errore "Token DuckDNS mancante: mettilo in DUCKDNS_TOKEN (vedi deploy/README.md)."
    case "$DUCKDNS_TOKEN" in
      *[!A-Za-z0-9-]*) errore "Il token DuckDNS contiene caratteri strani: ricopialo da duckdns.org." ;;
    esac

    FILE_TMP=$(mktemp)
    chmod 600 "$FILE_TMP"
    printf 'DUCKDNS_SOTTODOMINIO=%s\nDUCKDNS_TOKEN=%s\n' "$SOTTODOMINIO" "$DUCKDNS_TOKEN" > "$FILE_TMP"
    install -o root -g root -m 600 "$FILE_TMP" "$FILE_DUCKDNS"
    rm -f "$FILE_TMP"
    unset DUCKDNS_TOKEN

    cat > /usr/local/sbin/pokeportfolio-duckdns <<'EOF'
#!/usr/bin/env bash
# Aggiorna l'IP del sottodominio DuckDNS (scritto da installa-server.sh).
# Legge DUCKDNS_SOTTODOMINIO e DUCKDNS_TOKEN dall'ambiente (EnvironmentFile).
set -euo pipefail
: "${DUCKDNS_SOTTODOMINIO:?}" "${DUCKDNS_TOKEN:?}"
# L'URL con il token passa a curl dallo standard input (--config -).
risposta=$(printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' \
             "$DUCKDNS_SOTTODOMINIO" "$DUCKDNS_TOKEN" |
           curl -fsS --max-time 20 --retry 2 --config -)
if [ "$risposta" != OK ]; then
  echo "DuckDNS ha risposto '$risposta': controlla sottodominio e token." >&2
  exit 1
fi
echo "DuckDNS aggiornato per $DUCKDNS_SOTTODOMINIO.duckdns.org"
EOF
    chmod 755 /usr/local/sbin/pokeportfolio-duckdns

    cat > /etc/systemd/system/pokeportfolio-duckdns.service <<EOF
# Scritto da installa-server.sh di PokéPortfolio.
[Unit]
Description=Aggiornamento dell'IP su DuckDNS
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$FILE_DUCKDNS
ExecStart=/usr/local/sbin/pokeportfolio-duckdns
DynamicUser=true
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
CapabilityBoundingSet=
EOF
    cat > /etc/systemd/system/pokeportfolio-duckdns.timer <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio.
[Unit]
Description=Aggiornamento dell'IP su DuckDNS ogni 5 minuti

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now pokeportfolio-duckdns.timer >/dev/null
    if systemctl start pokeportfolio-duckdns.service; then
      info "IP comunicato a DuckDNS; poi ogni 5 minuti."
    else
      avviso "DuckDNS non ha accettato l'aggiornamento: journalctl -u pokeportfolio-duckdns"
    fi
    ;;
  *)
    # Nessun dominio DuckDNS (o non più): spengo il timer se c'era.
    if [ -f /etc/systemd/system/pokeportfolio-duckdns.timer ]; then
      systemctl disable --now pokeportfolio-duckdns.timer >/dev/null 2>&1 || true
      info "DuckDNS: timer disattivato (il dominio non è un *.duckdns.org)."
    fi
    ;;
esac


# ════════════════════════════════════════════════════════════════════
# 8. CADDY (REVERSE PROXY E HTTPS)
# ════════════════════════════════════════════════════════════════════
# Header di sicurezza su tutte le risposte. Nessuna Content-Security-
# Policy: le pagine hanno molto JavaScript inline e caricano Chart.js,
# font e immagini da altri domini; una CSP andrebbe provata pagina per
# pagina nel browser. X-Frame-Options DENY impedisce di mostrare l'app
# dentro un iframe di un altro sito (clickjacking).

passo "Caddy"
if [ -n "$DOMINIO" ]; then
  INDIRIZZO_CADDY=$DOMINIO
  NOTA_CADDY="# Dominio: Caddy ottiene e rinnova da solo il certificato HTTPS
# (Let's Encrypt) e manda l'HTTP verso l'HTTPS. Il dominio deve puntare
# all'IP del server e le porte 80 e 443 devono essere aperte, anche nella
# Security List di Oracle."
  # Solo con HTTPS: il browser userà sempre l'HTTPS per un anno.
  HEADER_HSTS='Strict-Transport-Security "max-age=31536000"'
else
  INDIRIZZO_CADDY=:80
  NOTA_CADDY="# TEMPORANEO: nessun dominio, solo HTTP sull'IP del server (password
# e token viaggiano in chiaro). Per passare al dominio: scrivi
# DOMINIO=tuonome.duckdns.org in ~/.config/pokeportfolio/server.env sul
# PC e rilancia npm run installa (vedi deploy/README.md)."
  HEADER_HSTS='# niente Strict-Transport-Security senza HTTPS'
fi
cat > /etc/caddy/Caddyfile <<EOF
# Scritto da installa-server.sh di PokéPortfolio.
$NOTA_CADDY
$INDIRIZZO_CADDY {
	# Gli storici dei prezzi arrivano a ~2 MB di JSON: compressi pesano
	# circa un decimo.
	encode zstd gzip

	header {
		-Server
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Frame-Options DENY
		$HEADER_HSTS
	}

	reverse_proxy 127.0.0.1:$PORTA_APP
}
EOF
caddy fmt --overwrite /etc/caddy/Caddyfile >/dev/null 2>&1 || true
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy
info "In ascolto su $INDIRIZZO_CADDY → 127.0.0.1:$PORTA_APP."


# ════════════════════════════════════════════════════════════════════
# 9. FIREWALL (iptables delle immagini Oracle)
# ════════════════════════════════════════════════════════════════════
# Le immagini Ubuntu di Oracle hanno in /etc/iptables/rules.v4 una catena
# INPUT che accetta solo SSH e finisce con un REJECT. Aggiungo 80 e 443
# subito prima del REJECT, senza toccare le altre regole (SSH compreso),
# e le salvo con netfilter-persistent così restano dopo un riavvio.

passo "Firewall: porte 80 e 443"
apri_porta() { # <comando iptables> <porta>
  local ipt=$1 porta=$2 posizione
  if "$ipt" -C INPUT -p tcp -m state --state NEW --dport "$porta" -j ACCEPT 2>/dev/null; then
    info "$ipt: porta $porta già aperta."
    return
  fi
  posizione=$("$ipt" -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
  if [ -n "$posizione" ]; then
    "$ipt" -I INPUT "$posizione" -p tcp -m state --state NEW --dport "$porta" -j ACCEPT
  else
    "$ipt" -A INPUT -p tcp -m state --state NEW --dport "$porta" -j ACCEPT
  fi
  info "$ipt: porta $porta aperta."
}
for porta in 80 443; do
  apri_porta iptables "$porta"
  apri_porta ip6tables "$porta"
done
netfilter-persistent save >/dev/null 2>&1
info "Regole salvate in /etc/iptables/ (restano dopo il riavvio)."
info "Ricorda: le stesse porte vanno aperte nella Security List della VCN su Oracle."


# ════════════════════════════════════════════════════════════════════
# 10. BACKUP NOTTURNO DEL DATABASE
# ════════════════════════════════════════════════════════════════════
# pg_dump in formato custom alle 02:30, prima del giro dei prezzi. Si
# tengono gli ultimi $BACKUP_DA_TENERE file per ogni etichetta ("notte",
# "aggiornamento", ...). Cartella dell'utente postgres; con la copia su
# Object Storage attiva (sezione 10b) la può leggere, non scrivere, anche
# l'utente $UTENTE_BACKUP_REMOTO: gruppo suo, bit setgid perché i nuovi
# file prendano quel gruppo, file 640.

passo "Backup notturno in $CARTELLA_BACKUP"
if [ "$BACKUP_REMOTO" = 1 ]; then
  if ! id "$UTENTE_BACKUP_REMOTO" >/dev/null 2>&1; then
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin \
      --comment "Copia dei backup di PokéPortfolio su Object Storage" "$UTENTE_BACKUP_REMOTO"
    info "Creato l'utente $UTENTE_BACKUP_REMOTO (senza login, per la copia su Object Storage)."
  fi
  install -d -o postgres -g "$UTENTE_BACKUP_REMOTO" -m 2750 "$CARTELLA_BACKUP"
  chmod 2750 "$CARTELLA_BACKUP"
else
  install -d -o postgres -g postgres -m 700 "$CARTELLA_BACKUP"
fi
cat > /usr/local/sbin/pokeportfolio-backup <<EOF
#!/usr/bin/env bash
# Backup del database di PokéPortfolio (scritto da installa-server.sh).
# Uso, come utente postgres:  pokeportfolio-backup [etichetta]
# La copia su Object Storage (se attiva) la fa un'altra unit, dopo:
# pokeportfolio-backup-remoto@<etichetta>.service.
set -euo pipefail
trap 'echo "[BACKUP LOCALE FALLITO] pg_dump o rotazione non riusciti (riga \$LINENO)." >&2' ERR
ETICHETTA=\${1:-manuale}
case "\$ETICHETTA" in *[!a-z0-9-]*|'') echo "Etichetta non valida: \$ETICHETTA" >&2; exit 1 ;; esac
CARTELLA=$CARTELLA_BACKUP
DA_TENERE=$BACKUP_DA_TENERE
# 640: il gruppo della cartella (vedi installa-server.sh) può leggerli.
umask 027
FILE="\$CARTELLA/pokeportfolio-\$ETICHETTA-\$(date +%Y%m%d-%H%M%S).dump"
pg_dump -p $PORTA_PG -Fc -d $NOME_DB -f "\$FILE.parziale"
mv "\$FILE.parziale" "\$FILE"
# Rotazione: tengo solo gli ultimi \$DA_TENERE di questa etichetta.
ls -1t "\$CARTELLA"/pokeportfolio-"\$ETICHETTA"-*.dump | tail -n +\$((DA_TENERE + 1)) | xargs -r rm -f --
echo "Backup salvato: \$FILE (\$(du -h "\$FILE" | cut -f1))"
EOF
chmod 755 /usr/local/sbin/pokeportfolio-backup

cat > /etc/systemd/system/pokeportfolio-backup.service <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio.
[Unit]
Description=Backup del database di PokéPortfolio
After=postgresql.service

[Service]
Type=oneshot
User=postgres
Group=postgres
ExecStart=/usr/local/sbin/pokeportfolio-backup notte
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
EOF
cat > /etc/systemd/system/pokeportfolio-backup.timer <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio.
[Unit]
Description=Backup notturno del database di PokéPortfolio

[Timer]
OnCalendar=*-*-* 02:30:00
# Se il server era spento all'ora prevista, il backup parte all'avvio.
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now pokeportfolio-backup.timer >/dev/null
info "Timer attivo: ogni notte alle 02:30, ultimi $BACKUP_DA_TENERE backup."


# ════════════════════════════════════════════════════════════════════
# 10b. COPIA DEI BACKUP SU ORACLE OBJECT STORAGE (FACOLTATIVA)
# ════════════════════════════════════════════════════════════════════
# Attiva solo con OCI_BUCKET_BACKUP. Dopo ogni backup notturno riuscito
# (OnSuccess= di pokeportfolio-backup.service) e dopo quello fatto prima
# di ogni aggiornamento, pokeportfolio-backup-remoto@<etichetta>.service
# carica il file appena creato nel bucket, come oggetto
# pokeportfolio/<anno>/<nome del file>.
#
# Autenticazione solo con instance principal: è la VM a essere
# autorizzata (dynamic group + policy su Oracle), sul server non c'è
# nessuna chiave API né ~/.oci/config. La policy permette solo di
# creare ed elencare oggetti: niente cancellazioni né sovrascritture
# (le vecchie copie le toglie la regola di lifecycle del bucket). Lo
# script non usa mai --force: la CLI controlla con HeadObject che il
# nome sia libero e carica con If-None-Match: *, quindi un oggetto
# esistente non viene mai toccato.
#
# OCI CLI ufficiale da PyPI in un virtualenv in $CARTELLA_OCI (niente
# script scaricati ed eseguiti): a ogni lancio dell'installazione
# pip install --upgrade la porta all'ultima versione. Cartella del
# virtualenv leggibile solo da root e dal gruppo $UTENTE_BACKUP_REMOTO.
#
# Utente: il caricamento gira come $UTENTE_BACKUP_REMOTO, utente di
# sistema senza login e senza home, che può solo leggere la cartella dei
# backup (gruppo, vedi sezione 10). Non serve postgres né root: pg_dump
# resta nel suo servizio, e chi carica non può modificare né cancellare i
# backup locali. Rischio residuo: l'instance principal vale per tutta la
# VM, quindi un processo qualunque della VM con accesso alla rete
# potrebbe chiedere le credenziali al servizio dei metadati e caricare o
# elencare oggetti nel bucket; la policy impedisce comunque di
# cancellare o sovrascrivere.

DROPIN_BACKUP_REMOTO=/etc/systemd/system/pokeportfolio-backup.service.d/remoto.conf
passo "Copia dei backup su Oracle Object Storage"
if [ "$BACKUP_REMOTO" = 0 ]; then
  if [ -f "$FILE_BACKUP_REMOTO" ] || [ -f "$DROPIN_BACKUP_REMOTO" ]; then
    rm -f "$FILE_BACKUP_REMOTO" "$DROPIN_BACKUP_REMOTO"
    systemctl daemon-reload
    info "Disattivata (OCI_BUCKET_BACKUP=nessuno): i backup restano solo sul server."
    info "La OCI CLI resta in $CARTELLA_OCI; gli oggetti già caricati restano nel bucket."
  else
    info "Non configurata (manca OCI_BUCKET_BACKUP): i backup restano solo sul server."
    info "Per attivarla vedi \"Backup anche fuori dal server\" nel README.md."
  fi
else
  info "Bucket: $OCI_BUCKET_BACKUP"
  apt-get install -y -q python3-venv
  # Virtualenv nuovo, o rifatto se è rotto (per esempio dopo un cambio di Python).
  if ! "$CARTELLA_OCI/bin/python3" -c '' 2>/dev/null; then
    python3 -m venv --clear "$CARTELLA_OCI"
  fi
  chown root:"$UTENTE_BACKUP_REMOTO" "$CARTELLA_OCI"
  chmod 750 "$CARTELLA_OCI"
  CLI_OCI=1
  if "$CARTELLA_OCI/bin/pip" install --quiet --disable-pip-version-check --upgrade oci-cli; then
    info "OCI CLI $("$CARTELLA_OCI/bin/oci" --version) in $CARTELLA_OCI (aggiornata a ogni installazione)."
  elif [ -x "$CARTELLA_OCI/bin/oci" ]; then
    avviso "Non riesco ad aggiornare la OCI CLI (rete o PyPI?): resto alla versione installata."
  else
    avviso "Non riesco a installare la OCI CLI (rete o PyPI?): salto la copia su Object Storage.
        Rilancia l'installazione più tardi."
    CLI_OCI=0
  fi
fi

if [ "$BACKUP_REMOTO" = 1 ] && [ "$CLI_OCI" = 1 ]; then
  ln -sfn "$CARTELLA_OCI/bin/oci" /usr/local/bin/oci

  # La OCI CLI come la usa il servizio: utente dedicato, instance
  # principal, con un tempo massimo (fuori da Oracle resterebbe ad
  # aspettare il servizio dei metadati).
  oci_vm() {
    timeout 180 sudo -u "$UTENTE_BACKUP_REMOTO" env HOME=/tmp \
      "$CARTELLA_OCI/bin/oci" --auth instance_principal --connection-timeout 20 --read-timeout 60 "$@"
  }

  if [ -z "$OCI_NAMESPACE" ]; then
    if OCI_NAMESPACE=$(oci_vm os ns get --query data --raw-output < /dev/null) && [[ "$OCI_NAMESPACE" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
      info "Namespace ricavato con la CLI: $OCI_NAMESPACE"
    else
      OCI_NAMESPACE=
      avviso "Non riesco a ricavare il namespace con l'instance principal: lo cercherà
        il servizio a ogni backup. Puoi anche scriverlo in server.env (OCI_NAMESPACE=...)."
    fi
  else
    info "Namespace: $OCI_NAMESPACE"
  fi

  FILE_TMP=$(mktemp)
  cat > "$FILE_TMP" <<EOF
# Scritto da installa-server.sh: copia dei backup su Oracle Object Storage.
# Non contiene segreti (l'autenticazione è l'instance principal della VM).
OCI_BUCKET_BACKUP=$(printf '%q' "$OCI_BUCKET_BACKUP")
OCI_NAMESPACE=$(printf '%q' "$OCI_NAMESPACE")
EOF
  install -o root -g root -m 644 "$FILE_TMP" "$FILE_BACKUP_REMOTO"
  rm -f "$FILE_TMP"

  cat > /usr/local/sbin/pokeportfolio-backup-remoto <<'EOF'
#!/usr/bin/env bash
# Copia di un backup di PokéPortfolio su Oracle Object Storage (scritto da
# installa-server.sh). Di solito lo lancia systemd come utente
# pokeportfolio-backup:
#
#   sudo systemctl start pokeportfolio-backup-remoto@<etichetta>.service
#
# Carica l'ultimo /var/backups/pokeportfolio/pokeportfolio-<etichetta>-*.dump
# come oggetto pokeportfolio/<anno>/<nome del file>. Non cancella e non
# sovrascrive mai niente: se l'oggetto esiste già si ferma con un errore.
# Qualunque errore → uscita 1 e servizio in stato failed; il backup
# locale resta comunque valido.
set -euo pipefail
CONF=/etc/pokeportfolio/backup-remoto.conf
CARTELLA=/var/backups/pokeportfolio
OCI=/opt/oci-cli/bin/oci
TENTATIVI=3
PAUSA=60

fallito() { echo "[BACKUP REMOTO FALLITO] $*" >&2; exit 1; }
oci_vm() { "$OCI" --auth instance_principal --connection-timeout 20 --read-timeout 300 "$@" < /dev/null; }

ETICHETTA=${1:-}
case "$ETICHETTA" in *[!a-z0-9-]*|'') fallito "etichetta non valida: '$ETICHETTA'." ;; esac
[ -r "$CONF" ] || fallito "manca $CONF: rilancia l'installazione con OCI_BUCKET_BACKUP."
OCI_BUCKET_BACKUP=
OCI_NAMESPACE=
# shellcheck disable=SC1090
. "$CONF"
[ -n "$OCI_BUCKET_BACKUP" ] || fallito "OCI_BUCKET_BACKUP vuoto in $CONF."

# L'ultimo backup con questa etichetta (i nomi contengono data e ora).
# shellcheck disable=SC2012
FILE=$(ls -1t "$CARTELLA"/pokeportfolio-"$ETICHETTA"-*.dump 2>/dev/null | head -n 1 || true)
{ [ -n "$FILE" ] && [ -r "$FILE" ]; } || fallito "nessun backup leggibile pokeportfolio-$ETICHETTA-*.dump in $CARTELLA."
NOME=${FILE##*/}
[[ "$NOME" =~ ^pokeportfolio-[a-z0-9-]+-([0-9]{4})[0-9]{4}-[0-9]{6}\.dump$ ]] || fallito "nome del backup inatteso: $NOME."
OGGETTO="pokeportfolio/${BASH_REMATCH[1]}/$NOME"

if [ -z "$OCI_NAMESPACE" ]; then
  OCI_NAMESPACE=$(oci_vm os ns get --query data --raw-output) \
    || fallito "non riesco a ricavare il namespace: instance principal non disponibile?"
fi
DIMENSIONE=$(stat -c %s "$FILE")
MD5=$(openssl dgst -md5 -binary "$FILE" | base64)
echo "Backup $FILE ($DIMENSIONE byte) → bucket $OCI_BUCKET_BACKUP, oggetto $OGGETTO"

# MD5 (base64) dell'oggetto nel bucket, vuoto se non c'è (serve solo
# OBJECT_INSPECT).
md5_remoto() {
  oci_vm os object list --namespace "$OCI_NAMESPACE" --bucket-name "$OCI_BUCKET_BACKUP" \
    --prefix "$OGGETTO" --fields name,md5 --raw-output \
    --query "join(',', data[?name=='$OGGETTO'].md5 || \`[]\`)"
}

remoto=$(md5_remoto) || fallito "non riesco a elencare gli oggetti del bucket: policy, dynamic group, nome del bucket o rete?"
[ -z "$remoto" ] || fallito "l'oggetto $OGGETTO esiste già nel bucket: non lo sovrascrivo."

for tentativo in $(seq 1 "$TENTATIVI"); do
  # Niente --force: la CLI fa HeadObject e, se il nome è libero, carica
  # con If-None-Match: * (un oggetto comparso nel frattempo non viene
  # sovrascritto). --content-md5: Object Storage rifiuta un file arrivato
  # rovinato.
  if oci_vm os object put --namespace "$OCI_NAMESPACE" --bucket-name "$OCI_BUCKET_BACKUP" \
       --name "$OGGETTO" --file "$FILE" --no-multipart --content-md5 "$MD5" \
       --content-type application/octet-stream --verify-checksum; then
    echo "Copiato su Object Storage: $OGGETTO"
    exit 0
  fi
  # Un errore di rete può arrivare anche dopo che l'oggetto è stato
  # salvato: se ora c'è con lo stesso MD5, il caricamento è riuscito.
  remoto=$(md5_remoto 2>/dev/null || true)
  if [ "$remoto" = "$MD5" ]; then
    echo "Copiato su Object Storage: $OGGETTO (verificato dopo un errore della CLI)"
    exit 0
  fi
  [ -z "$remoto" ] || fallito "nel bucket c'è un $OGGETTO diverso dal backup locale: non lo tocco."
  if [ "$tentativo" -lt "$TENTATIVI" ]; then
    echo "Tentativo $tentativo di $TENTATIVI non riuscito: riprovo fra $PAUSA secondi." >&2
    sleep "$PAUSA"
  fi
done
fallito "caricamento di $OGGETTO non riuscito dopo $TENTATIVI tentativi. Il backup locale $FILE resta valido."
EOF
  chmod 755 /usr/local/sbin/pokeportfolio-backup-remoto

  cat > /etc/systemd/system/pokeportfolio-backup-remoto@.service <<EOF
# Scritto da installa-server.sh di PokéPortfolio.
# %i = etichetta del backup (notte, aggiornamento, ...).
[Unit]
Description=Copia del backup "%i" di PokéPortfolio su Oracle Object Storage
After=network-online.target pokeportfolio-backup.service
Wants=network-online.target

[Service]
Type=oneshot
User=$UTENTE_BACKUP_REMOTO
Group=$UTENTE_BACKUP_REMOTO
Environment=HOME=/tmp
ExecStart=/usr/local/sbin/pokeportfolio-backup-remoto %i
TimeoutStartSec=30min
# Protezioni: legge i backup (permessi del gruppo), parla solo in rete.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
InaccessiblePaths=-$CARTELLA_APP -/etc/ssh -/root
ProtectProc=invisible
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
UMask=0077
EOF
  install -d -m 755 "$(dirname "$DROPIN_BACKUP_REMOTO")"
  cat > "$DROPIN_BACKUP_REMOTO" <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio: dopo il backup notturno
# riuscito, la copia su Object Storage (unit separata, utente dedicato).
# Se pg_dump fallisce la copia non parte.
[Unit]
OnSuccess=pokeportfolio-backup-remoto@notte.service
EOF
  systemctl daemon-reload

  # Verifica in sola lettura: bucket (read buckets) ed elenco degli
  # oggetti (OBJECT_INSPECT). Se non va, solo un avviso.
  if [ -n "$OCI_NAMESPACE" ] \
     && oci_vm os bucket get --namespace "$OCI_NAMESPACE" --bucket-name "$OCI_BUCKET_BACKUP" \
       --query 'data.name' --raw-output < /dev/null >/dev/null \
     && oci_vm os object list --namespace "$OCI_NAMESPACE" --bucket-name "$OCI_BUCKET_BACKUP" \
       --prefix pokeportfolio/ --limit 1 < /dev/null >/dev/null; then
    info "Bucket raggiungibile con l'instance principal: copia attiva dopo ogni backup."
  else
    avviso "Non riesco a leggere il bucket $OCI_BUCKET_BACKUP con l'instance principal.
        La copia è configurata ma fallirà finché non sistemi su Oracle. Cause probabili:
        - dynamic group o policy non ancora creati, o con nomi diversi;
        - nome del bucket (o OCI_NAMESPACE) sbagliato, o bucket in un'altra regione
          (la CLI usa la regione della VM);
        - policy appena create: possono servire alcuni minuti prima che valgano.
        Poi prova con: sudo systemctl start pokeportfolio-backup.service
        (vedi \"Backup su Object Storage\" in deploy/README.md)."
  fi
fi


# ════════════════════════════════════════════════════════════════════
# 11. LIMITE AI LOG DI JOURNALD
# ════════════════════════════════════════════════════════════════════

passo "Log di sistema: massimo 500 MB"
install -d -m 755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/pokeportfolio.conf <<'EOF'
# Scritto da installa-server.sh di PokéPortfolio.
[Journal]
SystemMaxUse=500M
MaxRetentionSec=3month
EOF
systemctl restart systemd-journald


# ════════════════════════════════════════════════════════════════════
# 12. IMPOSTAZIONI RICORDATE E RIEPILOGO
# ════════════════════════════════════════════════════════════════════

install -d -m 755 /etc/pokeportfolio
cat > "$FILE_IMPOSTAZIONI" <<EOF
# Scritto da installa-server.sh: valori usati al prossimo lancio.
DOMINIO_SALVATO=$(printf '%q' "${DOMINIO:-nessuno}")
REPO_URL_SALVATO=$(printf '%q' "$REPO_URL")
BRANCH_SALVATO=$(printf '%q' "$BRANCH")
OCI_BUCKET_BACKUP_SALVATO=$(printf '%q' "${OCI_BUCKET_BACKUP:-nessuno}")
OCI_NAMESPACE_SALVATO=$(printf '%q' "$OCI_NAMESPACE")
EOF

# Verifica: l'app deve ascoltare solo su 127.0.0.1 (davanti c'è Caddy).
if ss -Hltn "sport = :$PORTA_APP" | awk '{ print $4 }' | grep -Ev '^127\.0\.0\.1:' | grep -q .; then
  avviso "L'app è in ascolto anche fuori da 127.0.0.1: controlla HOST in $FILE_ENV."
fi

if [ "$BACKUP_REMOTO" = 1 ] && [ "${CLI_OCI:-0}" = 1 ]; then
  DESCRIZIONE_BACKUP_REMOTO="bucket $OCI_BUCKET_BACKUP su Oracle Object Storage, dopo ogni backup"
else
  DESCRIZIONE_BACKUP_REMOTO="non attiva (facoltativa, vedi README.md)"
fi

if [ -n "$DOMINIO" ]; then
  URL_APP="https://$DOMINIO"
else
  IP_PUBBLICO=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  URL_APP="http://$IP_PUBBLICO"
fi

cat <<EOF

════════════════════════════════════════════════════════════════════
 PokéPortfolio installato
════════════════════════════════════════════════════════════════════
 App:            $URL_APP
 Codice:         $CARTELLA_APP (branch $BRANCH, commit $(come_app git -C "$CARTELLA_APP" log -1 --format='%h %s'))
 Configurazione: $FILE_ENV
 Database:       PostgreSQL $VERSIONE_PG, database $NOME_DB, porta $PORTA_PG (solo locale)
 Backup:         $CARTELLA_BACKUP (ogni notte alle 02:30)
 Copia remota:   $DESCRIZIONE_BACKUP_REMOTO
 Sicurezza:      SSH solo con chiave, fail2ban, aggiornamenti automatici
                 (riavvio alle 04:30 se serve), firewall con 22, 80 e 443

 Comandi utili:
   sudo systemctl status pokeportfolio          stato dell'app
   sudo journalctl -u pokeportfolio -f          log in diretta (Ctrl+C per uscire)
   sudo systemctl restart pokeportfolio         riavvio dell'app
   sudo -u postgres pokeportfolio-backup        backup manuale del database
   sudo ls -lh $CARTELLA_BACKUP       elenco dei backup
   systemctl list-timers 'pokeportfolio-*'      prossimi backup e aggiornamenti DuckDNS
   sudo fail2ban-client status sshd             IP bloccati da fail2ban
   sudo journalctl -u pokeportfolio-duckdns     esito degli aggiornamenti DuckDNS
   sudo journalctl -u 'pokeportfolio-backup*'   esito dei backup e delle copie remote

 Prossimi passi: apri l'indirizzo dell'app qui sopra e registrati
 (guida completa nel README.md del progetto). Aggiornamenti dal PC con
 npm run deploy.
════════════════════════════════════════════════════════════════════
EOF
