# Octo Core — Roadmap MVP

Repository: https://github.com/francemazzi/octo_core

**Obiettivo:** realizzare un'app desktop Windows-first che documenta sessioni di lavoro autorizzate, mostra una mascotte sempre visibile durante la registrazione, ricostruisce le attività con poche domande all'utente ed esporta screenshot, brevi video e un report DOCX verificabile.

**Stato iniziale:** roadmap di sviluppo; nessuna funzionalità, verifica o fase è dichiarata completata. I comandi e i percorsi descritti sotto sono contratti da implementare, non file già presenti nel repository.

## 1. Risultato atteso e confini del prototipo

Il primo flusso completo deve essere:

```text
Installazione Windows
  → configurazione locale e selezione degli schermi
  → avvio esplicito della sessione
  → mascotte e controlli sempre disponibili
  → acquisizione locale di evidenze minimizzate
  → analisi dei segmenti autorizzati
  → domande contestuali limitate
  → revisione delle attività ricostruite
  → cartelle per attività, screenshot e clip
  → report DOCX con tempi, evidenze e opportunità da verificare
```

Il test dimostrativo iniziale riguarda una sessione di 60–90 minuti, un operatore, uno o due monitor e un processo di ufficio manifatturiero, per esempio l'inserimento di ordini da documenti in un gestionale. Le prime prove utilizzano esclusivamente dati fittizi.

**Incluso nell'MVP:** Windows 11 x64, acquisizione del contenuto visibile dei monitor selezionati o di una finestra, archivio locale, funzionamento offline della registrazione, analisi opzionale via OpenRouter, validazione umana, esportazione e stime economiche esplicitamente condizionate alle informazioni disponibili.

**Escluso dall'MVP:** controllo autonomo del PC, scrittura nei gestionali, invio di email, registrazione nascosta, keylogging, lettura della clipboard, audio e webcam, classifiche dei dipendenti, riconoscimento delle emozioni, training sui dati dei clienti, cloud multi-tenant, login SaaS, orchestrazione tra più dipendenti e supporto garantito a macOS, Linux, Citrix o Remote Desktop.

Acquisire tutto un monitor non significa leggere finestre mai aperte, database o contenuti protetti dal sistema operativo. Non aggirare permessi, schermate di sicurezza o restrizioni aziendali.

## 2. Decisioni architetturali

| Livello | Scelta iniziale | Vincolo |
| --- | --- | --- |
| Desktop | Electron + React + TypeScript | Windows-first; mascotte e dashboard in finestre separate |
| Registratore | Adattatore Electron per le sorgenti desktop | Il main autorizza; un renderer dedicato gestisce le API media; nessuna dipendenza dalle risposte AI |
| Backend locale | Node.js/TypeScript in un processo separato | Comunicazione IPC tipizzata; niente server remoto obbligatorio |
| API HTTP | Fastify solo se richiesto da un client concreto | Non introdurre FastAPI/Python per duplicare il backend; eventuale API solo loopback e autenticata |
| Contratti | Zod e tipi condivisi | Validare IPC, input utente, modelli, export e configurazione |
| Persistenza | SQLite, migrazioni SQL e repository tipizzati | Verificare subito driver, ABI Electron e packaging; payload sensibili cifrati |
| Media | Archivio locale cifrato fuori dal repository | Screenshot, video, cache e temporanei sotto policy esplicita |
| Analisi | LangGraph.js e adapter OpenRouter | Checkpoint persistenti; modello e provider configurabili; niente azioni sul computer |
| Documenti | Libreria TypeScript `docx` | DOCX generato da un report strutturato e validato |
| Test | Vitest, integrazione, replay e test Electron | La cattura reale richiede anche un desktop Windows interattivo |
| Distribuzione | Electron Forge e installer Windows firmato per il pilot | La firma non garantisce l'accettazione da parte di tutte le policy IT |

La cattura desktop di Electron e la selezione delle sorgenti vanno implementate sulle API documentate e verificate nella versione scelta [S1, S2]. La mascotte usa una finestra dedicata [S3]. Le librerie vanno fissate nel lockfile: questa roadmap non impone numeri di versione non verificati.

### Struttura prevista

```text
apps/
  desktop/
    src/main/                 # Finestre, permessi, lifecycle, broker IPC
    src/preload/              # Bridge minimo e tipizzato
    src/renderer/             # Dashboard, onboarding, review, mascotte
    src/capture-renderer/     # MediaStream, trasformazioni, encoder
  engine/
    src/domain/               # Sessioni, episodi, evidenze, metriche
    src/jobs/                 # Code locali, retry, lease, cancellazione
    src/analysis/             # LangGraph e provider AI
    src/storage/              # SQLite, cifratura, retention
    src/reports/              # ReportModel, DOCX, export
packages/
  contracts/
  capture-adapter/
  test-fixtures/
native/
  windows-context/            # Solo se giustificato dalle prove, non requisito iniziale
docs/
  adr/
  testing/
  security/
  pilot/
scripts/
  gates/
tests/
  integration/
  replay/
  desktop/
  live-model/
  performance/
```

Il motore deve poter essere testato senza Electron e senza Internet. Il renderer non importa direttamente filesystem, database, chiavi o SDK dei modelli. Non costruire microservizi, Redis o un database a grafo per questo MVP.

## 3. Regole per eseguire la roadmap

### Una checkbox significa lavoro verificato

Ogni attività ha un identificativo stabile `Pxx.yy`. Si marca `[x]` soltanto quando l'implementazione è presente e la verifica indicata è riuscita. La chiusura di una fase richiede anche il relativo gate `Pxx.G`.

Per ogni attività completata registrare in `docs/testing/Pxx.md`: ID, commit, comando, ambiente, esito, artefatto di test e limiti noti. Usare soltanto evidenze sintetiche o prive di dati personali nei file versionati. Screenshot aziendali, registrazioni, database e chiavi non devono finire in Git o negli artefatti CI.

