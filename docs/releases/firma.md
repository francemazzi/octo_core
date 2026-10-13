# Firma, notarizzazione e release

Processo end-to-end per pubblicare Octo Core. Decisione di riferimento: [ADR 0002](../adr/0002-firma-e-licenza.md).

## Principi

- **Licenza e firma sono cose diverse.** Il codice è GPL-3.0-or-later (`LICENSE`); la firma dice soltanto chi ha prodotto il binario. Firmare non cambia la licenza, non firmare non la toglie.
- **Prima il percorso a costo zero.** Checksum, note per versione e dipendenze verificate escono sempre. La firma si aggiunge solo dove è disponibile: Developer ID su macOS, Azure Artifact Signing su Windows solo se configurato.
- **Chiavi soltanto nei secret di CI o nel keychain locale.** Nessun certificato, token o password nel repository, nei log o nei file generati.
- **Si firma il file finale, dopo la build.** Il package viene costruito, poi firmato, poi notarizzato, poi impacchettato; l'hash in `SHA256SUMS.txt` è quello del file distribuito.
- **Mai certificati self-signed.** Un pacchetto non firmato con hash pubblicato vale più di una firma che Windows non riconosce.

## Cosa produce `pnpm package:release`

In `release/<versione>/`:

| File | Contenuto |
| --- | --- |
| `OctoCore-<v>-<target>.zip` / `.dmg` | I pacchetti per mac-arm64, mac-x64, win-x64, win-arm64, linux-x64, linux-arm64 |
| `SHA256SUMS.txt` | Una riga per artefatto, formato `sha256sum -c` |
| `LICENSE`, `THIRD-PARTY-NOTICES.txt` | Licenza e avvisi delle dipendenze; le stesse copie finiscono dentro ogni pacchetto (`Resources/`) |
| `UNSIGNED.txt` | Solo se almeno un target non è firmato o notarizzato: elenco dei target e spiegazione per SmartScreen e Gatekeeper |
| `notary-result-<target>-app.json`, `notary-result-<target>-dmg.json` | Esito di ogni invio a Apple; `notary-log-*.json` solo in caso di rifiuto |
| `windows-signing-report-<target>.json` | File firmati, hash e verifica, solo se la firma Windows è attiva |

Prima di impacchettare, `pnpm check:licenses` deve passare: ogni dipendenza di produzione deve avere una licenza compatibile con GPL-3.0-or-later (allowlist in `scripts/gates/licenses.ts`). Una licenza fuori lista blocca la release e va discussa, non aggiunta in silenzio.

Opzioni: `pnpm package:release <target...>` seleziona i target; `--no-build` riusa `apps/desktop/dist` già costruito (usato in CI per firmare subito dopo il login Azure).

## macOS

Script: `scripts/release/sign-mac.ts`, `scripts/release/notarize-mac.ts`, `scripts/release/entitlements.plist`.

1. Identità da `MACOS_DEVELOPER_ID` (nome completo «Developer ID Application: …»), in alternativa `OCTO_MAC_SIGN_IDENTITY`, altrimenti la prima «Developer ID Application» nel keychain. Un'identità indicata ma assente dal keychain è un errore, non una build non firmata.
2. Firma inside-out: ogni binario Mach-O, poi framework e helper, infine l'app, sempre con `--force --options runtime --timestamp` e gli entitlements di Electron (JIT, memoria eseguibile non firmata, nessuna library validation). Mai `--deep` per firmare. Verifica con `codesign --verify --deep --strict --verbose=2`.
3. Notarizzazione dell'app: zip con `ditto`, `notarytool submit --wait --output-format json`, esito salvato, stato diverso da `Accepted` → scarica il log e interrompe. `stapler staple` con cinque tentativi a 30 s, poi `stapler validate`.
4. DMG dall'app già stapled, firmato con `--timestamp` (senza hardened runtime, non è codice), notarizzato e stapled a sua volta.
5. Valutazione Gatekeeper: `spctl -a -vvv -t exec <app>` e `spctl -a -t open --context context:primary-signature -v <dmg>`. Con notarizzazione un rifiuto blocca la release; senza notarizzazione il verdetto è solo riportato nel riepilogo.

