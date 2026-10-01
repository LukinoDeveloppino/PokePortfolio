#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# installa.sh — INSTALLA (O REINSTALLA) IL SERVER DAL PC
# ════════════════════════════════════════════════════════════════════
# Uso, dalla cartella del progetto:
#
#   npm run installa                  installa o sistema il server
#   npm run installa -- --dry-run     mostra cosa farebbe, senza collegarsi
#
# Copia deploy/installa-server.sh sul server e lo esegue con sudo. I
# segreti stanno sul PC in ~/.config/pokeportfolio/server.env (permessi
# 600) e arrivano al server sullo standard input della connessione SSH:
# mai sulla riga di comando, mai nel repository.
#
#   CARDTRADER_DEFAULT_TOKEN=...   API key CardTrader del proprietario
#   DUCKDNS_TOKEN=...              token di duckdns.org
#   DOMINIO=...                    facoltativo: predefinito
#                                  pokeportfolio.duckdns.org; "nessuno" =
#                                  HTTP sull'IP (temporaneo)
#
# Si può rilanciare: installa-server.sh non rifà quello che c'è già.
# Variabili: SERVER, CHIAVE (vedi comune.sh), FILE_SEGRETI.
# ════════════════════════════════════════════════════════════════════

set -euo pipefail
# shellcheck source=deploy/comune.sh
. "$(dirname "${BASH_SOURCE[0]}")/comune.sh"

PROVA=0
for argomento in "$@"; do
  case "$argomento" in
    --dry-run|--prova) PROVA=1 ;;
    -h|--help)         sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) errore "Opzione sconosciuta: $argomento (usa --dry-run o --help)" ;;
  esac
done

FILE_SEGRETI=${FILE_SEGRETI:-$HOME/.config/pokeportfolio/server.env}
SCRIPT_SERVER="$CARTELLA_DEPLOY/installa-server.sh"
DESTINAZIONE=installa-server.sh   # nella home di ubuntu sul server
NOMI_AMMESSI='^(CARDTRADER_DEFAULT_TOKEN|DUCKDNS_TOKEN|DOMINIO)='
DOMINIO_PREDEFINITO=pokeportfolio.duckdns.org
dominio=${DOMINIO:-}


# ---- File dei segreti sul PC ----
passo "Segreti in $FILE_SEGRETI"
if [ ! -f "$FILE_SEGRETI" ]; then
  if [ "$PROVA" = 1 ]; then
    avviso "Il file non esiste ancora: senza --dry-run lo creerei vuoto, da compilare."
  else
    mkdir -p "$(dirname "$FILE_SEGRETI")"
    ( umask 077
      cat > "$FILE_SEGRETI" <<'EOF'
# Segreti per l'installazione del server PokéPortfolio (deploy/installa.sh).
# Resta solo su questo PC: non copiarlo nel progetto e non condividerlo.

# API key CardTrader del proprietario (la stessa di CARDTRADER_DEFAULT_TOKEN
# nel file .env del progetto).
CARDTRADER_DEFAULT_TOKEN=

# Token che trovi su duckdns.org dopo l'accesso.
DUCKDNS_TOKEN=

# Facoltativo: il dominio è pokeportfolio.duckdns.org. Con
# DOMINIO=nessuno l'app resta in HTTP sull'IP (temporaneo).
#DOMINIO=
EOF
    )
    errore "Ho creato $FILE_SEGRETI (permessi 600): aprilo con un editor,
        compila i valori e rilancia npm run installa."
  fi
else
  case "$(stat -c '%a' "$FILE_SEGRETI")" in
    600|400) ;;
    *) errore "$FILE_SEGRETI deve essere leggibile solo da te: chmod 600 $FILE_SEGRETI" ;;
  esac
  # Solo i nomi delle variabili compilate, mai i valori.
  presenti=$(grep -E "$NOMI_AMMESSI" "$FILE_SEGRETI" | grep -Ev '^[A-Z_]+=$' | cut -d= -f1 | tr '\n' ' ' || true)
  info "Compilate: ${presenti:-nessuna}"
  case " $presenti " in
    *" CARDTRADER_DEFAULT_TOKEN "*) ;;
    *)
      if [ "$PROVA" = 1 ]; then
        avviso "Manca CARDTRADER_DEFAULT_TOKEN: senza --dry-run mi fermerei qui."
      else
        errore "Manca CARDTRADER_DEFAULT_TOKEN in $FILE_SEGRETI."
      fi ;;
  esac
  # Dominio: variabile DOMINIO, poi il file, poi quello predefinito.
  [ -n "$dominio" ] || dominio=$(sed -n 's/^DOMINIO=//p' "$FILE_SEGRETI" | tail -n 1)
  [ -n "$dominio" ] || dominio=$DOMINIO_PREDEFINITO
  case "$dominio" in
    *.duckdns.org)
      case " $presenti " in
        *" DUCKDNS_TOKEN "*) ;;
        *) errore "DOMINIO è un *.duckdns.org ma manca DUCKDNS_TOKEN in $FILE_SEGRETI." ;;
      esac ;;
  esac
  if [ "$dominio" != nessuno ]; then info "Dominio: $dominio (HTTPS)"; else info "Dominio: nessuno (HTTP sull'IP, temporaneo)"; fi
fi

COMANDO_COPIA=(scp "${OPZIONI_SSH[@]}" -q "$SCRIPT_SERVER" "$SERVER:$DESTINAZIONE")
COMANDO_ESEGUI=(ssh "${OPZIONI_SSH[@]}" "$SERVER"
                "sudo bash $DESTINAZIONE --segreti-da-stdin; esito=\$?; rm -f $DESTINAZIONE; exit \$esito")

if [ "$PROVA" = 1 ]; then
  passo "Prova (--dry-run): nessun collegamento al server"
  echo "1. Copia dello script di installazione:"
  mostra_comando "${COMANDO_COPIA[@]}"
  echo "2. Esecuzione con sudo, con in ingresso le righe CARDTRADER_DEFAULT_TOKEN e"
  echo "   DUCKDNS_TOKEN di $FILE_SEGRETI più DOMINIO=${dominio:-$DOMINIO_PREDEFINITO}:"
  mostra_comando "${COMANDO_ESEGUI[@]}"
  bash -n "$SCRIPT_SERVER" && info "Sintassi di installa-server.sh: ok."
  exit 0
fi

controlla_chiave
passo "Copio installa-server.sh su $SERVER"
"${COMANDO_COPIA[@]}"

passo "Eseguo l'installazione sul server (alcuni minuti la prima volta)"
# Le righe ammesse del file (senza DOMINIO) più il dominio scelto sopra.
{ grep -E "$NOMI_AMMESSI" "$FILE_SEGRETI" | grep -v '^DOMINIO=' || true
  echo "DOMINIO=$dominio"
} | "${COMANDO_ESEGUI[@]}"
