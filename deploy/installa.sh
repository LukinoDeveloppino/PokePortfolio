#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# installa.sh — INSTALLA (O REINSTALLA) IL SERVER DAL PC
# ════════════════════════════════════════════════════════════════════
# Uso, dalla cartella del progetto:
#
#   npm run installa                  installa o sistema il server
#   npm run installa -- --dry-run     mostra cosa farebbe, senza collegarsi
#
# Copia deploy/installa-server.sh sul server e lo esegue con sudo. Le
# impostazioni e i segreti stanno sul PC in
# ~/.config/pokeportfolio/server.env (permessi 600) e arrivano al server
# sullo standard input della connessione SSH: mai sulla riga di comando,
# mai nel repository. Righe del file:
#
#   SERVER=ubuntu@1.2.3.4          utente e IP del server
#   DOMINIO=tuonome.duckdns.org    dominio dell'app ("nessuno" = HTTP
#                                  sull'IP, solo per prove)
#   CARDTRADER_DEFAULT_TOKEN=...   API key CardTrader del proprietario
#   DUCKDNS_TOKEN=...              token di duckdns.org
#   CHIAVE, BRANCH, REPO_URL       facoltative, vedi comune.sh
#   OCI_BUCKET_BACKUP=...          facoltativa: bucket di Oracle Object
#                                  Storage per una copia dei backup
#                                  ("nessuno" = spenta)
#   OCI_NAMESPACE=...              facoltativa: namespace Object Storage
#                                  (se manca lo ricava il server)
#
# Si può rilanciare: installa-server.sh non rifà quello che c'è già.
# ════════════════════════════════════════════════════════════════════

set -euo pipefail
# shellcheck source=deploy/comune.sh
. "$(dirname "${BASH_SOURCE[0]}")/comune.sh"

PROVA=0
for argomento in "$@"; do
  case "$argomento" in
    --dry-run|--prova) PROVA=1 ;;
    -h|--help)         sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) errore "Opzione sconosciuta: $argomento (usa --dry-run o --help)" ;;
  esac
done

SCRIPT_SERVER="$CARTELLA_DEPLOY/installa-server.sh"
DESTINAZIONE=installa-server.sh   # nella home di ubuntu sul server
# Le sole righe del file che vengono mandate così come sono al server.
SEGRETI_DA_MANDARE='^(CARDTRADER_DEFAULT_TOKEN|DUCKDNS_TOKEN)='
NOMI_NOTI='^(SERVER|DOMINIO|CHIAVE|BRANCH|REPO_URL|CARDTRADER_DEFAULT_TOKEN|DUCKDNS_TOKEN|OCI_BUCKET_BACKUP|OCI_NAMESPACE)='
# Nomi di bucket e namespace di Oracle Object Storage (non segreti).
REGEX_NOME_OCI='^[A-Za-z0-9._-]{1,256}$'
# Un nome a dominio: etichette di lettere minuscole, cifre e trattini,
# separate da punti, con un suffisso di sole lettere (es. tuonome.duckdns.org).
REGEX_DOMINIO='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
presenti=


# ---- File delle impostazioni sul PC ----
passo "Impostazioni e segreti in $FILE_SEGRETI"
if [ ! -f "$FILE_SEGRETI" ]; then
  if [ "$PROVA" = 1 ]; then
    avviso "Il file non esiste ancora: senza --dry-run lo creerei vuoto, da compilare."
  else
    mkdir -p "$(dirname "$FILE_SEGRETI")"
    ( umask 077
      cat > "$FILE_SEGRETI" <<'EOF'
# Impostazioni e segreti per il server PokéPortfolio (cartella deploy/).
# Resta solo su questo PC: non copiarlo nel progetto e non condividerlo.
# Una riga per valore, NOME=valore, senza spazi né virgolette.

# Utente e IP pubblico del server, per esempio SERVER=ubuntu@1.2.3.4
SERVER=

# Dominio dell'app, per esempio DOMINIO=tuonome.duckdns.org
# (DOMINIO=nessuno = HTTP sull'IP, solo per prove).
DOMINIO=

# API key CardTrader del proprietario (cardtrader.com → impostazioni del
# profilo → sezione API).
CARDTRADER_DEFAULT_TOKEN=

# Token che trovi su duckdns.org dopo l'accesso.
DUCKDNS_TOKEN=

# Facoltativo: dove si trova la chiave SSH (predefinita ~/.ssh/pokeportfolio.key).
#CHIAVE=

# Facoltativo: copia di ogni backup del database su Oracle Object Storage
# (README.md, "Backup anche fuori dal server"). Nome del bucket privato
# creato su Oracle, per esempio OCI_BUCKET_BACKUP=pokeportfolio-backup
# (OCI_BUCKET_BACKUP=nessuno = copia spenta). Non è un segreto: il server
# si autentica come istanza (dynamic group e policy), senza chiavi.
#OCI_BUCKET_BACKUP=
# Facoltativo: namespace Object Storage della tenancy (se manca lo ricava
# il server).
#OCI_NAMESPACE=
EOF
    )
    errore "Ho creato $FILE_SEGRETI (permessi 600): aprilo con un editor
        (per esempio: nano $FILE_SEGRETI), compila i valori e rilancia npm run installa."
  fi
else
  case "$(permessi_di "$FILE_SEGRETI")" in
    600|400) ;;
    *) errore "$FILE_SEGRETI deve essere leggibile solo da te: chmod 600 $FILE_SEGRETI" ;;
  esac
  # Solo i nomi delle variabili compilate, mai i valori.
  presenti=$(grep -E "$NOMI_NOTI" "$FILE_SEGRETI" | grep -Ev '^[A-Z_]+=$' | cut -d= -f1 | sort -u | tr '\n' ' ' || true)
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
fi

