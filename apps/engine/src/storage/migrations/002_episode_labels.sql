-- Names and summaries written by the model, shown in the sessions sidebar.
ALTER TABLE sessions ADD COLUMN title TEXT;
ALTER TABLE episodes ADD COLUMN label TEXT;
ALTER TABLE episodes ADD COLUMN summary TEXT;

CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_wall);
CREATE INDEX IF NOT EXISTS episodes_session ON episodes(session_id);
CREATE INDEX IF NOT EXISTS questions_session_status ON questions(session_id, status);
