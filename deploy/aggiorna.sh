#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# aggiorna.sh — AGGIORNA L'APP SUL SERVER (da lanciare sul PC)
# ════════════════════════════════════════════════════════════════════
# Uso, dalla cartella del progetto:
#
#   npm run deploy                  aggiorna il server
#   npm run deploy -- --dry-run     mostra cosa farebbe, senza collegarsi
#   npm run deploy -- --si          non chiede conferme
#
# Il server scarica il codice da GitHub (branch BRANCH, predefinito
# feat/backend-server): chi ha modifiche sue fa prima git push. Lo script
# avvisa se ci sono commit non pushati.
#
# Sul server (vedi remoto/aggiorna-sul-server.sh): backup del database,
# ultimo commit da GitHub, npm ci se servono, migrazioni, riavvio e
# health check. Se l'app non risponde torna da sola al commit di prima.
#
# Impostazioni: SERVER (obbligatoria), CHIAVE e BRANCH, nel file
# ~/.config/pokeportfolio/server.env o come variabili d'ambiente (vedi
# comune.sh).
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
    -h|--help)         sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) errore "Opzione sconosciuta: $argomento (usa --dry-run, --si o --help)" ;;
  esac
done

controlla_server
SCRIPT_REMOTO="$CARTELLA_DEPLOY/remoto/aggiorna-sul-server.sh"
COMANDO_SSH=(ssh "${OPZIONI_SSH[@]}" "$SERVER" bash -s -- "$BRANCH")

passo "Controllo dei commit sul PC"
if controlla_commit_non_pushati; then
  info "Tutti i commit di $BRANCH sono su GitHub."
elif [ "$PROVA" = 0 ]; then
  conferma "Il server installerà la versione che è su GitHub, non quella del PC."
fi

if [ "$PROVA" = 1 ]; then
  passo "Prova (--dry-run): nessun collegamento al server"
  info "Server: $SERVER (chiave $CHIAVE), branch $BRANCH"
  echo "Comando che verrebbe eseguito:"
  mostra_comando "${COMANDO_SSH[@]}"
  echo "    con in ingresso lo script $SCRIPT_REMOTO:"
  echo "────────────────────────────────────────────────────────────────────"
  cat "$SCRIPT_REMOTO"
  echo "────────────────────────────────────────────────────────────────────"
  bash -n "$SCRIPT_REMOTO" && info "Sintassi dello script remoto: ok."
  exit 0
fi

controlla_chiave
passo "Aggiorno $SERVER"
"${COMANDO_SSH[@]}" < "$SCRIPT_REMOTO"
