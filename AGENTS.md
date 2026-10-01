# Istruzioni per agenti (Codex e altri)

Repository: **Octo Core** — app desktop Windows-first, monorepo pnpm + TypeScript strict, motore Node figlio, gate per fase A00–A12. Leggi [README.md](./README.md) e [roadmap.md](./roadmap.md) prima di implementare.

Regole Cursor equivalenti: [.cursor/rules/clean-code.mdc](./.cursor/rules/clean-code.mdc), [.cursor/rules/integration-gates.mdc](./.cursor/rules/integration-gates.mdc).

## Flusso obbligatorio

1. **Ispeziona** — scope della richiesta vs fase A corrente; decisioni congelate in roadmap § Decisioni congelate; ADR in `docs/adr/` se devi pinare versioni (A01+).
2. **Implementa il minimo** — diff piccolo; nessuna feature fuori MVP; codice in **inglese**, messaggi utente/export path come da roadmap.
3. **Verifica duplicazioni** — cerca funzioni/moduli esistenti; non ripetere logica (tempo, crypto, policy AI, export).
4. **Testa** — unit pertinenti; **test di integrazione della fase** che attraversa moduli reali; `pnpm gate Axx` quando l’infrastruttura esiste (da A01).
5. **Documenta limiti** — cosa resta `pending` su binario B/C; aggiorna `docs/testing/Axx.md` alla prima chiusura della fase.

Non dichiarare una fase completata senza gate verde. Non usare skip nei test gate.

## Clean code

| Regola | Dettaglio |
| --- | --- |
| Duplicazione | Zero funzioni equivalenti con nomi diversi; estrarre solo concetti condivisi reali. |
| Dimensione file | **~300 righe** target indicativo per sorgente; oltre → refactor o motivazione esplicita. |
| Architettura | Renderer senza DB/chiavi/filesystem diretti; engine testabile senza Electron; contratti in `packages/contracts`. |
| Strictness | TypeScript strict, Zod ai confini, errori con contesto. |

## Integrazione per fase (Binario A)

Ogni fase Axx ha **un** file sotto `tests/integration/` (tabella in roadmap §3). Il test deve:

- usare fixture in `packages/test-fixtures/` dove previsto (A00 oracolo);
- fake solo ai bordi: cattura sintetica, rete, keystore, encoder;
- assert su invarianti di dominio (tempo = unione intervalli, zero rete in `local_only`, path export, ecc.).

Comandi (da A01): `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm gate Axx`, `pnpm gate:all`.

**Binario B/C** non bloccano A; `pnpm gate:release` è per pilot, non per ogni PR.

## Commit e sicurezza

- Conventional commits; riferimento issue se applicabile.
- Nessun dato aziendale, segreto, media reale o chiavi in Git/CI.
- Non committare salvo richiesta esplicita dell’utente.

## Cosa evitare

- Microservizi, Redis, backend obbligatorio per MVP.
- Tool shell/file/rete al `ModelAdapter`.
- Dichiarare Windows live o modello live verificati solo con test su macOS/mock.
- Over-engineering: helper one-liner, astrazioni per un solo call site.
