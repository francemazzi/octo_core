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
- Una lettura fallita scrive l'audit `ocr_failed` (id del frame ed errore, mai il testo). I codici `ollama_unreachable` (Ollama non risponde), `ollama_timeout` (troppo lento), `ocr_model_missing` (modello non installato) e `remote_model` (modello cloud) indicano un computer non pronto: sono contati di fila e ogni risposta a `capture.image` porta il conteggio. Il desktop mette in pausa la registrazione dopo 2 di questi errori di fila, o dopo 3 timeout, e spiega il motivo; una lettura riuscita azzera il conteggio. Un testo illeggibile (`ocr_failed`) non conta. Al massimo tre schermate aspettano dietro a quella in lettura: oltre, la nuova schermata è saltata (`ocr_busy`, audit `ocr_skipped` con l'id del frame), così un computer lento riduce la copertura invece di accumulare immagini in memoria e di trattenere l'analisi dopo Stop.
- Su macOS serve il permesso "Registrazione schermo"; senza, la dashboard lo dice e non registra contenuti.

## Prima di registrare

Il desktop non avvia né riprende una registrazione finché la lista «Prima di registrare» non è completa. Il motore la calcola (`readiness.status`, con la modalità di cattura), il desktop la fa rispettare:

- **Archivio sicuro** per la chiave dei media (vedi sotto).
- **Ollama** raggiungibile su loopback e **modello OCR** installato su questo computer: richiesti solo con la cattura `screen`. Un modello OCR cloud non conta. Con `OCTO_OCR=off` la cattura `screen` non parte.
- **Un modello di analisi**: un modello di chat di Ollama in loopback oppure un provider remoto configurato (chiave nelle Impostazioni o nell'ambiente). La prima chiave salvata quando nessun provider è attivo diventa quello predefinito; non esiste fallback da un provider all'altro.

**Download dei modelli.** Dalla lista l'operatore può far scaricare a Ollama il modello OCR (`glm-ocr`, o `OCTO_OCR_MODEL`) e un modello di chat leggero (`qwen3.5:4b`, o `OCTO_OLLAMA_MODEL`). Il renderer invia solo il ruolo (`ocr` o `chat`): il nome lo decide il motore, che parla solo con Ollama su loopback (`POST /api/pull`). È Ollama a scaricare i pesi dal proprio registry: nessuna evidenza, chiave o dato di sessione lascia il computer. Un download alla volta; senza avanzamento per 120 s si interrompe. Ogni download scrive l'audit `model_pull` (ruolo, modello, esito: `started`, `completed`, `failed` con il codice). "Installa Ollama" apre soltanto `https://ollama.com/download` nel browser.

**Dopo Stop.** Se c'è un modello locale, l'analisi `local_only` parte da sola. Se c'è solo il provider remoto, la conferma (destinatario, modello, numero di schermate, nessuna immagine) si apre da sola; niente parte senza "Invia", e la conferma vale per quella sessione.

## Chiave dei media

Il testo delle schermate è cifrato con una chiave di 32 byte. Il desktop la crea al primo avvio e la conserva in `media-key.bin` nella cartella dati, cifrata con `safeStorage` (Keychain, DPAPI, libsecret); al motore la consegna con `keys.unlock` (`OCTO_KEY_SOURCE=host`), mai nei log, nelle risposte o negli audit. Così una sessione resta leggibile dopo aver chiuso Octo o riavviato il computer.

- Senza un archivio sicuro (Linux con backend `basic_text`) la chiave non si crea e la registrazione non parte.
- Se `media-key.bin` non si apre più (profilo utente ricreato, cartella copiata su un altro computer), il file viene rinominato `media-key.bin.unreadable-<ms>` e non cancellato, Octo crea una chiave nuova e la dashboard lo dice: le sessioni registrate prima non sono più leggibili.
- Ogni envelope porta `kid`, un'impronta pubblica della chiave: una schermata cifrata con un'altra chiave dà `media_key_mismatch`, distinto da `tampered_ciphertext`. L'analisi salta le schermate illeggibili; se nessuna è leggibile registra un run `unavailable` con `unreadable_evidence` senza chiamare il modello.
- `OCTO_MEDIA_KEY=memory` (solo sviluppo e test, ignorato dall'app installata) tiene la chiave in memoria come prima della 1.3.


## Assistente della sessione

Nel dettaglio di una sessione **ferma** l'operatore può fare domande all'assistente (`chat.send`, `chat.history`). Vale lo stesso perimetro dell'analisi:

- In `local_only` risponde solo Ollama in loopback; senza modello la domanda fallisce con `model_unavailable` e nulla parte.
- In `cloud_after_review` risponde il provider remoto configurato, dopo la stessa conferma di "Analizza con …" (provider, modello, workspace, numero di schermate), che resta registrata con `review.approve` una volta per sessione. Partono solo le evidenze `approved`, come testo minimizzato e mascherato, in **un solo blocco** da 200 schermate al massimo: oltre, la risposta è marcata `partial`.
- Ogni domanda manda al modello anche i dati già derivati: titolo e durata della sessione, attività con etichetta, riassunto, durate e intervalli, domande aperte e risposte dell'operatore, esito dell'ultima analisi, più gli ultimi 10 turni della conversazione. Non manda immagini, chiavi o altre sessioni.
- Prima di ogni chiamata remota viene scritto l'audit `network` con gli id inviati e il provider. Ogni chiamata è registrata in `analysis_runs` con `prompt_schema = chat@1`, modalità, modello, copertura, esito e uso; non conta mai come ultima analisi della sessione.
- La risposta è accettata solo come JSON con `answer` e `citations`. Le citazioni vengono verificate contro le evidenze inviate e le attività della sessione: quelle inesistenti sono scartate e annotate nel run (`issues.unknownCitations`); senza citazioni valide la risposta è mostrata come "non verificata". Una risposta vuota è `invalid_model_output` e la domanda non viene salvata.
- Il testo delle schermate e ogni etichetta, riassunto, nota o risposta sono dati non fidati nel prompt: un'istruzione scritta in una schermata non cambia modalità, perimetro né attività. L'assistente non modifica mai le attività: le correzioni restano un'azione esplicita della persona.
- Le schermate registrate con Octo 1.2 o precedenti, o cifrate con una chiave messa da parte, non sono leggibili: l'assistente risponde dalle attività e dalle risposte già date, e la risposta è `partial` (`unreadable` nel run).
- La risposta accettata a una domanda del modello resta sull'attività come **dichiarazione dell'operatore** (`operator_note`): appare nel dettaglio, nel DOCX e in `activity.json` etichettata come tale, mai come evidenza.