Non segnare come completata una verifica Windows eseguita solo su macOS, un test con mock come prova del modello reale, una revisione legale come conseguenza di un test tecnico o una funzione a pagamento come funzionante senza avere effettuato la chiamata autorizzata.

### Gate da implementare nella fase 01

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:replay
pnpm gate P05
pnpm gate:all
pnpm test:desktop:windows
pnpm test:model:live
pnpm package:win
```

`pnpm gate Pxx` deve eseguire la suite della fase e verificare la presenza delle evidenze obbligatorie. Test mancanti, `skip`, prove manuali non eseguite e dipendenze di fase incomplete non devono produrre un gate verde. Il manifest dei gate distingue verifiche automatiche, hardware e approvazioni umane.

I test ordinari sono deterministici e senza chiamate a pagamento. La valutazione live del modello è esplicita, usa dati sintetici, ha un tetto di spesa e non viene confusa con la suite mock. Da un ambiente privo di desktop Windows, i gate hardware restano pendenti.

## 4. Modello dati e invarianti

| Entità | Contenuto minimo |
| --- | --- |
| `Project` | Contesto locale, finalità, policy di raccolta, tassonomia e retention |
| `Session` | Operatore pseudonimo, inizio/fine, stato, scope, versione della policy |
| `CaptureSource` | Monitor/finestra autorizzati, geometria, scala DPI, intervalli di validità |
| `CaptureEvent` | Timestamp, offset monotono, sequenza, avvio/pausa/blocco/errore/cambio configurazione |
| `Evidence` | Asset ID, sorgente, intervallo, hash, maschere applicate, stato di disponibilità |
| `ActivityType` | Categoria condivisa nel progetto, descrizione e versione |
| `ActivityEpisode` | Esecuzione specifica, eventuale case ID pseudonimo, obiettivo, stato della review |
| `EpisodeInterval` | Intervalli anche discontinui assegnati a un episodio e provenienza dell'assegnazione |
| `Question` / `Answer` | Domanda, evidenze, risposta, rinvio, versione e revisione risultante |
| `AnalysisRun` | Modello, provider, prompt/schema, evidenze in input, esito e consumi disponibili |
| `Opportunity` | Problema, evidenze, alternativa proposta, ipotesi economiche, verifiche mancanti |
| `ReportVersion` | Snapshot del dataset validato, autore della revisione, sezioni e artefatti |
| `Job` / `AuditEvent` | Stato, retry, lease, idempotenza, cancellazione e operazioni rilevanti |

Invarianti obbligatorie:

- Gli orari leggibili e gli offset della sessione sono entrambi conservati. Ogni riavvio del processo apre una nuova epoca del clock; non sottrarre timestamp monotoni provenienti da epoche differenti.
- Due monitor osservati contemporaneamente non raddoppiano il tempo umano. Le durate usano unioni di intervalli.
- Uno screenshot duplicato può essere eliminato, ma non la durata della situazione che rappresenta.
- Cambio applicazione e cambio attività non sono equivalenti. Un episodio può essere interrotto e ripreso.
- Ogni intervallo conteggiato nel totale ha una sola assegnazione primaria oppure è `unknown`; etichette secondarie non aggiungono tempo.
- Tempo inattivo del computer, tempo trascorso, attesa confermata e lavoro evitabile sono concetti distinti.
- I confini inferiti da fotogrammi campionati hanno precisione limitata: registrare provenienza e risoluzione temporale, senza falsa precisione al millisecondo.
- Ogni conclusione deve rimandare a evidenze esistenti o essere etichettata come dichiarazione dell'utente/ipotesi. L'AI non può dichiarare autonomamente un'attività `confirmed`.
- La revoca o eliminazione di un'evidenza invalida i derivati interessati. Un job in esecuzione non può ricreare dati cancellati.
- I dati osservati non costituiscono automaticamente un dataset autorizzato per training o riuso fra clienti.

## Fase 00 — Perimetro, criteri di successo e rischi

**Obiettivo:** rendere esplicito che cosa si costruisce e su quali prove verrà valutato.

- [ ] **P00.01 — Scrivere il contratto dell'MVP.** Definire persona, processo dimostrativo, OS, numero di monitor, dati raccolti e deliverable. **Verifica:** `docs/pilot/mvp-scope.md` contiene inclusioni, esclusioni e un percorso completo riproducibile.
- [ ] **P00.02 — Separare registrazione e analisi remota.** Definire `local_only`, `cloud_after_review` e `cloud_live_authorized`, con prima opzione predefinita. **Verifica:** una matrice descrive che cosa può lasciare il computer in ogni modalità; `local_only` non viene presentata come AI locale se un modello locale non è implementato.
- [ ] **P00.03 — Scrivere threat model e politica dei dati.** Includere screenshot, notifiche, titoli finestre, video, chiavi, log, checkpoint, export e cancellazione. **Verifica:** ogni superficie ha una mitigazione o un rischio residuo documentato; nessuna promessa generica di end-to-end encryption.
- [ ] **P00.04 — Preparare il dataset sintetico di riferimento.** Definire ordine A, interruzione per ordine B, ritorno ad A, ricerca codice, attesa esplicitata e tratto sconosciuto. **Verifica:** annotazioni umane e timeline attesa disponibili senza dati di clienti.
- [ ] **P00.05 — Fissare hardware e misure.** Identificare un PC Windows 11 x64 rappresentativo e configurazioni a uno/due monitor. **Verifica:** scheda hardware e metriche di CPU, memoria, disco, copertura e latenza definite prima del benchmark.
- [ ] **P00.06 — Definire il gate per dati aziendali reali.** Prevedere revisione con referente competente su finalità, accessi, basi applicabili, documentazione e rapporti con fornitori. **Verifica:** checklist nominativa di approvazione; una checkbox nell'app non equivale ad autorizzazione legale.
- [ ] **P00.G — Chiudere la fase.** Revisione del perimetro da parte del responsabile di prodotto e tecnico; nessuna raccolta aziendale reale autorizzata implicitamente.

## Fase 01 — Monorepo, contratti e infrastruttura di test

**Dipendenze:** fase 00.

- [ ] **P01.01 — Inizializzare workspace e versioni.** Configurare pnpm, TypeScript strict, React, Electron Forge, lint, formatter e lockfile. **Verifica:** installazione pulita e build ripetibile su Windows senza dipendenze globali non documentate.
- [ ] **P01.02 — Separare desktop e motore.** Implementare bootstrap del processo engine, handshake e shutdown. **Verifica:** un comando passa UI → IPC → engine → UI; un crash dell'engine viene segnalato senza bloccare la UI.
- [ ] **P01.03 — Definire contratti Zod.** Versionare comandi, eventi, entità e configurazione; usare errori tipizzati. **Verifica:** payload malformati, comandi sconosciuti e versioni incompatibili vengono rifiutati.
- [ ] **P01.04 — Creare adapter sostituibili.** Definire `CaptureAdapter`, `ModelAdapter`, `MediaStore`, `Clock` e repository. **Verifica:** un flusso sintetico completo gira con adapter fake e database temporaneo, senza rete.
- [ ] **P01.05 — Implementare test runner e gate.** Associare gli ID della roadmap a test ed evidenze in un manifest. **Verifica:** test mancante, test saltato o documento hardware assente fanno fallire il relativo gate.
- [ ] **P01.06 — Configurare CI e gestione dei segreti.** Eseguire lint, tipi, unit, integration e build; ignorare dati runtime e `.env`. **Verifica:** secret scan su fixture dedicata e artifact allowlist; nessun video o DB reale può essere caricato per default.
- [ ] **P01.G — Chiudere la fase.** `pnpm gate P01` verde; il controllo documentale di P00 è integrato nel manifest.

## Fase 02 — Spike Windows: cattura, più monitor e packaging

**Dipendenze:** fase 01. **Dati:** soltanto sintetici. Risolvere questi rischi prima di sviluppare tutte le schermate.

- [ ] **P02.01 — Provare una cattura reale.** Usare `desktopCapturer`, il gestore delle richieste media e `getDisplayMedia` con sorgente scelta dall'utente [S1, S2]. **Verifica:** acquisire una finestra e un monitor su un PC Windows interattivo; rifiutare richieste da renderer non autorizzati.
- [ ] **P02.02 — Provare due stream simultanei.** Associare ciascuna richiesta a sorgente e richiedente, evitando una variabile globale vulnerabile a race. **Verifica:** due schermi con pattern differenti rimangono distinti; rispettare le condizioni di attivazione delle API, senza bypass dei permessi.
- [ ] **P02.03 — Validare risoluzione, DPI e sorgenti.** Non usare le miniature del selettore come evidenze [S1]. **Verifica:** testo sintetico leggibile a 1080p e 4K, scale differenti, monitor secondario con coordinate negative e finestra ridimensionata.
- [ ] **P02.04 — Provare la mascotte esclusa dalla cattura.** Valutare `setContentProtection(true)` sulla finestra propria [S3]. **Verifica:** le immagini prodotte non contengono la mascotte; documentare eventuali limiti del metodo usato.
- [ ] **P02.05 — Provare installer e driver nativi.** Generare un pacchetto di sviluppo, includendo il driver SQLite scelto. **Verifica:** avvio su macchina senza Node.js installato; distinguere pacchetto di sviluppo da release firmata.
- [ ] **P02.06 — Decidere l'adattatore definitivo.** Confrontare stabilità e consumo; documentare se serve un componente Windows nativo. **Verifica:** ADR con risultati; se due monitor non funzionano, la funzionalità resta bloccata e non viene dichiarata pronta.
- [ ] **P02.G — Chiudere la fase.** Suite `tests/desktop/P02` più evidenza del test Windows; un test headless o una VM non rappresentativa non sostituisce la prova richiesta.

## Fase 03 — Sessioni, archivio sicuro e coda locale

**Dipendenze:** fase 02.

- [ ] **P03.01 — Implementare schema e migrazioni.** Creare le entità, foreign key, indici e revisioni. **Verifica:** creazione da zero, migrazione del database precedente e rollback applicativo controllato senza perdita silenziosa.
- [ ] **P03.02 — Implementare la macchina a stati.** Separare stato di cattura e analisi: l'analisi pendente non implica registrazione attiva. **Verifica:** transizioni invalide rifiutate; start/stop ripetuti non duplicano sessioni.
- [ ] **P03.03 — Proteggere chiavi e payload.** Usare primitive crittografiche mantenute, cifratura autenticata e chiavi avvolte con il meccanismo OS disponibile; `safeStorage` protegge segreti, non automaticamente tutti i file [S4]. **Verifica:** cifratura/decifratura, manomissione rilevata e assenza dei valori sensibili noti in DB, journal, log e temporanei.
- [ ] **P03.04 — Definire il limite della protezione locale.** Documentare metadati lasciati in chiaro, accesso sotto lo stesso account e comportamento con chiave indisponibile. **Verifica:** nessun fallback silenzioso a salvataggi in chiaro; nel pilot la registrazione si blocca se manca la protezione configurata.
- [ ] **P03.05 — Implementare media store transazionale.** Scritture atomiche, hash, manifest e recupero di asset incompleti. **Verifica:** interruzione durante il salvataggio non produce un'evidenza apparentemente valida ma corrotta.
- [ ] **P03.06 — Implementare job durevoli.** Lease, retry limitati, backoff, cancellation token e chiavi di idempotenza. **Verifica:** riavvio durante un job non duplica episodi, export o domande; la cancellazione impedisce nuove scritture del job.
- [ ] **P03.07 — Impostare quote e retention.** Definire limiti configurabili di disco e durata; esplicitare le categorie di dati e derivati interessate. **Verifica:** soglia disco raggiunta produce pausa e avviso, senza cancellazioni inattese di report approvati.
- [ ] **P03.G — Chiudere la fase.** `pnpm gate P03` verde con prove di crash, recovery, cifratura e cancellazione concorrente.

## Fase 04 — Onboarding, mascotte e controlli dell'operatore

**Dipendenze:** fase 03.

- [ ] **P04.01 — Implementare onboarding locale.** Mostrare finalità, sorgenti, modalità AI, destinazione dati e retention; nessun account cloud obbligatorio. **Verifica:** primo avvio e riavvio non registrano prima di un comando esplicito.
- [ ] **P04.02 — Creare mascotte e pannello.** Finestra piccola nell'angolo destro, trascinabile, stato testuale e accesso da tastiera. **Verifica:** navigazione accessibile, assenza di furto del focus e corretta posizione dopo cambio monitor.
- [ ] **P04.03 — Collegare start, pausa, ripresa e stop.** Visualizzare numero di schermi, durata, stato AI e spazio locale. **Verifica:** i controlli modificano lo stato reale del motore, non soltanto l'aspetto della UI.
- [ ] **P04.04 — Impedire registrazioni invisibili.** Gestire chiusura dashboard, crash mascotte, blocco e sospensione; interrompere se viene meno l'indicatore obbligatorio. **Verifica:** chiudere l'app termina gli stream; dopo sblocco o crash serve ripresa esplicita.
- [ ] **P04.05 — Aggiungere nota manuale e privacy pause.** Permettere note contestuali e pausa immediata; revoca del cloud separata. **Verifica:** nota collegata all'intervallo corretto; stop cloud blocca le nuove richieste e indica quelle già inviate che non possono essere richiamate.
- [ ] **P04.06 — Applicare sicurezza Electron.** Renderer sandboxed, `contextIsolation`, `nodeIntegration: false`, CSP, navigazione e IPC in allowlist [S3]. **Verifica:** input ostile non accede a filesystem, chiavi o comandi arbitrari.
- [ ] **P04.G — Chiudere la fase.** `pnpm gate P04` verde e prova Windows della mascotte durante uso di altre applicazioni.

## Fase 05 — Screenshot, scope e tempo osservato

**Dipendenze:** fase 04.

- [ ] **P05.01 — Implementare selezione delle sorgenti.** Monitor singolo, due monitor o una finestra con anteprima e conferma. **Verifica:** nessun asset da sorgenti non selezionate; un monitor appena collegato non viene aggiunto automaticamente.
- [ ] **P05.02 — Implementare pipeline prima del salvataggio.** Cattura in memoria → maschere opache → evidenza minimizzata → cifratura → archivio. **Verifica:** pattern sensibili sintetici esclusi non compaiono negli asset persistiti né negli input AI.
- [ ] **P05.03 — Gestire limiti dell'esclusione.** Le maschere seguono geometria e DPI; se la mappatura diventa incerta, sospendere. Un filtro dell'app in primo piano non protegge le finestre sullo sfondo. **Verifica:** notifiche, spostamenti e ridimensionamenti nella fixture non aggirano le esclusioni previste.
- [ ] **P05.04 — Selezionare fotogrammi significativi.** Combinare cambiamenti visivi e campionamento periodico configurabile; conservare la durata dei tratti stabili. **Verifica:** fixture con schermata invariata mantiene il tempo corretto pur riducendo gli asset duplicati.
- [ ] **P05.05 — Sincronizzare sorgenti e clock.** Salvare monitor, offset, epoca, geometria e sequenza. **Verifica:** due schermi contemporanei non raddoppiano il totale; cambio ora di sistema non genera durate negative.
- [ ] **P05.06 — Gestire gap ed errori.** Tracciare stream terminato, schermo nero, sospensione, throttling e frame scartati per backpressure. **Verifica:** nessun tratto perso viene descritto come lavoro osservato; campioni mancanti e pause sono distinguibili.
- [ ] **P05.07 — Predisporre contesto applicativo opzionale.** Adapter per applicazione in primo piano e metadati minimizzati; nessun titolo sensibile nei log. Un eventuale componente UI Automation va provato sui software target [S10]. **Verifica:** il flusso principale continua anche se il contesto non è disponibile e lo segnala.
- [ ] **P05.G — Chiudere la fase.** `pnpm gate P05` verde; prova reale a due monitor e test sulle maschere allegati alle evidenze.

## Fase 06 — Video locali ed estratti per attività

**Dipendenze:** fase 05.

- [ ] **P06.01 — Abilitare video opzionali senza audio.** Avviare l'encoder soltanto su stream già minimizzato; verificare supporto MIME e codec con la build scelta [S5]. **Verifica:** file riproducibile, nessuna traccia audio e nessun frame precedente alle maschere.
- [ ] **P06.02 — Gestire blocchi e finalizzazione.** Non assumere che ogni `dataavailable` sia una clip autonoma; definire formato, manifest e recupero [S5]. **Verifica:** segmenti finalizzati riproducibili e segmenti incompleti marcati, non presentati come validi.
- [ ] **P06.03 — Limitare memoria, disco e frequenza.** Benchmark iniziale indicativo a 2–5 fps, configurabile per task rapidi; registrare i parametri effettivi. **Verifica:** una sessione lunga non accumula tutto il video in RAM; i frame eventualmente persi sono conteggiati.
- [ ] **P06.04 — Generare clip da intervalli.** Conservare un originale per sorgente e riferimenti temporali; creare estratti soltanto quando richiesti. **Verifica:** inizio/fine e sorgente corretti con tolleranza dichiarata; intervalli omessi esplicitati nel montaggio.
- [ ] **P06.05 — Gestire dipendenze media e temporanei.** Scegliere un solo percorso di remux/transcodifica, documentandone licenza e packaging. **Verifica:** nessun binario non dichiarato e nessun temporaneo sensibile lasciato in chiaro dopo successo, annullamento o crash gestibile.
- [ ] **P06.G — Chiudere la fase.** `pnpm gate P06` verde; prova di riproduzione degli export su un secondo PC Windows.

## Fase 07 — OpenRouter, output strutturati e budget

**Dipendenze:** fasi 03 e 05; il video non è richiesto per l'analisi iniziale.

- [ ] **P07.01 — Implementare ModelAdapter.** Configurare chiave nel vault, modello vision, timeout e provider ammessi; nessuna chiave nell'installer o renderer. **Verifica:** chiamata mock completa e smoke live separato su sole immagini sintetiche.
- [ ] **P07.02 — Costruire pacchetti di evidenze limitati.** Inviare screenshot selezionati e minimizzati con ID, tempi e contesto strettamente necessario, non ore di video. **Verifica:** dimensioni massime e provenienza validate; nessun URL pubblico di screenshot.
- [ ] **P07.03 — Applicare policy di routing.** Configurare le restrizioni di raccolta e retention supportate, compresi `data_collection` e `zdr` quando previsti dalla policy [S7]. **Verifica:** provider non ammesso o requisiti non disponibili producono job sospeso, mai fallback più permissivo.
- [ ] **P07.04 — Validare output JSON.** Schema per attività candidata, evidenze, dubbi e domande; usare structured outputs su endpoint compatibili [S8]. **Verifica:** rifiuto di schema invalido, evidenze inesistenti, durate inventate e riferimenti fuori sessione.
- [ ] **P07.05 — Gestire errori e costi.** Retry limitato su errori recuperabili, niente retry cieco su autenticazione o policy; tetti di costo e richieste. **Verifica:** fixture 401/429/timeout/5xx, contabilizzazione disponibile e distinzione fra stima e consumo confermato.
- [ ] **P07.06 — Rispettare le tre modalità dati.** In `local_only` nessuna chiamata AI; in `cloud_after_review` inviare solo evidenze approvate; in live esplicitare l'invio immediato. **Verifica:** test di rete osservabile, incluse telemetria e tracing disattivati salvo configurazione autorizzata.
- [ ] **P07.07 — Trattare lo schermo come dato non affidabile.** Nessuno strumento di shell, browser, invio email o modifica file al modello. **Verifica:** screenshot sintetico con prompt injection non può alterare policy, scope, destinatari o eseguire azioni.
- [ ] **P07.G — Chiudere la fase.** `pnpm gate P07` verde; smoke live registrato con costo e provider, oppure stato esplicito `LIVE_PENDING` che impedisce di dichiarare pronta l'integrazione reale.

## Fase 08 — LangGraph, episodi e domande contestuali

**Dipendenze:** fase 07.

- [ ] **P08.01 — Implementare il grafo di analisi.** Preparazione → interpretazione → proposta episodio → eventuale domanda → consolidamento. **Verifica:** replay deterministico produce l'output atteso senza controllare il registratore.
- [ ] **P08.02 — Rendere persistente lo stato.** Checkpointer compatibile con la versione JS scelta, payload sensibili protetti, `thread_id` legato a progetto/sessione/versione [S6]. **Verifica:** restart riprende il run corretto senza duplicare richieste completate o mischiare progetti.
- [ ] **P08.03 — Gestire attività interrotte.** Separare tipo, episodio e intervalli; unire i ritorni allo stesso caso solo con evidenze o conferma. **Verifica:** scenario A → B → A ricostruito correttamente e tempo di B non attribuito ad A.
- [ ] **P08.04 — Gestire incertezza e tassonomia.** Categorie iniziali concordate, `other` e `unknown`; nuove categorie solo proposte. **Verifica:** passaggio ambiguo rimane da rivedere; il modello non crea una falsa conferma né presenta probabilità non calibrate.
- [ ] **P08.05 — Implementare domande non intrusive.** Quota iniziale massima di tre domande proattive al giorno, cooldown, rinvio e nessun cambio di focus. **Verifica:** budget persistente attraverso riavvii; lo stesso dubbio non genera domande duplicate.
- [ ] **P08.06 — Collegare interrupt e risposte.** Usare interruzioni/ripresa del grafo dove utile [S6]; domanda riferita a una versione precisa. **Verifica:** risposte tardive, doppie o appartenenti a un altro episodio non corrompono il run; la registrazione prosegue.
- [ ] **P08.07 — Conservare correzioni e memoria verificata.** Memorizzare definizioni e correzioni nel progetto, senza training o riuso automatico fra clienti. **Verifica:** una correzione entra nella successiva analisi autorizzata e rimane revocabile.
- [ ] **P08.G — Chiudere la fase.** `pnpm gate P08` verde su interruzioni, restart, domande rimandate e segmenti sconosciuti.

## Fase 09 — Dashboard, revisione umana e dataset per attività

**Dipendenze:** fase 08.

- [ ] **P09.01 — Visualizzare sessioni e timeline.** Mostrare scope, copertura, attività, pause, gap e stato AI; nessuna classifica personale. **Verifica:** la UI coincide con il dataset e distingue tempo non osservato da inattività.
- [ ] **P09.02 — Creare schede attività.** Obiettivo, passaggi, screenshot, clip quando disponibili, risposte e livello di revisione. **Verifica:** ogni evidenza si apre sul monitor/intervallo corretto e gli asset mancanti sono segnalati.
- [ ] **P09.03 — Implementare editor di episodi.** Rinominare, dividere, unire, riassegnare e confermare. **Verifica:** operazioni transazionali, storico e ricalcolo; nessuna sovrapposizione primaria che gonfi il tempo totale.
- [ ] **P09.04 — Implementare gestione delle esclusioni retroattive.** Rimuovere un intervallo e invalidare episodi, checkpoint o report derivati. **Verifica:** rieseguire un vecchio job non ricrea contenuti eliminati; export esterni già distribuiti sono esplicitamente fuori dal controllo automatico.
- [ ] **P09.05 — Produrre il dataset canonico.** `activity.json` con ID stabili, intervalli, evidenze, provenienza, versione e stato di review. **Verifica:** validazione dello schema e confronto con fixture; nessun nome file deciso direttamente dal modello.
- [ ] **P09.06 — Costruire raggruppamento e ricerca locale.** Navigazione per tipo di attività, sessione e stato; i gruppi non spostano arbitrariamente gli asset originali. **Verifica:** rinominare un tipo non rompe riferimenti, clip o versioni precedenti.
- [ ] **P09.G — Chiudere la fase.** `pnpm gate P09` verde; un revisore completa il flusso senza intervenire sul database.

## Fase 10 — Metriche temporali e opportunità economiche

**Dipendenze:** fase 09.

- [ ] **P10.01 — Calcolare le durate in codice.** Unioni/intersezioni di intervalli, pause, gap, tempo assegnato e non classificato. **Verifica:** test property-based e fixture multi-monitor; incertezza dei confini conservata nei riepiloghi.
- [ ] **P10.02 — Distinguere osservazioni e interpretazioni.** Attesa confermata, ricerca, reinserimento e correzione sono categorie documentate, non diagnosi ottenute dal solo idle. **Verifica:** schermata ferma senza spiegazione non diventa automaticamente spreco.
- [ ] **P10.03 — Confrontare casi comparabili.** Mostrare numerosità, varianti e dispersione dei tempi; non estrapolare una giornata da pochi minuti senza dichiararlo. **Verifica:** dati insufficienti producono avviso, non una stima annuale certa.
- [ ] **P10.04 — Generare Opportunity strutturate.** Includere evidenze, alternative non-AI, dipendenze, eccezioni e controlli umani. **Verifica:** nessuna opportunità senza fonte; costo di implementazione segnato preliminare finché manca verifica tecnica.
- [ ] **P10.05 — Raccogliere gli input economici mancanti.** Volumi, costo orario, quota coperta, tempo residuo incluse eccezioni, costi iniziali e ricorrenti, fattore di utilizzo della capacità. **Verifica:** valori assenti restano `unknown`; l'AI non li inventa.
- [ ] **P10.06 — Implementare scenari e formule.** Ore potenziali = volume × quota coperta × minuti risparmiati / 60. Beneficio di capacità = ore × costo orario × fattore di utilizzo. ROI anno 1 = (beneficio annuo − investimento − costi annui) / (investimento + costi annui). **Verifica:** unità, denominatori, valori limite e scenari confrontati con fixture indipendente.
- [ ] **P10.07 — Separare capacità da cassa e somme incompatibili.** Payback solo con beneficio netto mensile positivo; identificare opportunità sovrapposte. **Verifica:** nessun doppio conteggio delle stesse ore o di ricavi e risparmi; risultato esplicitamente ipotetico e non promessa commerciale.
- [ ] **P10.G — Chiudere la fase.** `pnpm gate P10` verde; revisione umana di almeno tre business case sintetici, incluso un caso in cui non conviene automatizzare.

## Fase 11 — DOCX ed esportazione portabile

**Dipendenze:** fasi 06, 09 e 10.

- [ ] **P11.01 — Definire ReportModel versionato.** Perimetro, copertura, attività, metriche, evidenze, dubbi, opportunità e ipotesi. **Verifica:** uno stesso snapshot genera dati coerenti nella UI, nel JSON e nel DOCX.
- [ ] **P11.02 — Generare il documento Word.** Usare `docx` [S9], con titoli, tabelle, screenshot leggibili, didascalie e riferimenti alle clip. **Verifica:** struttura OOXML valida, media incorporati, assenza di riferimenti rotti e revisione visiva in Word su Windows.
- [ ] **P11.03 — Separare bozza e approvato.** L'utente rivede sezioni e ipotesi; salvare revisore, versione e data. **Verifica:** un report non validato è marcato bozza e non contiene claim di approvazione automatica.
- [ ] **P11.04 — Esportare cartelle per attività.** Produrre `report/`, `attivita/<tipo>/<episodio>/`, screenshot, clip, `activity.json` e indice HTML statico. **Verifica:** apertura su altro PC senza il database originale e nomi Windows validi, sanitizzati e non collidenti.
- [ ] **P11.05 — Proteggere export e percorsi.** Selezione esplicita della destinazione, warning per copie decifrate, validazione dei path e HTML escapato. **Verifica:** traversal, nomi ostili, link esterni e contenuti del modello non eseguono codice né scrivono fuori destinazione.
- [ ] **P11.06 — Gestire dati mancanti e rigenerazione.** Clip opzionali, screenshot cancellati e run AI falliti devono essere dichiarati. **Verifica:** rigenerare il report preserva provenienza e non inventa evidenze; una revisione crea una nuova versione.
- [ ] **P11.G — Chiudere la fase.** `pnpm gate P11` verde; export e DOCX aperti su Windows con revisione visiva documentata.

## Fase 12 — Hardening, release firmata e test di durata

**Dipendenze:** fase 11.

- [ ] **P12.01 — Eseguire fault injection.** Terminare engine/renderer, interrompere rete, simulare disco pieno, cambiare monitor e bloccare il PC. **Verifica:** arresto sicuro, gap espliciti, nessuna cattura invisibile e nessuna perdita silenziosa di dati validati.
- [ ] **P12.02 — Eseguire test offline.** Sessione completa senza rete, review ed export già disponibili; AI in coda. **Verifica:** nessun blocco della registrazione per indisponibilità del modello e nessun invio retroattivo senza policy valida.
- [ ] **P12.03 — Eseguire benchmark Windows.** Sessione di due ore su uno/due monitor con carico ufficio; registrare CPU, RAM, disco, frame persi e latenza dei controlli. **Verifica:** report rispetto ai budget fissati; eventuali scostamenti bloccano o restringono il profilo supportato.
- [ ] **P12.04 — Verificare cancellazione completa nel perimetro gestito.** Includere media, payload, code, checkpoint, indici, cache e backup gestiti; mantenere solo audit minimo consentito. **Verifica:** ricerca dei valori sintetici noti e tentativo di ripartenza dei job; non promettere secure erase universale di SSD o copie esterne.
- [ ] **P12.05 — Produrre installer firmato.** Firma e timestamp secondo il percorso scelto [S11], distinta dai test di build. **Verifica:** firma valida e installazione, aggiornamento conservativo e disinstallazione su PC pulito; gestione esplicita dei dati locali.
- [ ] **P12.06 — Revisionare superficie d'attacco e dipendenze.** IPC, contenuti remoti, media parser, cryptography, licenze e segreti. **Verifica:** nessuna vulnerabilità critica nota non gestita; limiti residui descritti e approvati prima del pilot.
- [ ] **P12.07 — Preparare diagnostica e manuale.** Log privi di contenuti di schermo, guida installazione, stop, revoca cloud e cancellazione. **Verifica:** supporto tecnico possibile senza inviare automaticamente screenshot o registrazioni.
- [ ] **P12.G — Chiudere la fase.** `pnpm gate P12` verde; artefatto firmato identificato da versione/hash e test eseguiti sulla stessa build.

## Fase 13 — Pilot supervisionato e validazione del valore

**Dipendenze:** fase 12 e approvazioni previste da P00.06. Nessuna fase tecnica autorizza da sola il trattamento di dati aziendali reali.

- [ ] **P13.01 — Avviare prima il pilot sintetico.** Eseguire 60–90 minuti con un flusso realistico e annotatore indipendente. **Verifica:** export completo e report comprensibile senza spiegazione dello sviluppatore.
- [ ] **P13.02 — Formalizzare il pilot aziendale.** Un processo, referente, partecipanti, sistemi, periodo, accessi, retention, fornitori e deliverable concordati. **Verifica:** approvazioni registrate e perimetro coerente con la build distribuita.
- [ ] **P13.03 — Valutare il riconoscimento.** Usare almeno 20 episodi annotati, separando esempi usati per migliorare i prompt ed esempi di verifica. **Verifica:** metriche prima/dopo correzione, errori di confine, percentuale `unknown` e precisione delle categorie documentati; il campione non viene presentato come prova statistica universale.
- [ ] **P13.04 — Valutare il carico sull'operatore.** Misurare domande, rinvii, tempo di review e interruzioni percepite. **Verifica:** superamenti della quota o review troppo onerosa generano una modifica di prodotto, non vengono nascosti nei risultati.
- [ ] **P13.05 — Misurare il costo di un report approvato.** Raccogliere installazione, supporto, calcolo, token, revisione e manutenzione. **Verifica:** costo totale e ore di discovery confrontabili con una sessione di analisi manuale sullo stesso perimetro.
- [ ] **P13.06 — Verificare un'opportunità concreta.** Confrontare evidenze con il responsabile di processo, esplorare integrazioni e verificare se esiste un intervento utile anche non-AI. **Verifica:** specifica preliminare e criteri di accettazione; nessuna automazione distribuita automaticamente dal prototipo.
- [ ] **P13.07 — Decidere prosecuzione o restringimento.** Documentare errori, fiducia nel report, disponibilità a proseguire e riuso del processo in un secondo contesto. **Verifica:** decisione scritta `GO`, `REVISE` o `STOP`, con motivazione; una prova gratuita non viene contata come vendita.
- [ ] **P13.G — Chiudere la fase.** Report di validazione rivisto dai responsabili e tutti i gate tecnici richiesti passati. Dichiarare separatamente le funzionalità ancora sperimentali.

## 5. Milestone e ordine operativo

| Milestone | Fasi richieste | Cosa si può dimostrare |
| --- | --- | --- |
| M0 — Fattibilità Windows | 00–02 | Installazione e cattura su hardware target |
| M1 — Registratore controllabile | 03–06 | Mascotte, pause, scope, screenshot e video locali |
| M2 — Attività ricostruite | 07–09 | Analisi, poche domande e revisione del dataset |
| M3 — Prototipo completo | 10–11 | Opportunità documentate, cartelle e DOCX |
| M4 — Pilot utilizzabile | 12–13 | Release verificata e misurazione del valore |

Procedere per gate, non per promessa di una data. Si può anticipare il lavoro indipendente sui fixture e sul template DOCX, ma nessuna milestone può essere dichiarata conclusa senza le dipendenze. Le stime temporali vanno aggiornate dopo lo spike Windows e non includono automaticamente approvazioni IT o altre verifiche esterne.

## 6. Soglie iniziali da validare

Queste sono soglie di progetto proposte, non prestazioni già misurate né garanzie commerciali. Congelarle nella fase 00 o modificarle con ADR prima della valutazione finale.

| Indicatore | Obiettivo iniziale | Misura |
| --- | --- | --- |
| Evidenze fuori scope | Zero | Fixture con pattern distinguibili e audit degli asset |
| Rete AI in `local_only` | Zero richieste | Osservazione della rete e adapter bloccato |
| Screenshot persistiti durante pausa/blocco | Zero per timestamp di acquisizione | Non confondere flush di frame precedenti con nuova cattura |
| Accounting del tempo | Nessun doppio conteggio | Invarianti e fixture; incertezza dei confini esplicitata |
| Domande proattive | Massimo 3 al giorno per default | Contatore persistente, rinvii inclusi nel carico misurato |
| Copertura della sessione autorizzata | Almeno 95% nel benchmark concordato | Misura sul campionamento previsto; esclusi pause e blocchi espliciti, non gli errori |
| Classificazione automatica | Macro-F1 indicativa almeno 0,80 sul piccolo holdout | Pubblicare anche `unknown`, numerosità e metriche per categoria; soglia rivedibile |
| Reattività dei controlli | Conferma UI entro 250 ms p95; stop della cattura entro 1 s p95 | Benchmark sul PC target; nessuna media che nasconda code lunghe |
| Review della sessione | Obiettivo iniziale entro 10 minuti per 60–90 minuti acquisiti | Cronometrare una persona diversa dallo sviluppatore |
| Stabilità | 2 ore senza crash, crescita memoria non limitata o perdita silenziosa | Benchmark con carico realistico; CPU/RAM/dimensioni riportate separatamente |
| Attendibilità del report | Ogni affermazione fattuale collegata a dati o dichiarazioni | Audit delle evidenze e approvazione umana |

## 7. Formula e fixture economica di riferimento

Usare questa fixture esclusivamente per testare i calcoli:

```text
volume_annuo = 12.000 casi
quota_coperta = 0,70
tempo_prima = 6 min/caso
tempo_dopo = 2 min/caso, incluse verifiche ed eccezioni della quota coperta
costo_orario = 30 EUR
fattore_utilizzo_capacita = 0,70
investimento = 6.000 EUR
costi_ricorrenti_annui = 3.000 EUR

