# Metadati in chiaro

Il payload dei frame è cifrato (AES-256-GCM). Restano in chiaro, perché servono a interrogare e a cancellare senza decifrare tutto:

- id di sessione, sorgente, evidenza e asset
- intervalli temporali e stato (`valid`, `partial`, `revoked`)
- hash del contenuto cifrato
- `kid` di ogni envelope: le prime 16 cifre esadecimali dello SHA-256 della chiave dei media, per riconoscere una chiave diversa senza rivelarla
- path del file dentro il data dir
- esito dei job e testo delle domande già formulate dall'applicazione
- titolo della sessione, nome e riassunto di ogni attività scritti dal modello: derivano dal testo dello schermo già mascherato e servono alla barra laterale

Non finiscono nel log i pixel né il marker sintetico `SYNTHETIC_SECRET_MARKER`. Il report DOCX esportato è volutamente leggibile.
