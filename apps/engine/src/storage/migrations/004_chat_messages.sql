-- Session assistant: one row per message, user or assistant, with what the reply cited.
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  prompt_schema TEXT,
  data_mode TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages(session_id, created_at);

-- What the operator declared about an activity when answering a question: a statement, not evidence.
ALTER TABLE episodes ADD COLUMN operator_note TEXT;
