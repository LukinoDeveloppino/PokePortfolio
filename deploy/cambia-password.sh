#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# cambia-password.sh — LINK PER REIMPOSTARE LA PASSWORD, SUL SERVER
# ════════════════════════════════════════════════════════════════════
# Da lanciare dal PC:  npm run password -- <username>
# Si collega al server e avvia server/scripts/cambia-password.js come
# utente dell'app: stampa un link monouso, valido 24 ore, da mandare
# all'utente, che dal link sceglie da solo la password nuova.
# Server, chiave e dominio: SERVER, CHIAVE e DOMINIO (vedi comune.sh).
# ════════════════════════════════════════════════════════════════════

set -euo pipefail
# shellcheck source=deploy/comune.sh
. "$(dirname "${BASH_SOURCE[0]}")/comune.sh"

controlla_server
USERNAME_DA_CAMBIARE=${1:-}
[ -n "$USERNAME_DA_CAMBIARE" ] || errore "Uso: npm run password -- <username>"
# Lo username finisce in un comando remoto: accetto solo caratteri sicuri.
[[ "$USERNAME_DA_CAMBIARE" =~ ^[A-Za-z0-9._-]{1,64}$ ]] \
  || errore "Username non valido: sono ammessi lettere, numeri, punto, trattino e trattino basso."

# Indirizzo dell'app per il link: il dominio, oppure l'IP del server se
# il dominio non c'è (DOMINIO=nessuno, solo HTTP).
DOMINIO=${DOMINIO:-$(leggi_impostazione DOMINIO)}
if [ -n "$DOMINIO" ] && [ "$DOMINIO" != nessuno ]; then
  URL_APP="https://$DOMINIO"
else
  URL_APP="http://${SERVER#*@}"
fi
# Anche l'indirizzo finisce nel comando remoto.
[[ "$URL_APP" =~ ^https?://[A-Za-z0-9.-]+$ ]] || errore "DOMINIO non valido: '$DOMINIO'."

controlla_chiave
passo "Link per la nuova password di $USERNAME_DA_CAMBIARE su $SERVER"
ssh "${OPZIONI_SSH[@]}" "$SERVER" \
  "sudo -u pokeportfolio -H bash -c 'cd /opt/pokeportfolio && URL_APP=$URL_APP node --env-file=.env server/scripts/cambia-password.js $USERNAME_DA_CAMBIARE'"
