# Modalità dati

`local_only` è il default: nessuna evidenza va a un modello remoto. Se Ollama risponde su localhost, l'analisi usa quel modello. Se è spento, non parte nessuna chiamata. `OCTO_OLLAMA_URL` deve puntare a questo computer (`127.0.0.1`, `localhost`, `::1`): con un altro host `local_only` resta senza modello e nessuna evidenza parte. Ollama inoltra a ollama.com i suoi modelli "cloud" (`nome:cloud`, `nome:<taglia>-cloud`, campo `remote_host` in `/api/tags`): Octo non li usa mai, né per l'analisi né per l'OCR, anche se richiesti con `OCTO_OLLAMA_MODEL` o `OCTO_OCR_MODEL`. Con soli modelli cloud installati l'analisi resta `model_unavailable` e lo screenshot non parte (audit `ocr_failed`, codice `remote_model`). L'audit `network` registra solo gli invii a un modello `remote`, con il perimetro di evidenze inviato.

| Modalità | Cosa può lasciare il PC | Cosa resta locale |
| --- | --- | --- |
| `local_only` | Niente verso modelli remoti. Ollama, se acceso, resta su localhost. | Acquisizione, cifratura, revisione, export. |
| `cloud_after_review` | Solo evidenze con revisione `approved`, nel perimetro della sessione. | Bozze, tratti `unknown`, evidenze revocate. |
| `cloud_live_authorized` | Evidenze della sessione autorizzata, durante la registrazione. | Sorgenti non selezionate, altre sessioni, tool di sistema. |

Il modello non riceve shell, filesystem né rete propri. Un testo catturato che chiede di cambiare policy non cambia modalità né scope. Senza rete, i job remoti restano in coda.

## Modello remoto (OpenRouter)

Le modalità `cloud_after_review` e `cloud_live_authorized` usano OpenRouter solo se l'engine ha una chiave: quella salvata nell'app (Impostazioni) oppure, in sviluppo, `OPENROUTER_API_KEY`. Senza chiave l'analisi resta con motivo `remote_unavailable` e nulla parte. Il modello è quello scelto nelle Impostazioni o `OPENROUTER_MODEL` (default `mistralai/mistral-small-3.2-24b-instruct`: 0,094 USD per milione di token in ingresso, 0,25 in uscita); la risposta è limitata da `OPENROUTER_MAX_TOKENS` (default 4000, perché un blocco da 200 evidenze chiede già circa 1400 token).

- **Chiave dall'app.** L'operatore la scrive in Impostazioni. Il main la passa all'engine con `model.configure`; l'engine la verifica con `GET /key` (nessuna evidenza inviata) e solo dopo il main la salva cifrata con `safeStorage` (Keychain, DPAPI, libsecret) in `settings.json` accanto ai dati. Sul file restano il ciphertext e le ultime 4 cifre, mostrate nella dashboard. Senza un archivio sicuro (Linux con backend `basic_text`) la chiave non si salva. A ogni avvio il main la ripassa all'engine senza chiamare OpenRouter. La chiave non torna mai al renderer, non finisce in log, risposte o audit (`model_configured` registra provider, modello, origine e verifica).
- **Invio su richiesta, per sessione.** Nel dettaglio di una sessione ferma, "Analizza con OpenRouter" mostra cosa parte (testo di N schermate, nessuna immagine, solo provider senza conservazione dei dati, numero massimo di richieste). Confermando, l'engine approva tutte le evidenze valide della sessione (`approved_at`, `approved_by = operator:<pseudonimo>`, audit `evidence_approved`) e analizza in `cloud_after_review`. L'approvazione resta registrata.
- Parte solo il perimetro della modalità: in `cloud_after_review` le evidenze `approved` della sessione, come testo minimizzato e mascherato.
- **Sessioni lunghe.** L'analisi va a blocchi di 200 evidenze in ordine di tempo, al massimo 10 blocchi; ogni blocco vede le attività già trovate e può continuarle. Oltre i 10 blocchi le evidenze non partono e il run è marcato parziale, anche nella dashboard.
- La richiesta chiede a OpenRouter solo provider che non conservano né usano i dati (`provider.data_collection = "deny"`, `provider.zdr = true`).
- Ogni chiamata remota scrive prima l'audit `network` con gli id inviati e il provider; `analysis_runs` registra modello, provider, versione del prompt, blocco, copertura, esito, uso (token e costo) e, se la risposta cita evidenze inesistenti o doppie, l'elenco (`issues`): quella risposta è rifiutata e riprovata una volta. Anche una connessione chiusa a metà, un 429 o un 5xx di OpenRouter danno un solo nuovo tentativo; una chiave rifiutata o il credito esaurito no.
- Una nuova analisi sostituisce le attività proposte e chiude le domande aperte su di esse (`superseded`); non tocca mai una sessione con attività confermate o modificate da una persona (`reviewed_session`). Se fallisce, restano le attività di prima.
- In sviluppo la chiave può stare in `.env` nella radice del repository (ignorato da git e da `scan:secrets`); il desktop in sviluppo la passa all'engine. La build pacchettizzata non legge `.env`. `OCTO_OPENROUTER_URL` sostituisce OpenRouter con un server finto solo se punta a questo computer (test).

## Cattura dello schermo e OCR

Con `OCTO_CAPTURE=screen` (default del desktop) Octo fa uno screenshot degli schermi scelti ogni `OCTO_CAPTURE_INTERVAL_MS` (default 30 000 ms). Le finestre di Octo sono escluse dagli screenshot (`setContentProtection`).

- L'immagine va solo all'engine sullo stesso computer. Il testo lo legge un modello di visione su Ollama in loopback (`glm-ocr`, `OCTO_OCR_MODEL`; `OCTO_OCR=off` lo spegne). L'immagine non viene salvata: resta solo il testo, mascherato, minimizzato e cifrato come evidenza.
- Uno screenshot uguale al precedente non crea un'evidenza nuova ma un `frame_repeat`, così il tempo resta contato.
- Una lettura fallita scrive l'audit `ocr_failed` (id del frame ed errore, mai il testo).
- Su macOS serve il permesso "Registrazione schermo"; senza, la dashboard lo dice e non registra contenuti.

