CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  collection_policy TEXT NOT NULL,
  taxonomy_json TEXT NOT NULL,
  retention_json TEXT NOT NULL,
  question_limit_per_day INTEGER NOT NULL DEFAULT 3,
  question_cooldown_ms INTEGER NOT NULL DEFAULT 60000,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  operator_pseudonym TEXT NOT NULL,
  started_wall TEXT NOT NULL,
  ended_wall TEXT,
  capture_state TEXT NOT NULL,
  analysis_state TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  data_mode TEXT NOT NULL DEFAULT 'local_only'
);

CREATE INDEX IF NOT EXISTS sessions_project_state ON sessions(project_id, capture_state);

CREATE TABLE IF NOT EXISTS clock_epochs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  process_start_wall TEXT NOT NULL,
  monotonic_origin_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capture_sources (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  dpi_scale REAL NOT NULL,
  authorized INTEGER NOT NULL,
  valid_from_ms INTEGER NOT NULL,
  valid_to_ms INTEGER,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS capture_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  wall_time TEXT NOT NULL,
  offset_ms INTEGER NOT NULL,
  epoch_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS capture_events_session ON capture_events(session_id, sequence);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  asset_id TEXT,
  content_hash TEXT,
  masks_json TEXT NOT NULL,
  availability TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  state TEXT NOT NULL,
  path TEXT NOT NULL,
  byte_length INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_types (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  case_id TEXT,
  objective TEXT NOT NULL,
  review_state TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS episode_intervals (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  assignment TEXT NOT NULL,
  origin TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS episode_intervals_episode ON episode_intervals(episode_id);

CREATE TABLE IF NOT EXISTS episode_revisions (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  asked_at_ms INTEGER NOT NULL,
  origin TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_schema TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  usage_json TEXT NOT NULL,
  data_mode TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  problem TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  alternative TEXT NOT NULL,
  economics_json TEXT NOT NULL,
  missing_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report_versions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  author TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, version)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  lease_owner TEXT,
  lease_until_ms INTEGER,
  run_after_ms INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, run_after_ms);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  wall_time TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tombstones (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  evidence_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT,
  note TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE TABLE IF NOT EXISTS protected_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  approved INTEGER NOT NULL
);
