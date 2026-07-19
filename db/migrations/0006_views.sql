-- 0006: Views Engine — saved views on Lists.
--
-- A view is a named lens on a List's tasks: its kind (list/board/calendar/
-- table/gantt) plus a jsonb config carrying filters, sort, grouping and
-- per-kind options. Default views are implicit (every list always offers all
-- kinds); rows here store user-customized/saved configurations. Personal
-- views (created_by, is_shared=false) are visible only to their creator;
-- shared views to everyone who can see the list.

CREATE TABLE views (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  list_id      uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('list', 'board', 'calendar', 'table', 'gantt')),
  -- {filters:{statusIds?,assigneeIds?,priorities?,tagIds?,dueFrom?,dueTo?,
  --  includeDone?}, sort:{key,dir}, groupBy:'status'|'assignee'|'priority'|'tag'|null,
  --  columns?:[...]} — API validates loosely, client owns semantics.
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared    boolean NOT NULL DEFAULT true,
  position     int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX views_list_idx ON views (workspace_id, list_id, position);

ALTER TABLE views ENABLE ROW LEVEL SECURITY;
ALTER TABLE views FORCE ROW LEVEL SECURITY;
CREATE POLICY views_tenant ON views
  USING (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON views TO stackup_app;
