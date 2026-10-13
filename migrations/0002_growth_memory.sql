CREATE TABLE IF NOT EXISTS public.stg_jieyou_v19_growth_events (
  _id TEXT PRIMARY KEY,
  growth_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  document JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stg_jieyou_v19_growth_events_growth_id
  ON public.stg_jieyou_v19_growth_events(growth_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stg_jieyou_v19_growth_snapshots (
  _id TEXT PRIMARY KEY,
  growth_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  document JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stg_jieyou_v19_growth_snapshots_growth_id
  ON public.stg_jieyou_v19_growth_snapshots(growth_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stg_jieyou_v19_growth_watches (
  _id TEXT PRIMARY KEY,
  growth_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  document JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stg_jieyou_v19_growth_watches_growth_id
  ON public.stg_jieyou_v19_growth_watches(growth_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stg_jieyou_v19_growth_feedback (
  _id TEXT PRIMARY KEY,
  growth_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  document JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stg_jieyou_v19_growth_feedback_growth_id
  ON public.stg_jieyou_v19_growth_feedback(growth_id, created_at DESC);
