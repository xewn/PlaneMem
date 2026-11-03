// Internal v1 schema shared by ordinary initialization and fresh-file backup restoration.
export const PROPOSAL_QUEUE_CORE_SCHEMA = `CREATE TABLE IF NOT EXISTS proposal_queue_binding (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1), schema_version INTEGER NOT NULL, binding TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS proposal_jobs (
  job_id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sending','retry','blocked','submitted')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_ms INTEGER NOT NULL,
  uncertain INTEGER NOT NULL DEFAULT 0, error_code TEXT, trace_id TEXT, receipt TEXT,
  created_at TEXT NOT NULL, lease_token TEXT, lease_until_ms INTEGER);
  CREATE INDEX IF NOT EXISTS proposal_jobs_due ON proposal_jobs(status, next_attempt_ms);`;
export const PROPOSAL_QUEUE_GENERATION_SCHEMA = `CREATE TABLE proposal_generation_records (
  job_id TEXT NOT NULL, record_sha256 TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  record_json TEXT NOT NULL, attached_at TEXT NOT NULL,
  PRIMARY KEY (job_id, record_sha256),
  FOREIGN KEY (job_id) REFERENCES proposal_jobs(job_id))`;
export const PROPOSAL_QUEUE_JOB_COLUMNS = [
  'job_id',
  'request_key',
  'payload',
  'payload_hash',
  'status',
  'attempts',
  'next_attempt_ms',
  'uncertain',
  'error_code',
  'trace_id',
  'receipt',
  'created_at',
  'lease_token',
  'lease_until_ms',
] as const;
export const PROPOSAL_QUEUE_GENERATION_COLUMNS = [
  'job_id',
  'record_sha256',
  'schema_version',
  'record_json',
  'attached_at',
] as const;
