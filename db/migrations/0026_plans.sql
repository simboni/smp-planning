-- 0026: Pricing plans (M24). Each workspace carries a plan; per-plan resource
-- limits and feature gates are resolved in code (@stackup/shared PLANS) with
-- workspace_limits (0023) still able to override the numbers per workspace.
-- No payment processor yet: the workspace owner switches plans self-serve via
-- an owner-gated endpoint; billing integration slots in front of that later.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'unlimited', 'business', 'enterprise'));

-- The owner-gated plan switch runs as the app role.
GRANT UPDATE (plan) ON workspaces TO stackup_app;
