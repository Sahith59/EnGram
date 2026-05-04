-- Phase 13 (F-13): Dormant project detection & archiving
-- Adds is_archived flag to projects so archived projects are excluded from
-- routing, brief generation, and the default projects list view.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS projects_is_archived_idx ON projects (is_archived);

-- Make sure RLS doesn't block the archive flag update (project owners/admins)
-- The existing project policies already cover UPDATE, so no new policies needed.
