-- 0025: Comms & integrations (M22). A per-workspace Slack incoming-webhook
-- integration: when configured, StackUp posts human-readable notifications for
-- the selected event types to the workspace's Slack channel. (Email delivery
-- is pluggable at the app layer via an EmailProvider seam and needs no schema.)

CREATE TABLE slack_integrations (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  webhook_url  text NOT NULL,
  events       jsonb NOT NULL DEFAULT '["*"]'::jsonb,
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users (id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY slack_integrations_tenant ON slack_integrations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON slack_integrations TO stackup_app;
