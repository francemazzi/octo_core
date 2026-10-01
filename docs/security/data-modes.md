# Modalità dati

`local_only` è il default. Non significa che un modello locale sia in esecuzione: nell'MVP non c'è un modello on-device. Significa che nessuna evidenza esce dal PC.

| Modalità | Cosa può lasciare il PC | Cosa resta locale |
| --- | --- | --- |
| `local_only` | Niente. Nessuna chiamata di rete verso modelli. | Acquisizione, cifratura, revisione, export. |
| `cloud_after_review` | Solo evidenze con revisione `approved`, nel perimetro della sessione. | Bozze, tratti `unknown`, evidenze revocate. |
| `cloud_live_authorized` | Evidenze della sessione autorizzata, durante la registrazione. | Sorgenti non selezionate, altre sessioni, tool di sistema. |

Il modello non riceve shell, filesystem né rete propri. Un testo catturato che chiede di cambiare policy non cambia modalità né scope. Senza rete, i job remoti restano in coda.
