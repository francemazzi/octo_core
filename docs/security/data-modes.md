# Modalità dati

`local_only` è il default: nessuna evidenza va a un modello remoto. Se Ollama risponde su localhost, l'analisi usa quel modello. Se è spento, non parte nessuna chiamata. `OCTO_OLLAMA_URL` deve puntare a questo computer (`127.0.0.1`, `localhost`, `::1`): con un altro host `local_only` resta senza modello e nessuna evidenza parte. L'audit `network` registra solo gli invii a un modello `remote`, con il perimetro di evidenze inviato.

| Modalità | Cosa può lasciare il PC | Cosa resta locale |
| --- | --- | --- |
| `local_only` | Niente verso modelli remoti. Ollama, se acceso, resta su localhost. | Acquisizione, cifratura, revisione, export. |
| `cloud_after_review` | Solo evidenze con revisione `approved`, nel perimetro della sessione. | Bozze, tratti `unknown`, evidenze revocate. |
| `cloud_live_authorized` | Evidenze della sessione autorizzata, durante la registrazione. | Sorgenti non selezionate, altre sessioni, tool di sistema. |

Il modello non riceve shell, filesystem né rete propri. Un testo catturato che chiede di cambiare policy non cambia modalità né scope. Senza rete, i job remoti restano in coda.

## Modello remoto (OpenRouter)

Le modalità `cloud_after_review` e `cloud_live_authorized` usano OpenRouter solo se `OPENROUTER_API_KEY` è impostata; senza chiave l'analisi resta `pending` con motivo `remote_unavailable` e nulla parte. Il modello si sceglie con `OPENROUTER_MODEL` (default `mistralai/mistral-small-3.2-24b-instruct`), la risposta è limitata da `OPENROUTER_MAX_TOKENS` (default 1500).

- Parte solo il perimetro della modalità: in `cloud_after_review` le evidenze `approved` della sessione, come testo minimizzato e mascherato (massimo 200 evidenze da 500 caratteri).
- La richiesta chiede a OpenRouter solo provider che non conservano né usano i dati (`provider.data_collection = "deny"`, `provider.zdr = true`).
- Ogni invio scrive l'audit `network` con gli id inviati e il provider; `analysis_runs` registra modello, versione del prompt, esito e uso (token e costo).
- La chiave in sviluppo sta in `.env` nella radice del repository (ignorato da git e da `scan:secrets`); il desktop in sviluppo la passa all'engine. La build pacchettizzata non legge `.env`: la chiave in produzione va in `safeStorage` (binario B).

## Cattura dello schermo e OCR

Con `OCTO_CAPTURE=screen` (default del desktop) Octo fa uno screenshot degli schermi scelti ogni `OCTO_CAPTURE_INTERVAL_MS` (default 30 000 ms). Le finestre di Octo sono escluse dagli screenshot (`setContentProtection`).

- L'immagine va solo all'engine sullo stesso computer. Il testo lo legge un modello di visione su Ollama in loopback (`glm-ocr`, `OCTO_OCR_MODEL`; `OCTO_OCR=off` lo spegne). L'immagine non viene salvata: resta solo il testo, mascherato, minimizzato e cifrato come evidenza.
- Uno screenshot uguale al precedente non crea un'evidenza nuova ma un `frame_repeat`, così il tempo resta contato.
- Una lettura fallita scrive l'audit `ocr_failed` (id del frame ed errore, mai il testo).
- Su macOS serve il permesso "Registrazione schermo"; senza, la dashboard lo dice e non registra contenuti.