Credenziali di notarizzazione, in ordine: profilo keychain `OCTO_NOTARY_PROFILE`; oppure una **chiave API di App Store Connect** (`MACOS_NOTARY_KEY_PATH` al file `.p8`, `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER_ID`), che non richiede password per app; oppure `MACOS_APPLE_ID` + `MACOS_APPLE_TEAM_ID` + `MACOS_APPLE_APP_PASSWORD` (accettati anche i vecchi `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`). Prima dell'invio lo script esegue `notarytool history` come preflight. Gli esiti (`notary-result-<target>-app.json` e `-dmg.json`) sono nell'artefatto `notarization-diagnostics` del run e il job `publish` li allega alla release.

La chiave API si genera su App Store Connect → Utenti e accesso → Integrazioni → App Store Connect API → Chiavi del team (ruolo Developer o superiore): il file `AuthKey_<ID>.p8` si scarica una sola volta; Key ID e Issuer ID sono mostrati nella pagina. In locale: `xcrun notarytool store-credentials octo-release-local --key AuthKey_<ID>.p8 --key-id <ID> --issuer <ISSUER>`. In CI: secret `MACOS_NOTARY_KEY_BASE64` (base64 del `.p8`), `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER_ID`; il workflow scrive la chiave in `$RUNNER_TEMP` solo per la durata del job.

### Secret GitHub (ambiente `macos-release`)

I secret Apple vivono nell'**ambiente `macos-release`**, non nel repository: il job `macos` dichiara `environment: macos-release`, che accetta solo il ramo `main` e i tag `v*` (come `windows-release`). Un ramo qualunque lanciato a mano non può quindi firmare con il Developer ID. GitHub non mostra più un secret dopo il salvataggio: per inserirli o ruotarli si usa `scripts/release/set-macos-secrets.sh`, che non contiene valori, chiede i file locali (`.p12`, `.p8`) e le password con `read -s` e invia tutto a `gh secret set --env macos-release` via stdin.

| Secret | Contenuto |
| --- | --- |
| `MACOS_CERT_P12_BASE64` | Esportazione `.p12` del certificato Developer ID Application, codificata base64 |
| `MACOS_CERT_P12_PASSWORD` | Password dell'esportazione |
| `MACOS_DEVELOPER_ID` | Nome completo dell'identità, come stampato da `security find-identity -v -p codesigning` |
| `MACOS_APPLE_ID` | Apple ID dell'account sviluppatore |
| `MACOS_APPLE_TEAM_ID` | Team ID |
| `MACOS_APPLE_APP_PASSWORD` | Password per app generata su appleid.apple.com |
| `MACOS_NOTARY_KEY_BASE64`, `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER_ID` | Alternativa senza password: chiave API di App Store Connect (`.p8` in base64, Key ID, Issuer ID) |

Senza `MACOS_CERT_P12_BASE64` il job macOS produce pacchetti non firmati e `UNSIGNED.txt` lo dichiara.

**Dry run.** `gh workflow run release.yml --ref main` costruisce, firma e notarizza senza pubblicare (il job `publish` parte solo su un tag). Da un altro ramo l'ambiente rifiuta il job: per collaudare una modifica al workflow si aggiunge temporaneamente il ramo alle policy dell'ambiente e lo si toglie dopo l'unione.

**Rotazione.** Si genera un nuovo certificato o una nuova chiave API, si rilancia lo script (Invio salta i valori già corretti) e si verifica con un dry run da `main`. Il vecchio certificato o la vecchia chiave si revoca su Apple solo dopo il dry run verde.

**Protezioni del repository.** Un ruleset impedisce di creare, spostare o cancellare i tag `v*` a chi non è admin e vieta force push e cancellazione su `main`; non richiede pull request, perché il repository ha un solo collaboratore.

### Esecuzione locale

```bash
xcrun notarytool store-credentials octo-release-local   # una volta: chiede Apple ID, Team ID e password per app
OCTO_NOTARY_PROFILE=octo-release-local pnpm package:release mac-arm64 mac-x64
```

L'identità viene letta dal keychain di login. Il profilo resta nel keychain, mai in file.

## Landing page

