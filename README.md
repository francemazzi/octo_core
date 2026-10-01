# Octo Core

[Repository GitHub](https://github.com/francemazzi/octo_core) · [Roadmap di sviluppo](./roadmap.md)

**Dal lavoro osservato a un processo documentato. Prima di automatizzare.**

Octo Core è un progetto di app desktop Windows-first per documentare come si svolge il lavoro tra email, documenti, fogli di calcolo e gestionali. Una mascotte visibile accompagna sessioni di registrazione autorizzate, pone poche domande contestuali e aiuta a trasformare le evidenze raccolte in attività strutturate, screenshot, brevi video e report DOCX.

L'obiettivo è capire **dove viene impiegato tempo, quali passaggi si ripetono e quali miglioramenti meritano una verifica**, senza confondere l'attività sul computer con la produttività della persona.

> **Stato: progettazione dell'MVP.** Il repository contiene la documentazione iniziale; l'applicazione, l'installer e le funzionalità descritte non sono ancora implementati. L'implementazione segue la [roadmap](./roadmap.md) (fasi **A00–A12**, binario automatico).

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
| **Registra** | Avvia la sessione. La mascotte nell'angolo dello schermo mostra lo stato e rende disponibili pausa, arresto e note. |
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
| **Persistenza** | SQLite; media cifrati (AES-GCM, `KeyProvider`; in produzione chiavi avvolte con `safeStorage`) |
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

Ogni fase **A00–A12** si chiude solo quando passa `pnpm gate Axx`, cioè un **test di integrazione deterministico** nominato in roadmap (più i test unitari della fase). Il dettaglio è in [roadmap.md § Contratto del test di integrazione](./roadmap.md#3-contratto-del-test-di-integrazione).

| Milestone | Fasi A | Risultato dimostrabile (automatico) |
| --- | --- | --- |
| **M0 — Flusso sintetico** | A00–A05 | Fixture oracolo, archivio, tempo e evidenze da cattura sintetica |
| **M1 — Intelligenza e export** | A06–A09 | Episodi, policy AI mock, revisione, DOCX e cartelle |
| **M2 — Desktop e hardening** | A10–A12 | Shell Electron, video/porta cattura, fault simulati |

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
