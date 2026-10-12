# B06 — Smoke Anthropic

## 2026-10-12 (sera)

- Stato: **verde**, prova live completata.
- Revisione: working tree della 1.2.0 su `3bf590d`, non committato; Node v22.23.1, macOS arm64.
- Comando: `pnpm test:anthropic`, chiave letta da `.env` ed esportata solo nell'ambiente del processo. Nessuna chiave in file versionati, log o documenti. Nessun workspace richiesto da questa chiave.
- Scenario: un ordine sintetico, evidenza approvata, motore reale, Messages API con modello predefinito `claude-sonnet-5-5`, limite di 800 token di risposta.
- Esito analisi: `accepted`, 1 attività riconosciuta, riga `analysis_runs` con provider `anthropic` e `total_tokens` > 0.
- Esito assistente (`chat@1`, modalità `cloud_after_review`): risposta `accepted`, `verified=true`, citazioni `ev-order` ("Schermata +00:00") e l'attività "Inserimento ordine 123 nell'ERP"; input del run limitato a `["ev-order"]`; due audit `network` (analisi e chat); usage registrato.
- Non verificati: qualità delle risposte su sessioni lunghe e il consenso remoto dal pannello desktop con un provider reale.

## 2026-10-12

- Stato: **pending**, prova live tentata ma non completata.
- Revisione: working tree su `5dd0987`, non committato; Node v22.23.1, macOS arm64.
- Comando: `pnpm test:anthropic`, chiave fornita nell’ambiente del solo processo. Nessuna chiave salvata nel repository o nei documenti.
- Scenario: un ordine sintetico, evidenza approvata, motore reale, chiamata Messages API; limite di 800 token di risposta e un solo eventuale retry.
- Esito osservato: HTTP 400. Un controllo successivo su Models API ha chiarito che la chiave non è associata a un workspace e richiede l’header `anthropic-workspace-id`.
- Tentativo di individuare il workspace tramite List Workspaces: HTTP 403, permessi insufficienti. ID workspace richiesto all’operatore.
- Implementato il supporto `ANTHROPIC_WORKSPACE_ID` e campo facoltativo nelle impostazioni; verificato sinteticamente nei gate A06/A10. Per ripetere la prova live, fornire la chiave e il workspace nell’ambiente, senza scriverli in file versionati.
- Modello live, token di una risposta riuscita e qualità dell’analisi restano **non verificati**. I gate automatici verdi non chiudono questa prova.

Riferimenti: [autenticazione Anthropic](https://platform.claude.com/docs/en/manage-claude/authentication), [List Workspaces](https://platform.claude.com/docs/en/api/organization/workspaces/list).
