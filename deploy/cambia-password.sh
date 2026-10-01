#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# cambia-password.sh — NUOVA PASSWORD PER UN UTENTE, SUL SERVER
# ════════════════════════════════════════════════════════════════════
# Da lanciare dal PC:  npm run password -- <username>
# Si collega al server e avvia server/scripts/cambia-password.js come
# utente dell'app: la password si digita nel terminale (non compare a
# schermo e non passa per la riga di comando), viene salvata come hash
# scrypt e le sessioni aperte dell'utente vengono chiuse.
# ════════════════════════════════════════════════════════════════════

set -euo pipefail
# shellcheck source=deploy/comune.sh
. "$(dirname "${BASH_SOURCE[0]}")/comune.sh"

USERNAME_DA_CAMBIARE=${1:-}
[ -n "$USERNAME_DA_CAMBIARE" ] || errore "Uso: npm run password -- <username>"
# Lo username finisce in un comando remoto: accetto solo caratteri sicuri.
[[ "$USERNAME_DA_CAMBIARE" =~ ^[A-Za-z0-9._-]{1,64}$ ]] \
  || errore "Username non valido: sono ammessi lettere, numeri, punto, trattino e trattino basso."
[ -t 0 ] || errore "Serve un terminale interattivo: lancia il comando da un terminale normale."

controlla_chiave
passo "Cambio password di $USERNAME_DA_CAMBIARE su $SERVER"
# -t: terminale interattivo per digitare la password senza mostrarla.
# BatchMode resta attivo: l'accesso è solo con la chiave.
ssh -t "${OPZIONI_SSH[@]}" "$SERVER" \
  "sudo -u pokeportfolio -H bash -c 'cd /opt/pokeportfolio && node --env-file=.env server/scripts/cambia-password.js $USERNAME_DA_CAMBIARE'"
