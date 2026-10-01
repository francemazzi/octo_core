# Claude Code — Octo Core

Usa questo file come contesto operativo nel repository. Allineato a [AGENTS.md](./AGENTS.md) e alle regole in `.cursor/rules/`.

## Contesto prodotto

Octo Core documenta sessioni di lavoro autorizzate (Windows-first MVP), con engine Node separato da Electron, SQLite, cattura via `CaptureAdapter`, analisi via `ModelAdapter` + LangGraph, export DOCX. Stato attuale e fasi: [roadmap.md](./roadmap.md).

## Workflow per ogni task

```text
Leggi roadmap (fase Axx) → cerca codice esistente → cambio minimo
→ test integrazione fase (moduli reali) → lint/typecheck/unit → pnpm gate Axx
→ note su B/C pending se rilevante
```

Rispondi in **italiano** all’utente se richiesto dalle user rules del progetto; **codice e identificatori in inglese**.

## Clean code (vincoli)

- **~300 righe** per file sorgente: soglia indicativa; spezzare o giustificare se superata.
- **Niente duplicazione funzionale**: grep prima di aggiungere funzioni; riusa `packages/` e domain del engine.
- Funzioni coese, nomi chiari, TS strict, niente catch vuoti.
- Rispetta invarianti roadmap §6 (tempo = unione intervalli, evidenze prima delle conclusioni, ecc.).

## Gate di integrazione

- Chiudi una fase **solo** con il test nominato in roadmap (es. `A05.synthetic-capture-time.test.ts`) e `pnpm gate A05` verde.
- Test **logico**: verifica comportamento end-to-end della fase, non mock dell’intero stack.
- Nessun `it.skip` / `test.skip` nelle suite gate.
- Prima chiusura: crea/aggiorna `docs/testing/Axx.md`.

| Non confondere | |
| --- | --- |
| Binario A | macOS/CI, deterministico, `gate:all` |
| Binario B | Windows reale, modello live — può restare `pending` |
| Binario C | pilot/legale — solo `gate:release` |

## Comandi utili (quando A01+ esiste)

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm gate Axx
pnpm gate:all
```

## Git

- Non fare commit/push salvo richiesta esplicita.
- Conventional commits; no segreti in repo.

## Riferimenti rapidi

- Mappa integrazione A00–A12: roadmap §3 e [.cursor/rules/integration-gates.mdc](./.cursor/rules/integration-gates.mdc)
- Clean code: [.cursor/rules/clean-code.mdc](./.cursor/rules/clean-code.mdc)
- Istruzioni Codex/altri agenti: [AGENTS.md](./AGENTS.md)