ore_potenziali = 12.000 × 0,70 × (6 - 2) / 60 = 560 h
valore_capacita = 560 × 30 × 0,70 = 11.760 EUR/anno
beneficio_netto_annuo_a_regime = 11.760 - 3.000 = 8.760 EUR
ROI_anno_1 = (11.760 - 6.000 - 3.000) / 9.000 = 30,6667%
payback_a_regime = 6.000 / (8.760 / 12) = circa 8,22 mesi
```

Il risultato valorizza capacità utilizzabile, non dimostra risparmio di cassa. Tempi di avvio, ulteriori costi e imposte non sono inclusi in questa fixture; nel prodotto devono essere dichiarati o modellati. Se il beneficio netto mensile è nullo o negativo, il payback è `non raggiunto`, non zero mesi.

## 8. Backlog successivo, non bloccante per l'MVP

- [ ] **E01 — Contesto Windows avanzato.** UI Automation mirata sui gestionali dei piloti, solo quando migliora metriche misurate; test dedicati per ciascuna applicazione.
- [ ] **E02 — Modello locale.** Adapter verso un runtime autorizzato; benchmark privacy, qualità e risorse sul PC target prima di promettere analisi offline.
- [ ] **E03 — Aggregazione fra operatori.** Correlazione tramite case ID e ruoli autorizzati, senza dedurre collegamenti dalla sola simultaneità; nuova valutazione del perimetro dati.
- [ ] **E04 — Backend condiviso.** Fastify e PostgreSQL quando richiesti; tenant isolation, identità, ruoli e migrazioni verificati prima di trasferire dati locali.
- [ ] **E05 — Connettori documentali e gestionali.** Import strutturati e sola lettura per integrare le evidenze; nessun accesso con privilegi impliciti.
- [ ] **E06 — Specifiche per l'automazione.** Esportare obiettivi, trigger, dati, eccezioni, approvazioni e test per un esecutore esterno; mai confondere specifica generata con implementazione collaudata.
- [ ] **E07 — Misurazione prima/dopo.** Protocollo comparabile, controllo di volumi e case mix; aggiornare stime con risultati reali senza attribuire causalità non dimostrata.
- [ ] **E08 — Libreria di processi riutilizzabili.** Template astratti autorizzati; niente riutilizzo automatico di video, listini, ordini o dati di clienti.
- [ ] **E09 — Altri sistemi operativi.** macOS e Linux come adattatori separati, con permessi, packaging e matrice hardware propri.

## 9. Checklist finale di consegna

- [ ] Installer della build verificata, firma e hash disponibili per il pilot.
- [ ] Avvio e stop espliciti; mascotte visibile; nessuna registrazione nascosta o audio.
- [ ] Monitor selezionati acquisiti e distinti; limiti del supporto dichiarati.
- [ ] Archivio, chiavi, quota disco, retention e cancellazione verificati.
- [ ] Registrazione indipendente dalla rete e dai tempi del modello.
- [ ] Attività, domande e correzioni ricostruibili dalle evidenze.
- [ ] Cartelle, clip e DOCX aperti su un secondo computer.
- [ ] Metriche temporali senza doppio conteggio e business case con ipotesi esplicite.
- [ ] Gate hardware, live-model e approvazioni umane distinti dai test automatici.
- [ ] Nessuna funzionalità futura presentata come già pronta; nessun dato aziendale in Git o CI.

## 10. Riferimenti tecnici primari

Le scelte di prodotto, soglie e fixture in questa roadmap sono proposte progettuali. I riferimenti seguenti documentano le API; non costituiscono prova che la futura implementazione sia corretta. Consultarli nuovamente quando si fissano le versioni.

- **[S1] Electron desktopCapturer:** https://www.electronjs.org/docs/latest/api/desktop-capturer
- **[S2] Electron Session e richieste display media:** https://www.electronjs.org/docs/latest/api/session
- **[S3] Electron BrowserWindow, isolamento e protezione della propria finestra:** https://www.electronjs.org/docs/latest/api/browser-window
- **[S4] Electron safeStorage:** https://www.electronjs.org/docs/latest/api/safe-storage
- **[S5] MediaRecorder:** https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- **[S6] LangGraph.js, interrupt e ripresa:** https://docs.langchain.com/oss/javascript/langgraph/interrupts
- **[S7] OpenRouter, selezione e policy dei provider:** https://openrouter.ai/docs/guides/routing/provider-selection
- **[S8] OpenRouter, structured outputs:** https://openrouter.ai/docs/guides/features/structured-outputs
- **[S9] docx per JavaScript/TypeScript:** https://docx.js.org/
- **[S10] Microsoft UI Automation:** https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview
- **[S11] Electron Forge, firma Windows:** https://www.electronforge.io/guides/code-signing/code-signing-windows
