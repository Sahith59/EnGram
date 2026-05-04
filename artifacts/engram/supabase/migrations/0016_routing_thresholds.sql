-- Phase 14 (F-14): Adaptive per-project routing thresholds
-- Tracks routing decision statistics per project to auto-calibrate
-- the similarity threshold used in Tier 2 (semantic) routing.

CREATE TABLE IF NOT EXISTS public.project_routing_stats (
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id              text NOT NULL,
  routing_attempts     int  NOT NULL DEFAULT 0,
  routing_hits         int  NOT NULL DEFAULT 0,
  avg_similarity       float NOT NULL DEFAULT 0.35,
  threshold_override   float NOT NULL DEFAULT 0.35,
  last_calibrated_at   timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_routing_stats_project
  ON public.project_routing_stats (project_id);

-- RLS: service role only (routing stats are internal; managed via admin client)
ALTER TABLE public.project_routing_stats ENABLE ROW LEVEL SECURITY;

-- Allow team members to read their own project stats (for dashboard)
DROP POLICY IF EXISTS "team members can view routing stats" ON public.project_routing_stats;
CREATE POLICY "team members can view routing stats"
  ON public.project_routing_stats FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE team_id = public.my_team_id()
    )
  );
