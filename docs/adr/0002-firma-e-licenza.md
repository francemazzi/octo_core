# ADR 0002 — Licenza GPL-3.0-or-later, firma e release

## Stato

Accettato. Processo operativo in [docs/releases/firma.md](../releases/firma.md).

## Decisione

Il repository è pubblico e il codice è rilasciato sotto **GPL-3.0-or-later**: `LICENSE` in radice, campo `license` in ogni `package.json` (che restano `private`, non si pubblicano su npm). Le dipendenze di produzione devono avere una licenza compatibile: `pnpm check:licenses` è un gate di CI e genera `THIRD-PARTY-NOTICES.txt` in release. L'allowlist sta in `scripts/gates/licenses.ts`; una licenza fuori lista blocca e si discute, non si aggiunge in silenzio.

La firma è separata dalla licenza e segue il percorso a costo minimo:

- **macOS**: Developer ID Application già disponibile, hardened runtime con gli entitlements di Electron, notarizzazione di app e DMG, staple, `spctl` come verifica finale.
- **Windows**: Azure Artifact Signing **solo se configurato** (environment GitHub `windows-release`, OIDC, nessun segreto statico). Altrimenti pacchetti non firmati con `SHA256SUMS.txt` e spiegazione in `UNSIGNED.txt`. Nessun certificato self-signed: non riduce gli avvisi e abitua gli utenti a ignorarli.
- **Linux**: solo checksum.

Le chiavi vivono nei secret di GitHub o nel keychain locale; gli script leggono soltanto nomi di variabili. Si firma il file finale dopo la build; ogni versione pubblica checksum e note (`docs/releases/<versione>.md`).

## Conseguenze

- `pnpm package:release` fallisce se l'identità indicata manca, se la notarizzazione non è `Accepted`, se la configurazione Windows è parziale o se una dipendenza ha licenza incompatibile.
- `release.yml` pubblica su tag `v*`; i job Windows e macOS girano su macos-latest per riusare la stessa catena di packaging (motivazione in firma.md).
- I secret Apple stanno nell'ambiente GitHub `macos-release` (solo `main` e tag `v*`), come quelli Azure in `windows-release`; i tag `v*` sono protetti da un ruleset.
- Un contributo esterno al repository accetta la GPL; non esiste un CLA.
- Azure Artifact Signing usa l'account già pagato per Strata: nessun costo aggiuntivo; se venisse chiuso, i pacchetti Windows escono non firmati e le release non si bloccano.
