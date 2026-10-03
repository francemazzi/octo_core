# Modalità dati

`local_only` è il default: nessuna evidenza va a un modello remoto. Se Ollama risponde su localhost, l'analisi usa quel modello. Se è spento, non parte nessuna chiamata.

| Modalità | Cosa può lasciare il PC | Cosa resta locale |
| --- | --- | --- |
| `local_only` | Niente verso modelli remoti. Ollama, se acceso, resta su localhost. | Acquisizione, cifratura, revisione, export. |
| `cloud_after_review` | Solo evidenze con revisione `approved`, nel perimetro della sessione. | Bozze, tratti `unknown`, evidenze revocate. |
| `cloud_live_authorized` | Evidenze della sessione autorizzata, durante la registrazione. | Sorgenti non selezionate, altre sessioni, tool di sistema. |

Il modello non riceve shell, filesystem né rete propri. Un testo catturato che chiede di cambiare policy non cambia modalità né scope. Senza rete, i job remoti restano in coda.
