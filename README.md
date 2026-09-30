# Octo Core

[Repository GitHub](https://github.com/francemazzi/octo_core) · [Roadmap di sviluppo](./roadmap.md)

**Dal lavoro osservato a un processo documentato. Prima di automatizzare.**

Octo Core è un progetto di app desktop Windows-first per documentare come si svolge il lavoro tra email, documenti, fogli di calcolo e gestionali. Una mascotte visibile accompagna sessioni di registrazione autorizzate, pone poche domande contestuali e aiuta a trasformare le evidenze raccolte in attività strutturate, screenshot, brevi video e report DOCX.

L'obiettivo è capire **dove viene impiegato tempo, quali passaggi si ripetono e quali miglioramenti meritano una verifica**, senza confondere l'attività sul computer con la produttività della persona.

> **Stato: progettazione dell'MVP.** Il repository contiene la documentazione iniziale; l'applicazione, l'installer e le funzionalità descritte non sono ancora implementati. Questa pagina presenta il prodotto previsto. Attività, dipendenze, test e criteri di completamento sono definiti nella [roadmap](./roadmap.md).

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

Esempio di esportazione prevista, non di file già disponibili:

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

## Architettura prevista

| Componente | Scelta |
| --- | --- |
| **Desktop e interfaccia** | Electron + React + TypeScript; dashboard e mascotte separate |
| **Acquisizione** | Adattatore Electron per monitor e finestre; renderer dedicato alla cattura |
| **Motore locale** | Node.js/TypeScript in un processo separato, con IPC tipizzata |
| **Contratti** | Zod e tipi condivisi tra interfaccia e motore |
| **Persistenza** | SQLite, migrazioni SQL e archivio locale cifrato per i media |
| **Analisi** | LangGraph.js, checkpoint persistenti e adapter OpenRouter |
| **Report** | Libreria TypeScript `docx`, a partire da dati strutturati e validati |
| **Verifiche e distribuzione** | Vitest, test di integrazione, replay, prove su Windows reale ed Electron Forge |

Fastify sarà introdotto soltanto se servirà un client HTTP concreto. L'MVP non richiede un server remoto, PostgreSQL, Redis o un database a grafo. Un eventuale componente nativo Windows verrà valutato sulla base dei limiti emersi nei test.

Struttura del codice prevista:

```text
apps/
  desktop/          # Electron, dashboard, mascotte e acquisizione
  engine/           # Dominio, job, analisi, archivio e report
packages/
  contracts/        # Schemi e messaggi condivisi
  capture-adapter/  # Interfaccia sostituibile di acquisizione
  test-fixtures/    # Dati sintetici e sessioni annotate
native/
  windows-context/  # Opzionale, solo se giustificato dalle prove
docs/               # Decisioni, sicurezza, test e pilot
tests/              # Integrazione, replay, desktop e valutazioni AI
scripts/
  gates/            # Verifiche di completamento delle fasi
```

## Dati locali e analisi AI

La registrazione locale e l'invio ai modelli sono due operazioni distinte. Le modalità previste sono:

| Modalità | Comportamento |
| --- | --- |
| `local_only` | Predefinita: acquisizione e revisione locale, senza inviare evidenze ai modelli remoti. Non implica la presenza di un modello AI locale. |
| `cloud_after_review` | Analisi remota soltanto delle evidenze approvate dopo la revisione. |
| `cloud_live_authorized` | Analisi remota durante la sessione, nel perimetro autorizzato, per abilitare anche domande contestuali. |

OpenRouter sarà configurato con modelli e provider ammessi. Un errore o un endpoint non disponibile non dovrà attivare un invio alternativo non autorizzato. Senza rete, i job remoti resteranno in coda e lo stato sarà visibile.

## Principi non negoziabili

- **Controllo dell'utente.** Avvio esplicito, sorgenti selezionate, stato visibile e possibilità di sospendere la registrazione.
- **Evidenze prima delle conclusioni.** Nessuna attività confermata soltanto dal modello; correzioni e versioni devono restare tracciabili.
- **Tempi misurati in codice.** Due monitor non raddoppiano il tempo. Inattività, attesa, interruzione e lavoro evitabile sono concetti distinti.
- **Minimizzazione e sicurezza.** Maschere prima del salvataggio o dell'invio, accessi limitati, retention e cancellazione dei derivati. Nessun dato aziendale, segreto o media reale in Git e negli artefatti CI.
- **Separazione tra osservazione e azione.** Il modello interpreta contenuti non affidabili; non riceve strumenti per eseguire comandi o modificare i sistemi osservati.

Questi sono requisiti da implementare e verificare, non certificazioni già ottenute. Prima di qualsiasi pilot con dati aziendali reali è prevista una verifica del perimetro tecnico, organizzativo e giuridico. La prima demo utilizzerà esclusivamente dati sintetici.

## Perimetro dell'MVP

**Target iniziale:** Windows 11 x64, un operatore, uno o due monitor e sessioni dimostrative di 60–90 minuti. Il supporto dovrà essere verificato su un PC rappresentativo del cliente.

L'acquisizione riguarda il contenuto visibile delle sorgenti autorizzate: non comporta accesso a finestre mai aperte, database, schermate sicure o contenuti protetti.

**Fuori perimetro:** automazione autonoma del PC, scrittura nei gestionali, keylogging, clipboard, audio, webcam, registrazione nascosta, classifiche dei dipendenti, training sui dati dei clienti e backend multi-tenant. macOS, Linux, Citrix e Remote Desktop non sono obiettivi di compatibilità garantita per questo MVP.

## Sviluppo e verifica

La [roadmap](./roadmap.md) è il riferimento operativo. Ogni checkbox ha un identificativo e una verifica; una fase si conclude soltanto quando passa il relativo gate e sono disponibili le evidenze richieste.

I test deterministici non devono richiedere rete o chiamate a pagamento. Le prove con modelli reali e con un desktop Windows interattivo sono verifiche separate: un mock non dimostra che la cattura o l'analisi reale funzionino.

Non sono ancora disponibili comandi di avvio, build o installazione dell'app. Verranno documentati quando il relativo codice sarà presente e verificato.

**Primo traguardo:** ricostruire una sessione reale di prova con poche correzioni, tempi riconciliati e un DOCX dal quale sia possibile capire quale problema approfondire. Registrare più ore, da solo, non dimostra il valore del prodotto.
