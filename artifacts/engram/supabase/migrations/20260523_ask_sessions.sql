-- Migration: create ask_sessions table for Ask ENGRAM persistent chat sessions
-- Run this in Supabase → SQL Editor once.

CREATE TABLE IF NOT EXISTS public.ask_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL DEFAULT 'New conversation',
  messages    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  scope       TEXT        NOT NULL DEFAULT 'personal',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ask_sessions_user_updated_idx
  ON public.ask_sessions (user_id, updated_at DESC);

ALTER TABLE public.ask_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ask_sessions'
      AND policyname = 'Users manage own sessions'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users manage own sessions"
        ON public.ask_sessions
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id)
    $policy$;
  END IF;
END $$;