controlla_server
info "Server: $SERVER (chiave $CHIAVE)"

# ---- Dominio: variabile DOMINIO, altrimenti la riga del file ----
dominio=${DOMINIO:-$(leggi_impostazione DOMINIO)}
dominio=$(printf '%s' "$dominio" | tr '[:upper:]' '[:lower:]')
[ -n "$dominio" ] || errore "Manca il dominio. Aggiungi in $FILE_SEGRETI la riga
        DOMINIO=tuonome.duckdns.org
        (il tuo sottodominio DuckDNS, vedi README.md passo 6) e rilancia.
        Solo per una prova senza HTTPS: DOMINIO=nessuno"
if [ "$dominio" != nessuno ] && ! [[ "$dominio" =~ $REGEX_DOMINIO ]]; then
  errore "DOMINIO non valido: '$dominio'. Scrivi solo il nome, senza https:// e senza
        barre, per esempio DOMINIO=tuonome.duckdns.org"
fi
case "$dominio" in
  *.duckdns.org)
    case " $presenti " in
      *" DUCKDNS_TOKEN "*) ;;
      *)
        if [ "$PROVA" = 1 ]; then
          avviso "DOMINIO è un *.duckdns.org ma manca DUCKDNS_TOKEN: senza --dry-run mi fermerei qui."
        else
          errore "DOMINIO è un *.duckdns.org ma manca DUCKDNS_TOKEN in $FILE_SEGRETI."
        fi ;;
    esac ;;
esac
if [ "$dominio" != nessuno ]; then info "Dominio: $dominio (HTTPS)"; else info "Dominio: nessuno (HTTP sull'IP, solo per prove)"; fi
info "Codice: $REPO_URL (branch $BRANCH)"

# ---- Copia dei backup su Oracle Object Storage (facoltativa) ----
bucket_backup=${OCI_BUCKET_BACKUP:-$(leggi_impostazione OCI_BUCKET_BACKUP)}
namespace_oci=${OCI_NAMESPACE:-$(leggi_impostazione OCI_NAMESPACE)}
if [ -n "$bucket_backup" ] && ! [[ "$bucket_backup" =~ $REGEX_NOME_OCI ]]; then
  errore "OCI_BUCKET_BACKUP non valido: '$bucket_backup'. Solo lettere, cifre, punti,
        trattini e trattini bassi, per esempio OCI_BUCKET_BACKUP=pokeportfolio-backup"
fi
if [ -n "$namespace_oci" ] && ! [[ "$namespace_oci" =~ $REGEX_NOME_OCI ]]; then
  errore "OCI_NAMESPACE non valido: '$namespace_oci'."
fi
case "$bucket_backup" in
  '')      info "Copia dei backup su Object Storage: non configurata (facoltativa)." ;;
  nessuno) info "Copia dei backup su Object Storage: da spegnere (OCI_BUCKET_BACKUP=nessuno)." ;;
  *)       info "Copia dei backup su Object Storage: attiva, bucket $bucket_backup, namespace ${namespace_oci:-ricavato dal server}." ;;
esac

COMANDO_COPIA=(scp "${OPZIONI_SSH[@]}" -q "$SCRIPT_SERVER" "$SERVER:$DESTINAZIONE")
COMANDO_ESEGUI=(ssh "${OPZIONI_SSH[@]}" "$SERVER"
                "sudo bash $DESTINAZIONE --segreti-da-stdin; esito=\$?; rm -f $DESTINAZIONE; exit \$esito")

if [ "$PROVA" = 1 ]; then
  passo "Prova (--dry-run): nessun collegamento al server"
  echo "1. Copia dello script di installazione:"
  mostra_comando "${COMANDO_COPIA[@]}"
  echo "2. Esecuzione con sudo, con in ingresso le righe CARDTRADER_DEFAULT_TOKEN e"
  echo "   DUCKDNS_TOKEN di $FILE_SEGRETI più DOMINIO=$dominio, BRANCH e REPO_URL"
  [ -z "$bucket_backup" ] || echo "   e OCI_BUCKET_BACKUP=$bucket_backup${namespace_oci:+, OCI_NAMESPACE=$namespace_oci}"
  echo "   (valori segreti non mostrati):"
  mostra_comando "${COMANDO_ESEGUI[@]}"
  bash -n "$SCRIPT_SERVER" && info "Sintassi di installa-server.sh: ok."
  exit 0
fi

controlla_chiave
passo "Copio installa-server.sh su $SERVER"
"${COMANDO_COPIA[@]}"

passo "Eseguo l'installazione sul server (alcuni minuti la prima volta)"
# I due segreti del file più dominio, branch, repository e (se ci sono)
# bucket e namespace per la copia dei backup, scelti sopra.
{ grep -E "$SEGRETI_DA_MANDARE" "$FILE_SEGRETI" || true
  printf 'DOMINIO=%s\nBRANCH=%s\nREPO_URL=%s\n' "$dominio" "$BRANCH" "$REPO_URL"
  [ -z "$bucket_backup" ] || printf 'OCI_BUCKET_BACKUP=%s\n' "$bucket_backup"
  [ -z "$namespace_oci" ] || printf 'OCI_NAMESPACE=%s\n' "$namespace_oci"
} | "${COMANDO_ESEGUI[@]}"