Dopo il job `publish`, `release.yml` chiama `pages.yml`, che scrive `site/releases.json` dal tag appena pubblicato (`pnpm site:releases --tag vX.Y.Z`), esegue `pnpm site:check` e pubblica `site/` su GitHub Pages (`https://francemazzi.github.io/octo_core/`). Una release creata con `GITHUB_TOKEN` non attiva i workflow `on: release`, perciò il deploy è incatenato. Lo stesso workflow parte anche a ogni push su `site/` e a mano (`gh workflow run pages.yml`).

## Windows

Script: `scripts/release/sign-win.ts` (Jsign da macOS/Linux) e `scripts/ci/*.ps1` (signtool su host Windows).

Azure Artifact Signing è un servizio a pagamento con validazione dell'identità. **Si firma solo se configurato**; altrimenti i pacchetti escono non firmati con `SHA256SUMS.txt` e la spiegazione in `UNSIGNED.txt`. SmartScreen mostra «PC protetto da Windows» per i binari senza firma Authenticode e, per un certo periodo, anche per quelli firmati ma senza reputazione.

Configurazione: variabili `AZURE_ARTIFACT_SIGNING_ENDPOINT` (deve corrispondere a `^https://[a-z0-9]+\.codesigning\.azure\.net/?$`, per West Europe `https://weu.codesigning.azure.net`), `AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME`, `AZURE_ARTIFACT_SIGNING_CERT_PROFILE_NAME`. Accettati come fallback i vecchi `OCTO_AZURE_SIGNING_ENDPOINT`, `OCTO_AZURE_SIGNING_ACCOUNT`, `OCTO_AZURE_SIGNING_PROFILE`. Una configurazione parziale blocca la release.

Da macOS o Linux: Jsign (`--storetype TRUSTEDSIGNING`, `--alg SHA-256`, timestamp RFC3161 da `http://timestamp.acs.microsoft.com`, `--replace`) firma ogni `.exe`, `.dll` e `.node` del pacchetto. Il token viene chiesto ad `az account get-access-token` subito prima della firma e passato a Jsign tramite variabile d'ambiente, non sulla riga di comando. La verifica usa `osslsigncode verify` se presente; altrimenti il report riporta «verifica non disponibile su questo sistema».

Su host Windows (`process.platform === "win32"`) lo script delega a `scripts/ci/windows-signing-files.ps1`: `signtool sign /fd SHA256 /tr … /td SHA256 /dlib … /dmdf …` con i percorsi esportati da `prepare-windows-signing.ps1`, metadata JSON scritto UTF-8 senza BOM (un BOM ha già rotto una release altrove), `signtool verify /pa /all` dopo ogni firma. Firme esistenti valide sono conservate; una firma esistente non valida o un PE con estensione inattesa interrompono la release. I test di policy girano con `pwsh scripts/ci/test-windows-signing-files.ps1` su qualsiasi sistema.

### GitHub environment `windows-release` (passi manuali)

1. Creare l'environment `windows-release` nel repository, limitato ai tag `v*`.
2. Secret dell'environment: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (service principal dedicato, nessun client secret: si usa OIDC).
3. Variabili dell'environment: `AZURE_ARTIFACT_SIGNING_ENDPOINT`, `AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME`, `AZURE_ARTIFACT_SIGNING_CERT_PROFILE_NAME`.
4. In Entra ID, sull'applicazione del service principal, aggiungere la federated credential con issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange` e subject `repo:francemazzi/octo_core:environment:windows-release`.
5. Assegnare al service principal il ruolo `Artifact Signing Certificate Profile Signer` soltanto sul certificate profile scelto (profilo Public Trust, non PublicTrustTest).

Finché la variabile `AZURE_ARTIFACT_SIGNING_ENDPOINT` è vuota il job Windows salta login e firma e pubblica pacchetti non firmati.

**Costo.** Azure Artifact Signing è a pagamento. L'account usato oggi (`strata-signing-fm`, profilo `strata-public`, endpoint nord Europa) è lo stesso già pagato e usato per Strata: Octo Core non aggiunge un abbonamento. Se quell'account venisse chiuso basta svuotare la variabile dell'endpoint e i pacchetti Windows escono non firmati, con `SHA256SUMS.txt` e `UNSIGNED.txt`. In alternativa gratuita il progetto, pubblico e GPL, può chiedere l'ammissione a SignPath Foundation.

