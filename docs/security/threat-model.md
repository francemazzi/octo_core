# Threat model MVP

Superfici e trattamento. Il residuo non è «zero rischio».

| Superficie | Rischio | Mitigazione | Residuo |
| --- | --- | --- | --- |
| Screenshot | Contenuti sensibili sul monitor | Solo sorgenti scelte; maschera prima del disco; cifratura AES-GCM | Metadati in chiaro (vedi plaintext-metadata) |
| Notifiche e titoli | Testo di altre app nel frame | Minimizzazione e maschere; niente OCR verso rete in `local_only` | Un titolo può restare nel payload mascherato |
| Video | Stesse informazioni degli screenshot, più persistenti | Segmenti non finalizzati non sono `valid`; niente audio | Codec reale solo sul binario B |
| Chiavi | Lettura della data-key | Test: chiave in memoria o file nel data dir temporaneo. Produzione: `safeStorage`. Keystore assente → la registrazione non parte | Dev key sul disco di test |
| Log | Pixel o segreti nei log | Il log diagnostico scarta marker e payload; stdout è solo protocollo | Timestamp e id restano |
| Checkpoint | Stato del grafo con id evidenze | SQLite locale, stesso data dir della sessione | Un backup del data dir copia anche i checkpoint |
| Export | Path traversal, HTML | Id sanitizzati; destinazione esplicita; escape in `indice.html` | Il DOCX è in chiaro per essere letto |
| Cancellazione | Derivati che risorgono | Tombstone; i job non riscrivono righe eliminate; scan del marker vuoto | Copie già esportate fuori dal data dir restano all'utente |
| Chiavi di firma | Furto o uso improprio del certificato Developer ID, della password per app o del service principal Azure | Solo secret GitHub (environment `windows-release` per Azure, OIDC senza segreti statici) o keychain locale; gli script leggono nomi di variabili; token Azure richiesto subito prima della firma e passato per ambiente; nessun self-signed | Un secret di repository è leggibile da chi ha accesso in scrittura; la revoca del certificato è manuale |

Binario B e C (cattura Windows, legale, pilot) sono `pending` e non sono coperti da questo modello operativo.

## Chiavi di firma

Le credenziali di firma sono dati sensibili al pari delle chiavi API: certificato Developer ID (`.p12`), password per app Apple, service principal Azure. Vivono soltanto nei secret di GitHub o nel keychain della macchina che firma; non entrano in file del repository, nei log di CI, in `UNSIGNED.txt` o nei report JSON (che contengono hash, soggetti dei certificati e verdetti, mai segreti). `pnpm scan:secrets` resta il controllo di ultima istanza. Una firma attesta l'origine del binario: non sostituisce il modello operativo sopra e non cambia la licenza. Processo e nomi dei secret in `docs/releases/firma.md`.
