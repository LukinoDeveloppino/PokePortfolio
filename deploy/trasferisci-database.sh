#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# trasferisci-database.sh — COPIA IL DATABASE DEL PC SUL SERVER
# ════════════════════════════════════════════════════════════════════
# Da lanciare sul PC, una volta, dopo installa-server.sh, con il database
# locale acceso (npm run db:local in un altro terminale):
#
#   npm run db:trasferisci                  copia il database
#   npm run db:trasferisci -- --dry-run     mostra cosa farebbe
#
# ATTENZIONE: il database del server viene SOSTITUITO da quello del PC
# (prima ne viene fatto un backup in /var/backups/pokeportfolio).
#
# Come funziona: embedded-postgres non installa pg_dump sul PC, quindi
# il dump lo fa il pg_dump 18 del server attraverso un tunnel SSH inverso
# verso il PostgreSQL del PC (vedi remoto/ricevi-database.sh). Nessun
# programma da installare sul PC e stessa versione (18) ai due capi.
#
# Impostazioni: SERVER e CHIAVE (vedi comune.sh), DB_LOCAL_PORT (porta
# del PostgreSQL del PC, predefinita 5432).
# ════════════════════════════════════════════════════════════════════

set -euo pipefail
# shellcheck source=deploy/comune.sh
. "$(dirname "${BASH_SOURCE[0]}")/comune.sh"

PROVA=0
SI_A_TUTTO=0
for argomento in "$@"; do
  case "$argomento" in
    --dry-run|--prova) PROVA=1 ;;
    --si|--yes|-y)     SI_A_TUTTO=1 ;;
    -h|--help)         sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) errore "Opzione sconosciuta: $argomento (usa --dry-run, --si o --help)" ;;
  esac
done

controlla_server
PORTA_PC=${DB_LOCAL_PORT:-5432}
[[ "$PORTA_PC" =~ ^[0-9]{1,5}$ ]] || errore "DB_LOCAL_PORT non valida: '$PORTA_PC'."
# Porta del server su cui arriva il tunnel (solo su 127.0.0.1 del server).
PORTA_TUNNEL=15432
SCRIPT_REMOTO="$CARTELLA_DEPLOY/remoto/ricevi-database.sh"
COMANDO_SSH=(ssh "${OPZIONI_SSH[@]}" -o ExitOnForwardFailure=yes
             -R "127.0.0.1:$PORTA_TUNNEL:127.0.0.1:$PORTA_PC"
             "$SERVER" bash -s -- "$PORTA_TUNNEL")

if [ "$PROVA" = 1 ]; then
  passo "Prova (--dry-run): nessun collegamento al server"
  info "Server: $SERVER (chiave $CHIAVE)"
  echo "Comando che verrebbe eseguito:"
  mostra_comando "${COMANDO_SSH[@]}"
  echo "    con in ingresso lo script $SCRIPT_REMOTO."
  bash -n "$SCRIPT_REMOTO" && info "Sintassi dello script remoto: ok."
  exit 0
fi

passo "Controlli sul PC"
if ! (exec 3<>"/dev/tcp/127.0.0.1/$PORTA_PC") 2>/dev/null; then
  errore "Il PostgreSQL del PC non risponde sulla porta $PORTA_PC.
        Avvialo in un altro terminale con: npm run db:local"
fi
info "PostgreSQL del PC acceso sulla porta $PORTA_PC."
controlla_chiave
conferma "Il database del server $SERVER verrà SOSTITUITO con quello del PC (prima ne faccio un backup)."

passo "Trasferimento verso $SERVER"
"${COMANDO_SSH[@]}" < "$SCRIPT_REMOTO"