### Esecuzione locale da macOS

```bash
brew install jsign osslsigncode
az login
AZURE_ARTIFACT_SIGNING_ENDPOINT=https://weu.codesigning.azure.net \
AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME=<account> \
AZURE_ARTIFACT_SIGNING_CERT_PROFILE_NAME=<profilo> \
pnpm package:release win-x64 win-arm64
```

## Linux

Nessuna firma dei pacchetti: la verifica è l'hash in `SHA256SUMS.txt`. Le build Linux non sono ancora provate su macchine reali (binario B).

## Workflow `release.yml`

Si attiva con `git push` di un tag `v*`. Il tag deve coincidere con la versione di `apps/desktop/package.json`, altrimenti il job `publish` fallisce.

| Job | Runner | Cosa fa |
| --- | --- | --- |
| `macos` | macos-latest | Importa il certificato dai secret (se presente), `pnpm package:release mac-arm64 mac-x64`, carica pacchetti e `notary-*.json` |
| `windows` | macos-latest, environment `windows-release` | Build, poi (solo se configurato) `assert-windows-signing.ps1`, `brew install jsign osslsigncode`, `azure/login` OIDC, `pnpm package:release --no-build win-x64 win-arm64` |
| `linux` | ubuntu-latest | `pnpm package:release linux-x64 linux-arm64` |
| `publish` | ubuntu-latest | Scarica tutto, unisce gli `SHA256SUMS.txt` e li verifica con `sha256sum -c`, allega LICENSE, THIRD-PARTY-NOTICES.txt, eventuale UNSIGNED.txt e i report, poi `gh release create` con note da `docs/releases/<versione>.md` se esiste |

**Perché il job Windows gira su macOS.** La pipeline di packaging (`sips`/`iconutil` per le icone, `ditto` per gli zip, `hdiutil`) è quella già usata in locale dalla 1.0.0; `@electron/packager` 18 scrive le risorse Windows con `resedit` in puro JS, quindi non serve Wine né un host Windows; Jsign firma tramite Azure da qualsiasi sistema e `azure/login` OIDC funziona su ogni runner. Un runner `windows-2022` avrebbe richiesto una seconda catena per icone e zip (senza `sips` l'icona resterebbe quella di Electron) e l'installazione di NuGet/.NET per signtool: più codice per lo stesso risultato. Gli script PowerShell in `scripts/ci/` restano pronti se in futuro si preferisse un runner Windows nativo (`prepare-windows-signing.ps1` → `azure/login` → `pnpm package:release --no-build win-x64 win-arm64`).

Il build dell'app avviene **prima** del login Azure perché l'assertion OIDC di GitHub scade in pochi minuti; lo script chiede il token di firma subito prima di usarlo.

Le azioni sono pinate per SHA dove il valore è noto da un workflow già in uso (checkout, upload/download-artifact, azure/login, import-codesign-certs); `pnpm/action-setup` e `setup-node` seguono `ci.yml`.

## Verifica da parte di chi scarica

```bash
shasum -a 256 -c SHA256SUMS.txt            # macOS/Linux, nella cartella dei download
certutil -hashfile OctoCore-<v>-win-x64.zip SHA256   # Windows, confrontare con SHA256SUMS.txt
spctl -a -vvv -t exec "Octo Core.app"      # macOS: accepted + source=Notarized Developer ID
Get-AuthenticodeSignature .\OctoCore.exe   # Windows: Status Valid se firmato
```

Se un pacchetto compare in `UNSIGNED.txt`, l'hash è l'unica garanzia di integrità: confrontarlo prima di aggirare SmartScreen («Ulteriori informazioni» → «Esegui comunque») o Gatekeeper (clic destro → Apri).

## Licenza

Octo Core è distribuito sotto GPL-3.0-or-later. La firma Developer ID o Authenticode attesta l'origine del binario e non aggiunge condizioni alla licenza: chi riceve un pacchetto firmato ha gli stessi diritti di chi compila dai sorgenti. `THIRD-PARTY-NOTICES.txt` elenca le dipendenze di produzione con le rispettive licenze.
