export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  harness TEXT NOT NULL,
  folder TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  native_session TEXT,
  last_heartbeat INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  repo_root TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','paused','closed')),
  message_cap INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','question','proposal','file_ref','handoff','request')),
  body TEXT NOT NULL,
  payload_json TEXT,
  reply_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent','delivered','read','replied','failed')),
  error_code TEXT,
  sent_at INTEGER NOT NULL,
  delivered_at INTEGER,
  read_at INTEGER,
  replied_at INTEGER,
  failed_at INTEGER,
  expires_at INTEGER NOT NULL,
  delivered_session TEXT,
  idempotency_key TEXT NOT NULL,
  est_tokens INTEGER NOT NULL,
  UNIQUE(from_agent, idempotency_key)
);

CREATE TABLE IF NOT EXISTS message_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  event TEXT NOT NULL,
  at INTEGER NOT NULL,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS agreements (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  repo_root TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('offered','accepted','countered','rejected','vetoed')),
  offered_by TEXT NOT NULL,
  answered_by TEXT,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  repo_root TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  path_glob TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER
);

CREATE TABLE IF NOT EXISTS edits (
  id TEXT PRIMARY KEY,
  repo_root TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  path TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_status
  ON messages(to_agent, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON messages(thread_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_claims_repo
  ON claims(repo_root, released_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_edits_repo_path_at
  ON edits(repo_root, path, at);
CREATE INDEX IF NOT EXISTS idx_agents_repo
  ON agents(repo_root, last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_agreements_repo
  ON agreements(repo_root, created_at);
`,
  },
];
