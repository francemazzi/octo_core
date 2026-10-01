# ADR 0001 — Versioni pin e SQLite

## Stato

Accettato in A01.

## Decisione

Monorepo pnpm, TypeScript strict, ESM. Versioni pinate nel lockfile:

- Electron 44.5.1, Electron Forge 8.0.1, Vite 8.3.1
- React 19.3.0
- Vitest 5.0.3, Zod 4.6.5
- LangGraph.js 1.4.18
- docx 9.8.1
- TypeScript 5.9.3 (la 7.0.2 esiste, ma ESLint 10 non la accetta: peer `<6.1.0`)

SQLite è `node:sqlite` del Node 22, unica scelta. Non usiamo `better-sqlite3`. Il checkpointer di LangGraph scrive sulla stessa connessione `node:sqlite` (`NodeSqliteSaver`), perché il saver ufficiale dipende da `better-sqlite3`.

Il motore nei test è un processo Node avviato con `tsx`. Il package Windows di sviluppo non è firmato; l'hash sta in `dist-win/build-hash.txt`. Cattura reale, `safeStorage` e OpenRouter restano binario B.

`apps/engine/src/create-engine.ts` supera le ~300 righe: è la facciata unica che chiude su database, chiavi e clock. Spezzarla duplica quel contesto; i comportamenti stanno nei moduli sotto `domain/`, `storage/`, `analysis/`, `reports/`.
