# Octo Core

[Sito e download](https://francemazzi.github.io/octo_core/) · [Repository GitHub](https://github.com/francemazzi/octo_core) · [Roadmap di sviluppo](./roadmap.md)

**Dal lavoro osservato a un processo documentato. Prima di automatizzare.**

Octo Core è un progetto di app desktop Windows-first per documentare come si svolge il lavoro tra email, documenti, fogli di calcolo e gestionali. Una mascotte visibile accompagna sessioni di registrazione autorizzate, pone poche domande contestuali e aiuta a trasformare le evidenze raccolte in attività strutturate, screenshot, brevi video e report DOCX.

L'obiettivo è capire **dove viene impiegato tempo, quali passaggi si ripetono e quali miglioramenti meritano una verifica**, senza confondere l'attività sul computer con la produttività della persona.

> **Stato: MVP in prova.** L'app desktop, il motore e i pacchetti di rilascio esistono e i gate automatici **A00–A14** sono verdi su dati sintetici. Le prove su Windows reale, con modelli live e con dati aziendali restano nei binari B e C della [roadmap](./roadmap.md).

## Perché esiste

Prima di costruire un'automazione bisogna capire che cosa succede davvero: quali informazioni vengono ricopiate, dove si cercano documenti, quali controlli sono necessari e quali eccezioni cambiano il percorso.

Octo Core nasce per ridurre il lavoro di ricostruzione manuale dei processi. Il primo ambito sono le attività di ufficio delle PMI manifatturiere, come l'inserimento di ordini e la gestione dei documenti operativi.

Il risultato non deve essere una registrazione da riguardare per ore, ma **un dataset di attività verificabili e un documento utile per decidere il passo successivo**. Il dataset serve all'analisi del processo: non è automaticamente destinato all'addestramento di modelli.

## Come funzionerà

```text
Avvio esplicito e selezione delle sorgenti
    ↓
Registrazione locale con mascotte e controlli visibili
    ↓
Screenshot significativi, video ed eventi temporali
    ↓
Analisi delle evidenze autorizzate e domande contestuali
    ↓
Revisione umana delle attività ricostruite
    ↓
Cartelle per attività + clip + report DOCX
```

| Passaggio | Esperienza prevista |
| --- | --- |
| **Configura** | Scegli uno o due monitor, oppure una finestra, e definisci il perimetro di acquisizione. |
| **Registra** | Avvia la sessione. Il logo in alto a destra mostra lo stato e, al passaggio del mouse, pausa, ripresa e arresto. La finestra di Octo elenca le sessioni per giorno con le attività riconosciute e un riassunto. |
| **Chiarisci** | Rispondi a poche domande pertinenti, per esempio: «Questi passaggi appartengono allo stesso ordine?». Puoi rinviarle. |
| **Rivedi** | Conferma, correggi, dividi o unisci le attività. I segmenti senza evidenze sufficienti restano non classificati. |
| **Esporta** | Ottieni attività documentate, screenshot selezionati, brevi video e un riepilogo DOCX collegato alle evidenze. |

L'analisi non deve bloccare la registrazione. Le domande proattive avranno un limite configurabile; il valore iniziale previsto è tre al giorno.

## Cosa produce il prototipo

L'unità centrale è l'**episodio di attività**: una specifica esecuzione, come lavorare su un ordine. Non coincide con un'applicazione aperta e può essere interrotto e ripreso.

Ogni episodio comprenderà obiettivo, intervalli temporali, passaggi, applicazioni coinvolte, evidenze, eventuali eccezioni e stato della revisione. Episodi simili saranno raggruppati per tipo di attività.

Esempio di esportazione prevista:

```text
sessione-001/
├── indice.html
├── report/
│   └── riepilogo-sessione.docx
├── attivita/
│   └── inserimento-ordine/
│       └── episodio-001/
│           ├── activity.json
│           ├── screenshot/
│           └── clip.webm
└── da-verificare/
```

Il DOCX riassumerà il perimetro osservato, le attività, i tempi, le evidenze principali e le opportunità da approfondire. **Osservazioni, dichiarazioni dell'utente e ipotesi di miglioramento resteranno distinguibili.**

Le valutazioni economiche richiederanno input aggiuntivi, come volumi, costi, fattibilità e tempo di controllo residuo. Il tempo potenzialmente liberato non sarà presentato automaticamente come risparmio di cassa.

## Architettura (sintesi)

Dettaglio, invarianti e fasi in [roadmap.md](./roadmap.md).

| Componente | Scelta |
| --- | --- |
| **Desktop** | Electron + React + TypeScript; dashboard e mascotte separate |
| **Motore** | Processo Node figlio; JSON newline-delimited su stdin/stdout; testabile senza Electron |
| **Contratti** | Zod condivisi (`packages/contracts`) |
| **Persistenza** | SQLite; testo delle schermate cifrato (AES-GCM, `KeyProvider`); la chiave è avvolta con `safeStorage` in `media-key.bin` e sopravvive al riavvio |
| **Cattura** | `CaptureAdapter` — sintetico in sviluppo/test; Electron reale in fase A11 |
| **Analisi** | LangGraph.js + `ModelAdapter` (mock/default `local_only`; OpenRouter opzionale) |
| **Report** | `docx` da ReportModel validato |
| **Verifica** | Vitest; **un test di integrazione per fase A**; replay; Windows/live solo binario B |

## Dati locali e analisi AI

| Modalità | Comportamento |
| --- | --- |
| `local_only` | Predefinita: acquisizione e revisione locale, senza inviare evidenze ai modelli remoti. |
| `cloud_after_review` | Analisi remota soltanto delle evidenze approvate dopo la revisione. |
| `cloud_live_authorized` | Analisi remota durante la sessione, nel perimetro autorizzato. |

OpenRouter sarà configurato con modelli e provider ammessi. Un errore o un endpoint non disponibile non dovrà attivare un invio alternativo non autorizzato. Senza rete, i job remoti resteranno in coda e lo stato sarà visibile.

## Principi non negoziabili

- **Controllo dell'utente.** Avvio esplicito, sorgenti selezionate, stato visibile e possibilità di sospendere la registrazione.
- **Evidenze prima delle conclusioni.** Nessuna attività confermata soltanto dal modello; correzioni e versioni devono restare tracciabili.
- **Tempi misurati in codice.** Due monitor non raddoppiano il tempo. Inattività, attesa, interruzione e lavoro evitabile sono concetti distinti.
- **Minimizzazione e sicurezza.** Maschere prima del salvataggio o dell'invio, accessi limitati, retention e cancellazione dei derivati. Nessun dato aziendale, segreto o media reale in Git e negli artefatti CI.
- **Separazione tra osservazione e azione.** Il modello interpreta contenuti non affidabili; non riceve strumenti per eseguire comandi o modificare i sistemi osservati.

Prima di qualsiasi pilot con dati aziendali reali è prevista una verifica del perimetro (binario C nella roadmap). La prima demo utilizzerà esclusivamente dati sintetici.

## Perimetro dell'MVP

**Target iniziale:** Windows 11 x64, un operatore, uno o due monitor e sessioni dimostrative di 60–90 minuti.

L'acquisizione riguarda il contenuto visibile delle sorgenti autorizzate: non comporta accesso a finestre mai aperte, database, schermate sicure o contenuti protetti.

**Fuori perimetro:** automazione autonoma del PC, keylogging, clipboard, audio, webcam, registrazione nascosta, classifiche dei dipendenti, training sui dati dei clienti e backend multi-tenant. macOS, Linux, Citrix e Remote Desktop non sono obiettivi di compatibilità garantita per questo MVP.

## Esecuzione e milestone

Lo **sviluppo del binario A** (implementazione continua) è pensato per girare su **macOS e CI**: cattura sintetica, mock del modello, nessuna rete obbligatoria. Le prove su **PC Windows**, lo **smoke OpenRouter** e le **approvazioni umane** sono binari **B** e **C**: possono restare `pending` senza bloccare le fasi A.

Ogni fase **A00–A14** si chiude solo quando passa `pnpm gate Axx`, cioè un **test di integrazione deterministico** nominato in roadmap (più i test unitari della fase). Il dettaglio è in [roadmap.md § Contratto del test di integrazione](./roadmap.md#3-contratto-del-test-di-integrazione).

| Milestone | Fasi A | Risultato dimostrabile (automatico) |
| --- | --- | --- |
| **M0 — Flusso sintetico** | A00–A05 | Fixture oracolo, archivio, tempo e evidenze da cattura sintetica |
| **M1 — Intelligenza e export** | A06–A09 | Episodi, policy AI mock, revisione, DOCX e cartelle |
| **M2 — Desktop e hardening** | A10–A12 | Shell Electron, video/porta cattura, fault simulati |
| **M3 — Uso reale** | A13–A14 | Assistente con citazioni; registrazione solo a computer pronto, pausa se la lettura si ferma, sessioni leggibili dopo il riavvio |

Il **pilot** non è una milestone di codice: richiede A12 verde e `pnpm gate:release` (binari B + C).

### Comandi (contratto da fase A01)

Disponibili quando la fase **A01** è implementata e verificata:

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:replay
pnpm gate Axx        # es. pnpm gate A05
pnpm gate:all        # tutte le fasi A nel manifest
pnpm gate:release    # pilot: Windows, modello live, checklist umane
```

**Primo traguardo di prodotto (M1):** ricostruire la sessione della fixture oracolo con poche correzioni, tempi riconciliati con l'unione degli intervalli e un DOCX da cui capire quale problema approfondire — dimostrato dai gate A07–A09, senza dipendere da hardware Windows.

## Prima di registrare

Octo registra solo quando può leggere e analizzare ciò che registra. Nella finestra principale, sopra **Avvia**, la lista **Prima di registrare** mostra cosa manca e come sistemarlo; Avvia resta spento finché la lista non è completa, e si aggiorna da sola ogni pochi secondi.

1. **Ollama.** Va installato e avviato sul computer che registra (in Desktop remoto: sul computer remoto). **Installa Ollama** apre la pagina di download.
2. **Modello di lettura.** **Scarica modello di lettura** fa scaricare a Ollama `glm-ocr`, con l'avanzamento: niente terminale.
3. **Modello di analisi.** **Scarica modello locale** scarica `qwen3.5:4b`, leggero e adatto a un computer senza GPU; in alternativa **Inserisci una chiave** apre le Impostazioni per OpenRouter o Claude. Basta uno dei due.

Durante la registrazione, se `glm-ocr` non legge e c'è già una chiave OpenRouter o Claude, Octo trascrive quella schermata una volta con il provider selezionato (senza conservazione dei dati su OpenRouter) e lo dice nella finestra. Senza chiave, o se anche quel provider fallisce, Octo **mette in pausa da solo** e dice perché; **Riprendi** torna disponibile quando la lista è di nuovo completa. Dopo **Stop** l'analisi parte con il modello locale; se c'è solo il provider remoto si apre subito la conferma di invio. La chiave che cifra le schermate resta nel keystore del sistema (`media-key.bin`), così una sessione non analizzata resta leggibile dopo aver chiuso Octo. Su Linux senza portachiavi la registrazione non parte.

In sviluppo `OCTO_MEDIA_KEY=memory` tiene la chiave in memoria (serve alla CI senza keystore; l'app installata la ignora). Dettagli e audit in [docs/security/data-modes.md](./docs/security/data-modes.md).

## Provider remoti: OpenRouter e Claude

In **Impostazioni**, scegli OpenRouter oppure **Claude (Anthropic)**, inserisci la relativa API key e premi **Salva**. Le due chiavi restano separate e cifrate con il keystore del sistema; al renderer tornano soltanto le ultime quattro cifre. **Usa come predefinito** seleziona il provider delle prossime analisi. La prima chiave salvata, quando nessun provider è attivo, diventa subito quella predefinita; il salvataggio di un secondo provider non cambia quello attivo.

La configurazione OpenRouter precedente viene migrata automaticamente al formato v2, conservando chiave e modello. Il controllo della chiave Anthropic usa `GET /v1/models`, senza evidenze e senza generazione: non garantisce credito disponibile o accesso al modello richiesto. Il modello predefinito è `claude-sonnet-5-5`, modificabile nel campo Modello.

Prima dell'invio, la sessione mostra provider, modello, quantità di schermate e limite di richieste. L'analisi parte soltanto con il testo delle evidenze approvate, mai con le immagini. La conferma decade se cambia il destinatario; durante l'analisi non si modificano le impostazioni del provider. `local_only` non invia il testo delle evidenze a servizi remoti. Se invece `glm-ocr` non riesce a leggere una schermata e una chiave è già salvata, quella immagine può uscire una volta per la sola trascrizione, come descritto sopra. Non esiste fallback automatico tra OpenRouter e Anthropic.

OpenRouter mantiene i vincoli di routing ZDR già previsti. Per Anthropic valgono le condizioni dell'account: Octo non promette conservazione zero. Riferimenti: [Messages API](https://platform.claude.com/docs/en/api/messages/create), [Models API](https://platform.claude.com/docs/en/api/models/list), [conservazione dei dati](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data).

Per avviare il motore tramite ambiente:

- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_TOKENS` (default 4000).
- `ANTHROPIC_WORKSPACE_ID` o il campo **Workspace Anthropic** nelle impostazioni, per chiavi non associate a un workspace. L’ID viene inviato nell’header `anthropic-workspace-id` sia per la verifica sia per l’analisi; cambiarlo richiede una nuova conferma. Le chiavi già associate a un workspace non richiedono il campo.
- `OCTO_REMOTE_PROVIDER=anthropic` oppure `openrouter`. Senza selezione esplicita, OpenRouter ha precedenza se la sua chiave è presente, altrimenti Anthropic.
- Le impostazioni salvate hanno precedenza sull'ambiente. Rimuovere la chiave attiva ripristina solo l'eventuale chiave ambiente dello stesso provider; altrimenti l'analisi remota diventa indisponibile.
- `OCTO_ANTHROPIC_URL` è riservato ai server finti di test e accetta solo loopback.

`pnpm test:anthropic` esegue lo smoke live separato del binario B, con una chiave fornita nell'ambiente e soli dati sintetici. Può generare al massimo due richieste da 800 token di output ciascuna, fatturate dal provider. Non entra nei gate A o nella CI ordinaria; senza chiave resta `pending`.

## Assistente della sessione

Nel dettaglio di una sessione ferma c'è il pannello **Assistente della sessione**: una domanda in italiano ("quanto ho lavorato sull'ordine?") riceve una risposta che cita le attività e le schermate su cui si basa. Le citazioni sono verificate dal motore: una risposta senza riscontri è mostrata come **non verificata**. L'assistente usa Ollama in locale; con un provider remoto configurato puoi sceglierlo per domanda, dopo la stessa conferma dell'analisi remota, e partono solo le schermate approvate. Ogni chiamata è registrata come le analisi (`chat@1`), con audit di rete prima di ogni invio remoto. L'assistente non modifica mai le attività.

Le risposte che dai alle domande del modello restano sull'attività come **dichiarazione dell'operatore**: compaiono nel dettaglio, nel DOCX e in `activity.json`, e l'assistente le conosce. Dettagli del perimetro in [docs/security/data-modes.md](./docs/security/data-modes.md).

## Licenza e firme

Octo Core è software libero distribuito sotto **GPL-3.0-or-later** (file `LICENSE`). Chi riceve un pacchetto, firmato o no, ha gli stessi diritti di chi compila dai sorgenti: la firma attesta soltanto l'origine del binario e non aggiunge condizioni alla licenza. Le dipendenze di produzione sono verificate da `pnpm check:licenses` (allowlist di licenze compatibili in `scripts/gates/licenses.ts`); l'elenco con le rispettive licenze è in `THIRD-PARTY-NOTICES.txt`, allegato a ogni release e incluso nei pacchetti.

I pacchetti macOS sono firmati con Developer ID e notarizzati da Apple quando la release è prodotta con le credenziali configurate. I pacchetti Windows sono firmati con Azure Artifact Signing solo se il servizio è configurato; in caso contrario escono **non firmati** e la release lo dichiara in `UNSIGNED.txt`. Su un binario non firmato SmartScreen mostra «PC protetto da Windows»: procedere con «Ulteriori informazioni» → «Esegui comunque» solo dopo aver verificato l'hash. Anche un binario appena firmato può ricevere l'avviso finché non acquisisce reputazione. Linux è distribuito senza firma.

Ogni release pubblica `SHA256SUMS.txt`. Per verificare un download: `shasum -a 256 -c SHA256SUMS.txt` su macOS/Linux nella cartella dei file, oppure `certutil -hashfile <file> SHA256` su Windows confrontando il valore con la riga corrispondente. Processo completo, nomi dei secret e passi manuali in [docs/releases/firma.md](./docs/releases/firma.md); decisione in [ADR 0002](./docs/adr/0002-firma-e-licenza.md).

## Sito

La landing page in `site/` (italiano e inglese) è pubblicata su GitHub Pages: <https://francemazzi.github.io/octo_core/>. Il bottone di download riconosce sistema e architettura del visitatore e legge la versione da `site/releases.json`, rigenerato dal workflow `pages.yml` a ogni release (incatenato a `release.yml`) o a ogni push su `site/`. Gli screenshot in `site/assets/` vengono dall'app reale su sessioni sintetiche: `pnpm site:screenshots` li rigenera, `pnpm site:check` verifica pagina e versioni, `pnpm site:preview` serve il sito in locale.
