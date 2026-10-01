#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# ricevi-database.sh — PARTE DI trasferisci-database.sh CHE GIRA SUL SERVER
# ════════════════════════════════════════════════════════════════════
# Non va lanciato a mano: trasferisci-database.sh apre un tunnel SSH
# inverso (la porta <porta_tunnel> del server porta al PostgreSQL del PC)
# e manda questo script al server con bash -s -- <porta_tunnel>.
#
#   1. pg_dump del database del PC attraverso il tunnel, con il pg_dump 18
#      del server (sul PC embedded-postgres non ha pg_dump);
#   2. backup del database attuale del server;
#   3. app ferma, pg_restore del dump, app riavviata;
#   4. confronto dei conteggi fra PC e server.
# ════════════════════════════════════════════════════════════════════

set -Eeuo pipefail

PORTA_TUNNEL=${1:?porta del tunnel mancante}
VERSIONE_PG=18
NOME_DB=pokeportfolio
RUOLO_APP=pokeportfolio
CARTELLA_BACKUP=/var/backups/pokeportfolio
URL_SALUTE=http://127.0.0.1:3000/api/health
# Credenziali del PostgreSQL di sviluppo (server/scripts/db-local.js):
# non sono segrete e valgono solo sul PC.
URL_PC="postgresql://pokeportfolio:pokeportfolio@127.0.0.1:$PORTA_TUNNEL/pokeportfolio"

passo()  { printf '\n\033[1;34m[server] ==> %s\033[0m\n' "$*"; }
info()   { printf '    %s\n' "$*"; }
errore() { printf '\033[1;31m[ERRORE]\033[0m %s\n' "$*" >&2; exit 1; }

come_postgres() { sudo -u postgres "$@"; }

conteggi() { # <argomenti di connessione di psql...>
  come_postgres psql -X -tA -v ON_ERROR_STOP=1 "$@" -c "
    SELECT 'utenti '            || (SELECT count(*) FROM users)              || E'\n' ||
           'voci '              || (SELECT count(*) FROM collection_items)   || E'\n' ||
           'storico_voci '      || (SELECT count(*) FROM item_price_history) || E'\n' ||
           'storico_valore '    || (SELECT count(*) FROM value_history)      || E'\n' ||
           'set '               || (SELECT count(*) FROM sets)               || E'\n' ||
           'carte '             || (SELECT count(*) FROM cards)"
}

principale() {
  [ -x /usr/local/sbin/pokeportfolio-backup ] || errore "Lancia prima deploy/installa-server.sh sul server."
  local porta_pg file_dump conteggi_pc conteggi_server
  porta_pg=$(pg_lsclusters -h | awk -v v="$VERSIONE_PG" '$1 == v && $2 == "main" { print $3 }')
  [ -n "$porta_pg" ] || errore "Non trovo il cluster PostgreSQL $VERSIONE_PG/main sul server."

  # ---- 1. Dump del PC attraverso il tunnel ----
  passo "Dump del database del PC (attraverso il tunnel SSH)"
  conteggi_pc=$(conteggi "$URL_PC") || errore "Non riesco a leggere il database del PC: è acceso (npm run db:local)?"
  file_dump="$CARTELLA_BACKUP/pokeportfolio-dal-pc-$(date +%Y%m%d-%H%M%S).dump"
  come_postgres pg_dump -Fc -d "$URL_PC" -f "$file_dump"
  info "Salvato in $file_dump ($(sudo du -h "$file_dump" | cut -f1))."

  # ---- 2. Backup del server ----
  passo "Backup del database attuale del server"
  come_postgres /usr/local/sbin/pokeportfolio-backup prima-trasferimento

  # ---- 3. Ripristino ----
  passo "Ripristino sul server (app ferma per qualche secondo)"
  sudo systemctl stop pokeportfolio
  # Se il ripristino fallisce l'app riparte comunque, con i dati di prima:
  # --single-transaction annulla tutto in caso di errore.
  trap 'sudo systemctl start pokeportfolio' EXIT
  come_postgres pg_restore -p "$porta_pg" -d "$NOME_DB" --clean --if-exists \
    --no-owner --no-acl --role="$RUOLO_APP" --single-transaction --exit-on-error "$file_dump"
  trap - EXIT
  sudo systemctl start pokeportfolio

  local i
  for i in $(seq 1 20); do
    curl -fsS --max-time 5 "$URL_SALUTE" >/dev/null 2>&1 && break
    [ "$i" = 20 ] && { sudo journalctl -u pokeportfolio -n 40 --no-pager; errore "L'app non risponde dopo il ripristino."; }
    sleep 3
  done
  info "L'app risponde."

  # ---- 4. Confronto ----
  passo "Confronto PC / server"
  conteggi_server=$(conteggi -p "$porta_pg" -d "$NOME_DB")
  paste <(printf '%s\n' "$conteggi_pc") <(printf '%s\n' "$conteggi_server") |
    awk '{ printf "    %-16s PC %8s   server %8s   %s\n", $1, $2, $4, ($2 == $4 ? "ok" : "DIVERSO") }'
  if [ "$conteggi_pc" != "$conteggi_server" ]; then
    errore "I conteggi non coincidono: controlla prima di usare l'app. Il backup del server di prima è in
          $CARTELLA_BACKUP (pokeportfolio-prima-trasferimento-*.dump)."
  fi
  echo
  echo "Trasferimento riuscito. Al primo avvio l'app ha applicato le migrazioni mancanti."
}

principale < /dev/null
exit
