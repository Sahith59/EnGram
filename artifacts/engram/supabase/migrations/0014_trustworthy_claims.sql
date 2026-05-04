-- Phase 12: Trustworthy Brief Generation
-- Introduces structured, attributable claims extracted from each capture.
-- Every claim traces to its source snapshot. No fabrication is possible
-- because claims are grounded in real captured conversations.

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE claim_type AS ENUM (
    'decision',     -- A concrete choice made (e.g., "chose PostgreSQL over MongoDB")
    'constraint',   -- A hard limit or non-goal ("must stay under $100/month")
    'next_step',    -- A planned action item or immediate TODO
    'technology',   -- A tool/framework/library actively in use
    'dead_end',     -- Something tried and explicitly abandoned
    'observation'   -- A factual statement about current state
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM (
    'active',       -- Current, believed to be accurate
    'superseded',   -- Replaced by a newer decision (kept for history)
    'abandoned',    -- Marked as dead end / no longer relevant
    'conflicted'    -- Contradicts another active claim — needs human resolution
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── project_claims ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_claims (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  snapshot_id         uuid NOT NULL REFERENCES public.context_snapshots(id) ON DELETE CASCADE,
  team_id             uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

  claim_text          text NOT NULL,
  claim_type          claim_type NOT NULL DEFAULT 'observation',
  status              claim_status NOT NULL DEFAULT 'active',

  -- Trustworthiness metrics
  confidence_score    numeric(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence_score BETWEEN 0 AND 1),
  reinforcement_count integer NOT NULL DEFAULT 1,

  -- Temporal tracking — the foundation of staleness detection
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),

  -- Lineage — when a claim is superseded, this points to its replacement
  superseded_by       uuid REFERENCES public.project_claims(id),

  -- Embedding for contradiction detection
  embedding           vector(1536),

  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── claim_conflicts ──────────────────────────────────────────────────────────
-- Detected contradictions between active claims. Each row represents one
-- conflict pair that needs human resolution before injection.

CREATE TABLE IF NOT EXISTS public.claim_conflicts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  claim_a_id       uuid NOT NULL REFERENCES public.project_claims(id) ON DELETE CASCADE,
  claim_b_id       uuid NOT NULL REFERENCES public.project_claims(id) ON DELETE CASCADE,
  resolved         boolean NOT NULL DEFAULT false,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES auth.users(id),
  winner_claim_id  uuid REFERENCES public.project_claims(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate conflict pairs (A,B) and (B,A)
  CONSTRAINT no_duplicate_conflicts UNIQUE (claim_a_id, claim_b_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS project_claims_project_id_idx
  ON public.project_claims(project_id);
CREATE INDEX IF NOT EXISTS project_claims_snapshot_id_idx
  ON public.project_claims(snapshot_id);
CREATE INDEX IF NOT EXISTS project_claims_team_id_idx
  ON public.project_claims(team_id);
CREATE INDEX IF NOT EXISTS project_claims_status_idx
  ON public.project_claims(status);
CREATE INDEX IF NOT EXISTS project_claims_type_status_idx
  ON public.project_claims(claim_type, status);
CREATE INDEX IF NOT EXISTS project_claims_last_seen_idx
  ON public.project_claims(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS claim_conflicts_project_id_idx
  ON public.claim_conflicts(project_id);
CREATE INDEX IF NOT EXISTS claim_conflicts_resolved_idx
  ON public.claim_conflicts(resolved);
CREATE INDEX IF NOT EXISTS claim_conflicts_claim_a_idx
  ON public.claim_conflicts(claim_a_id);
CREATE INDEX IF NOT EXISTS claim_conflicts_claim_b_idx
  ON public.claim_conflicts(claim_b_id);

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.project_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members can read claims"
  ON public.project_claims FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "team members can read conflicts"
  ON public.claim_conflicts FOR SELECT
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.team_members tm ON tm.team_id = p.team_id
      WHERE tm.user_id = auth.uid()
    )
  );

-- ── RPC: vector search for contradiction detection ───────────────────────────

CREATE OR REPLACE FUNCTION find_nearest_claims(
  query_embedding vector(1536),
  project_id_filter uuid,
  match_threshold  float   DEFAULT 0.80,
  match_count      integer DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  claim_text   text,
  claim_type   claim_type,
  status       claim_status,
  similarity   float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    pc.id,
    pc.claim_text,
    pc.claim_type,
    pc.status,
    (1 - (pc.embedding <=> query_embedding))::float AS similarity
  FROM public.project_claims pc
  WHERE pc.project_id = project_id_filter
    AND pc.status = 'active'
    AND pc.embedding IS NOT NULL
    AND (1 - (pc.embedding <=> query_embedding)) > match_threshold
  ORDER BY pc.embedding <=> query_embedding
  LIMIT match_count;
$$;
