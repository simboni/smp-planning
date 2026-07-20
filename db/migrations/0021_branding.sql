-- 0021: Branding — let admins edit a workspace's display name, accent color
-- and logo. Creation still goes only through the SECURITY DEFINER provisioning
-- function; this grants the runtime role a narrow, column-scoped UPDATE so the
-- API's admin-guarded PATCH can change presentation fields. The workspace_self
-- RLS policy already confines the UPDATE to the caller's current workspace row.

GRANT UPDATE (name, color, avatar_url) ON workspaces TO stackup_app;
