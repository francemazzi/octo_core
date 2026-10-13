#!/usr/bin/env bash
# Sets the macOS signing secrets in the GitHub environment `macos-release`.
#
# GitHub never shows a secret again, so moving the Apple secrets from the repository to the environment means entering
# them once more. This script holds no value: it reads local files and prompts, and sends each value to `gh secret set`
# over stdin (never on a command line, never to a file in the repository, never to a log).
#
#   scripts/release/set-macos-secrets.sh            # asks for every value
#   REPO=owner/name ENVIRONMENT=name scripts/release/set-macos-secrets.sh
#
# Needs: gh (logged in, admin on the repository) and the files exported from your own machine:
#   - the Developer ID Application certificate exported from Keychain Access as .p12 (with its export password)
#   - the App Store Connect API key AuthKey_<KEYID>.p8 (Key ID and Issuer ID are shown on the same App Store Connect page)
# Press Enter on a prompt to skip that secret and keep whatever the environment already has.
set -euo pipefail

REPO="${REPO:-francemazzi/octo_core}"
ENVIRONMENT="${ENVIRONMENT:-macos-release}"

command -v gh >/dev/null || { echo "gh non trovato" >&2; exit 1; }
gh api "repos/${REPO}/environments/${ENVIRONMENT}" --silent 2>/dev/null || { echo "L'ambiente ${ENVIRONMENT} non esiste in ${REPO}: crealo prima (docs/releases/firma.md)" >&2; exit 1; }

set_secret() { # name, value
  printf %s "$2" | gh secret set "$1" --repo "$REPO" --env "$ENVIRONMENT" --body - >/dev/null
  echo "  impostato: $1"
}
ask() { # prompt -> value (visible)
  local value; read -r -p "$1" value; printf %s "$value"
}
ask_secret() { # prompt -> value (hidden)
  local value; read -r -s -p "$1" value; echo >&2; printf %s "$value"
}
file_base64() { # path -> base64 on one line
  base64 -i "$1" | tr -d '\n'
}

echo "Ambiente: ${ENVIRONMENT} in ${REPO}"
echo "Identità Developer ID presenti nel Portachiavi (solo i nomi):"
security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/  \1/p' | sort -u

identity="$(ask 'MACOS_DEVELOPER_ID (nome completo, come sopra): ')"
[ -n "$identity" ] && set_secret MACOS_DEVELOPER_ID "$identity"

p12="$(ask 'Percorso del file .p12 del certificato: ')"
if [ -n "$p12" ]; then
  [ -f "$p12" ] || { echo "File non trovato: $p12" >&2; exit 1; }
  set_secret MACOS_CERT_P12_BASE64 "$(file_base64 "$p12")"
  password="$(ask_secret 'Password di esportazione del .p12: ')"
  [ -n "$password" ] && set_secret MACOS_CERT_P12_PASSWORD "$password"
fi

p8="$(ask 'Percorso della chiave API AuthKey_<ID>.p8: ')"
if [ -n "$p8" ]; then
  [ -f "$p8" ] || { echo "File non trovato: $p8" >&2; exit 1; }
  set_secret MACOS_NOTARY_KEY_BASE64 "$(file_base64 "$p8")"
fi
key_id="$(ask 'MACOS_NOTARY_KEY_ID: ')"
[ -n "$key_id" ] && set_secret MACOS_NOTARY_KEY_ID "$key_id"
issuer="$(ask 'MACOS_NOTARY_ISSUER_ID: ')"
[ -n "$issuer" ] && set_secret MACOS_NOTARY_ISSUER_ID "$issuer"

apple_id="$(ask 'MACOS_APPLE_ID (Apple ID dell'"'"'account sviluppatore): ')"
[ -n "$apple_id" ] && set_secret MACOS_APPLE_ID "$apple_id"
team_id="$(ask 'MACOS_APPLE_TEAM_ID: ')"
[ -n "$team_id" ] && set_secret MACOS_APPLE_TEAM_ID "$team_id"

echo
echo "Secret dell'ambiente ${ENVIRONMENT}:"
gh secret list --repo "$REPO" --env "$ENVIRONMENT" | awk '{print "  " $1}'
