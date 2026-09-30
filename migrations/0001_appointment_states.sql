CREATE TABLE IF NOT EXISTS appointment_states (
  request_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('processing', 'submitted', 'failed')),
  record_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_appointment_states_updated_at ON appointment_states(updated_at);
