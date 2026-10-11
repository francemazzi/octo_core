# B06 — Smoke Anthropic

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
