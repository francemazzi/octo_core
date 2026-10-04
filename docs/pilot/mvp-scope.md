# Perimetro MVP

## Persona

Un operatore di ufficio in una PMI manifatturiera. Lavora da solo, su Windows 11, con uno o due monitor. Non è un amministratore di sistema e non configura integrazioni.

## Processo demo

Inserimento di un ordine a partire da documenti, con un'interruzione (altra attività), il ritorno sull'ordine, una ricerca codice, un'attesa dichiarata e un tratto non classificato. Durata dimostrativa 60–90 minuti. Dati solo fittizi.

## Sistema

- OS target: Windows 11 x64. Sviluppo e gate automatici su macOS / CI.
- Monitor: uno o due. Se due monitor non sono stabili, la capability resta `single_monitor`.
- Avvio esplicito. Nessuna registrazione prima della scelta dello schermo e del comando Avvia.

## Dati

Pseudonimo operatore, schermi autorizzati, screenshot minimizzati, clip brevi, tempi e risposte alle poche domande. Nessun audio, webcam, clipboard, keylogging, né dati aziendali nel repository.

## Deliverable

Cartelle per attività, screenshot, clip quando esistono, e `report/riepilogo-sessione.docx`. I tratti senza classificazione finiscono in `da-verificare/`.

## Incluso

Registrazione locale, analisi opzionale, revisione umana, export, stime economiche solo se gli input ci sono.

## Escluso

Controllo autonomo del PC, scrittura nei gestionali, email, registrazione nascosta, classifiche, emozioni, training sui dati dei clienti, cloud multi-tenant, login SaaS, più operatori, macOS/Linux/Citrix/Remote Desktop come target garantiti.

## Interazione

Pochi comandi, come un'app di sistema:

- Un'azione primaria: Avvia, solo dopo la scelta esplicita dello schermo.
- La mascotte è solo il logo, in alto a destra dello schermo principale e sempre visibile: un puntino rosso (registra) o giallo (pausa), un badge per le domande. Al passaggio del mouse espone solo Pausa/Riprendi e Stop; un clic apre Octo.
- Al massimo tre domande al giorno, una alla volta, rinviabili.
- In revisione: conferma, dividi, unisci.
- Export: un riepilogo.

La mascotte usa `logo_octo.png`. Nessuna seconda palette oltre ai colori di quel logo, salvo i puntini di stato rosso e giallo.
