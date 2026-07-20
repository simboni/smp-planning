-- StackUp demo data — paste into the Neon SQL Editor and Run.
-- Creates the "Acme Inc" demo workspace (3 users, 3 spaces, 13 tasks,
-- subtasks, checklists, tags, custom fields, dependency, views, comments,
-- a doc, time entries, a goal, a sprint, a dashboard, chat and a whiteboard)
-- and attaches it to your admin account (misiatipeter@gmail.com).
-- Demo teammate logins:  ada.*@acme.demo / jane.* / mike.*  password: Demo-2026

BEGIN;
SELECT set_config('app.current_workspace', 'b91277e9-7018-42e1-96e5-615aae0058ee', true);
SELECT set_config('app.current_user', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', true);

-- demo users (password: Demo-2026)
INSERT INTO users (id, email, password_hash, full_name, avatar_url, status, created_at) VALUES
  ('ab4fb81e-05ea-433d-b31c-ab60a05c134f', 'ada.104e@acme.demo', '$argon2id$v=19$m=65536,t=3,p=4$u4z3DMmggEN17BQIktvoyg$B79ERZ1e4lLAol56BMk6xn7acV7o/Jx3I1xq9VYT1LQ', 'Ada Lovelace', NULL, 'active', '2026-07-20T19:51:20.215Z'),
  ('e56eb2a1-091b-45e3-9279-0ff8d2804b09', 'jane.104e@acme.demo', '$argon2id$v=19$m=65536,t=3,p=4$ciarmoFJ9uJRjzJ+UHwYkg$KlsvmEzDx3e6pFRtwKukqb/9A9QFWhKKO3YlWNSIe5c', 'Jane Rivera', NULL, 'active', '2026-07-20T19:51:20.313Z'),
  ('a6d83681-cdaf-4674-9cde-da072a12b025', 'mike.104e@acme.demo', '$argon2id$v=19$m=65536,t=3,p=4$3KUtNB2b6niW12zw+2yGTQ$v5X3tRXrXgObyzQBXs+7mRlZGo4ZYbzySguMT8Ozwkw', 'Mike Chen', NULL, 'active', '2026-07-20T19:51:20.411Z')
ON CONFLICT DO NOTHING;

INSERT INTO workspaces (id, name, slug, color, avatar_url, status, created_at) VALUES
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'Acme Inc', 'acme-inc-8693b9', '#7B68EE', NULL, 'active', '2026-07-20T19:51:20.420Z')
ON CONFLICT DO NOTHING;

INSERT INTO memberships (id, workspace_id, user_id, role, status, created_at) VALUES
  ('b8620be5-0632-4ebc-9f50-70c3fc277922', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', 'owner', 'active', '2026-07-20T19:51:20.420Z'),
  ('051c01a1-f484-48ec-a27f-fcd01975a8a3', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'e56eb2a1-091b-45e3-9279-0ff8d2804b09', 'member', 'active', '2026-07-20T19:51:20.438Z'),
  ('14abc949-7c3b-4c57-9c22-f7111b283977', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'a6d83681-cdaf-4674-9cde-da072a12b025', 'admin', 'active', '2026-07-20T19:51:20.446Z')
ON CONFLICT DO NOTHING;

INSERT INTO spaces (id, workspace_id, name, color, icon, is_private, archived, sort_order, created_by, created_at, clickapps) VALUES
  ('63f2f902-5aaa-4516-a8e5-a01001e50e79', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'Product', '#7B68EE', NULL, false, false, 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.456Z', '{"tags":true,"points":true,"sprints":true,"milestones":true,"priorities":true,"customFields":true,"dependencies":true,"timeTracking":true}'::jsonb),
  ('8e389ff5-ad22-4895-ace5-709500e3fc4f', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'Marketing', '#00B8D9', NULL, false, false, 1, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.486Z', '{"tags":true,"points":true,"sprints":true,"milestones":true,"priorities":true,"customFields":true,"dependencies":true,"timeTracking":true}'::jsonb),
  ('5d551d50-aab0-48e9-82fe-6b2c9c864f08', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'Operations', '#36B37E', NULL, false, false, 2, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.494Z', '{"tags":true,"points":true,"sprints":true,"milestones":true,"priorities":true,"customFields":true,"dependencies":true,"timeTracking":true}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO folders (id, workspace_id, space_id, name, archived, sort_order, created_by, created_at) VALUES
  ('b24f2f90-0c3f-4812-9bd1-4d3e3ab88a9e', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'Q3 Roadmap', false, 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.502Z')
ON CONFLICT DO NOTHING;

INSERT INTO lists (id, workspace_id, space_id, folder_id, name, color, archived, sort_order, created_by, created_at) VALUES
  ('c93101e6-356f-45c8-82a7-05682329a973', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'b24f2f90-0c3f-4812-9bd1-4d3e3ab88a9e', 'Mobile App', NULL, false, 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.513Z'),
  ('964f7ce9-9c61-477d-8fb7-b8506da1a902', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'b24f2f90-0c3f-4812-9bd1-4d3e3ab88a9e', 'Website Redesign', NULL, false, 1, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.521Z'),
  ('bd088c0e-d792-4354-9b82-335d0912f85e', 'b91277e9-7018-42e1-96e5-615aae0058ee', '8e389ff5-ad22-4895-ace5-709500e3fc4f', NULL, 'Campaigns', NULL, false, 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.528Z'),
  ('f9cce5ae-d482-4139-b1b1-28a00e631966', 'b91277e9-7018-42e1-96e5-615aae0058ee', '8e389ff5-ad22-4895-ace5-709500e3fc4f', NULL, 'Content Calendar', NULL, false, 1, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.534Z'),
  ('5b106863-fae3-4807-82ca-2641a7908fa3', 'b91277e9-7018-42e1-96e5-615aae0058ee', '5d551d50-aab0-48e9-82fe-6b2c9c864f08', NULL, 'Employee Onboarding', NULL, false, 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.543Z'),
  ('1ad79c10-e201-4d0b-8cfa-cf4d03d0b4db', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Sprint 12', NULL, false, 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.209Z')
ON CONFLICT DO NOTHING;

INSERT INTO statuses (id, workspace_id, space_id, name, color, type, position, created_at) VALUES
  ('8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'To Do', '#8A8F98', 'not_started', 0, '2026-07-20T19:51:20.548Z'),
  ('321f5151-e626-4c28-904b-334c3547082a', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'In Progress', '#7B68EE', 'active', 1, '2026-07-20T19:51:20.548Z'),
  ('d79013d8-032a-4d1d-9a9c-d261f5719cf0', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'Complete', '#22C55E', 'done', 2, '2026-07-20T19:51:20.548Z'),
  ('428bccf9-5856-42b9-8166-49135e2246ab', 'b91277e9-7018-42e1-96e5-615aae0058ee', '8e389ff5-ad22-4895-ace5-709500e3fc4f', 'To Do', '#8A8F98', 'not_started', 0, '2026-07-20T19:51:20.842Z'),
  ('f88de46b-f4bb-449c-be57-e04e325fd2c1', 'b91277e9-7018-42e1-96e5-615aae0058ee', '8e389ff5-ad22-4895-ace5-709500e3fc4f', 'In Progress', '#7B68EE', 'active', 1, '2026-07-20T19:51:20.842Z'),
  ('65267808-cd2b-4d60-ab14-2f5bdd1b0007', 'b91277e9-7018-42e1-96e5-615aae0058ee', '8e389ff5-ad22-4895-ace5-709500e3fc4f', 'Complete', '#22C55E', 'done', 2, '2026-07-20T19:51:20.842Z'),
  ('4c49ce2b-6d5a-473b-896a-10054d550a97', 'b91277e9-7018-42e1-96e5-615aae0058ee', '5d551d50-aab0-48e9-82fe-6b2c9c864f08', 'To Do', '#8A8F98', 'not_started', 0, '2026-07-20T19:51:20.958Z'),
  ('1b15b46a-0c5d-41b8-b36b-b2761dfe419e', 'b91277e9-7018-42e1-96e5-615aae0058ee', '5d551d50-aab0-48e9-82fe-6b2c9c864f08', 'In Progress', '#7B68EE', 'active', 1, '2026-07-20T19:51:20.958Z'),
  ('7c079509-b577-4d63-9f2f-02d2c1b25adc', 'b91277e9-7018-42e1-96e5-615aae0058ee', '5d551d50-aab0-48e9-82fe-6b2c9c864f08', 'Complete', '#22C55E', 'done', 2, '2026-07-20T19:51:20.958Z')
ON CONFLICT DO NOTHING;

INSERT INTO tags (id, workspace_id, space_id, name, color, created_at) VALUES
  ('b2c62fc2-91a3-4c2c-afc9-2afe62214aaa', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'bug', '#EF4444', '2026-07-20T19:51:20.554Z'),
  ('5adca91a-b5e9-464b-968c-c628586c052a', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'feature', '#22C55E', '2026-07-20T19:51:20.562Z'),
  ('5dab2457-743f-40b1-a1e3-211c9376075a', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'urgent', '#F59E0B', '2026-07-20T19:51:20.567Z')
ON CONFLICT DO NOTHING;

INSERT INTO custom_fields (id, workspace_id, space_id, name, type, config, position, created_at) VALUES
  ('8a305759-95be-4599-b0fe-56f31cd9bf7c', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'Effort (pts)', 'number', '{}'::jsonb, 0, '2026-07-20T19:51:20.571Z')
ON CONFLICT DO NOTHING;

INSERT INTO tasks (id, workspace_id, list_id, space_id, parent_task_id, name, description, status_id, priority, start_date, due_date, time_estimate_minutes, position, archived, created_by, completed_at, created_at, updated_at, task_type_id, is_milestone, recurrence, sprint_points) VALUES
  ('b7011c05-dd09-4c63-b646-eb772f6f68ab', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Design new onboarding screens', 'Cut signup from 5 steps to 2. Benchmarked competitors.', '321f5151-e626-4c28-904b-334c3547082a', 'high', NULL, '2026-07-25T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.578Z', '2026-07-20T19:51:20.605Z', NULL, false, NULL, NULL),
  ('24108268-4781-47be-8bbd-ca000d7a2422', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Fix crash on Android 14 launch', 'Null pointer in the splash controller.', '8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', 'urgent', NULL, '2026-07-21T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.648Z', '2026-07-20T19:51:20.648Z', NULL, false, NULL, NULL),
  ('b275e5ed-0fec-458b-ae7a-e8ad99db35af', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Add biometric login', '', '8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', 'normal', NULL, '2026-08-01T19:51:20.071Z', NULL, 1, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.692Z', '2026-07-20T19:51:20.692Z', NULL, false, NULL, NULL),
  ('eda211b0-8566-4a12-aa7f-b4f92b6fa778', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Ship v2.1 to the App Store', 'Release once QA signs off.', '8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', 'high', NULL, '2026-08-07T19:51:20.071Z', NULL, 2, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.721Z', '2026-07-20T19:51:20.721Z', NULL, false, NULL, NULL),
  ('c87eb6a9-103d-4e87-9bf1-1ab08883e9fe', 'b91277e9-7018-42e1-96e5-615aae0058ee', '964f7ce9-9c61-477d-8fb7-b8506da1a902', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Rebuild the pricing page', '', '321f5151-e626-4c28-904b-334c3547082a', 'high', NULL, '2026-07-27T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.743Z', '2026-07-20T19:51:20.754Z', NULL, false, NULL, NULL),
  ('682cf3fe-553e-4817-ac79-dbdc16557443', 'b91277e9-7018-42e1-96e5-615aae0058ee', '964f7ce9-9c61-477d-8fb7-b8506da1a902', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Migrate blog to the new CMS', '', '8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', 'normal', NULL, '2026-08-09T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.778Z', '2026-07-20T19:51:20.778Z', NULL, false, NULL, NULL),
  ('2bcbe9b4-0a84-43b2-9c84-04add8851080', 'b91277e9-7018-42e1-96e5-615aae0058ee', '964f7ce9-9c61-477d-8fb7-b8506da1a902', '63f2f902-5aaa-4516-a8e5-a01001e50e79', NULL, 'Fix broken links audit', '', 'd79013d8-032a-4d1d-9a9c-d261f5719cf0', 'low', NULL, NULL, NULL, 1, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.815Z', '2026-07-20T19:51:20.798Z', '2026-07-20T19:51:20.812Z', NULL, false, NULL, NULL),
  ('f1c7eedf-f63c-4814-aeeb-74a9e8240391', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'bd088c0e-d792-4354-9b82-335d0912f85e', '8e389ff5-ad22-4895-ace5-709500e3fc4f', NULL, 'Q3 product launch campaign', 'Email + social + paid.', '428bccf9-5856-42b9-8166-49135e2246ab', 'high', NULL, '2026-07-29T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.842Z', '2026-07-20T19:51:20.842Z', NULL, false, NULL, NULL),
  ('043d290b-67c6-4b62-b837-b1722cc30348', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'bd088c0e-d792-4354-9b82-335d0912f85e', '8e389ff5-ad22-4895-ace5-709500e3fc4f', NULL, 'Partner webinar with Globex', '', '428bccf9-5856-42b9-8166-49135e2246ab', 'normal', NULL, '2026-08-03T19:51:20.071Z', NULL, 1, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.885Z', '2026-07-20T19:51:20.885Z', NULL, false, NULL, NULL),
  ('1b2e9199-43d4-422b-844d-5b7c4ad3e026', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'f9cce5ae-d482-4139-b1b1-28a00e631966', '8e389ff5-ad22-4895-ace5-709500e3fc4f', NULL, 'Write 4 blog posts for August', '', '428bccf9-5856-42b9-8166-49135e2246ab', 'normal', NULL, '2026-07-30T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.901Z', '2026-07-20T19:51:20.901Z', NULL, false, NULL, NULL),
  ('e6ac68ac-4c68-4f94-a66b-d08b3b05eeef', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'f9cce5ae-d482-4139-b1b1-28a00e631966', '8e389ff5-ad22-4895-ace5-709500e3fc4f', NULL, 'Record product demo video', '', '428bccf9-5856-42b9-8166-49135e2246ab', 'low', NULL, '2026-08-05T19:51:20.071Z', NULL, 1, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.945Z', '2026-07-20T19:51:20.945Z', NULL, false, NULL, NULL),
  ('eefdbb80-e716-46a0-bdf6-be1664ba7801', 'b91277e9-7018-42e1-96e5-615aae0058ee', '5b106863-fae3-4807-82ca-2641a7908fa3', '5d551d50-aab0-48e9-82fe-6b2c9c864f08', NULL, 'Prepare laptop for new hire', '', '1b15b46a-0c5d-41b8-b36b-b2761dfe419e', 'high', NULL, '2026-07-22T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:20.963Z', '2026-07-20T19:51:20.975Z', NULL, false, NULL, NULL),
  ('bc35f4e2-2929-4961-beb5-303a21321973', 'b91277e9-7018-42e1-96e5-615aae0058ee', '5b106863-fae3-4807-82ca-2641a7908fa3', '5d551d50-aab0-48e9-82fe-6b2c9c864f08', NULL, 'Schedule first-week 1:1s', '', '4c49ce2b-6d5a-473b-896a-10054d550a97', 'normal', NULL, '2026-07-23T19:51:20.071Z', NULL, 0, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:21.015Z', '2026-07-20T19:51:21.015Z', NULL, false, NULL, NULL),
  ('2c077c5b-93bb-4a21-aff3-2e34bcd789af', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', 'Wireframe the 2-step flow', '', '8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', NULL, NULL, NULL, NULL, 3, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:21.030Z', '2026-07-20T19:51:21.030Z', NULL, false, NULL, NULL),
  ('a7b679f9-f8ec-4833-a8f1-83802a81a398', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', 'Hi-fi mockups in Figma', '', '8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', NULL, NULL, NULL, NULL, 4, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:21.040Z', '2026-07-20T19:51:21.040Z', NULL, false, NULL, NULL),
  ('d88b4740-d2d1-48bc-866c-207ca1ebabf0', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', '63f2f902-5aaa-4516-a8e5-a01001e50e79', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', 'Dev handoff', '', '8c9220a3-d637-43a9-a9a5-ff69ed7f5e30', NULL, NULL, NULL, NULL, 5, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', NULL, '2026-07-20T19:51:21.051Z', '2026-07-20T19:51:21.051Z', NULL, false, NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO task_assignees (workspace_id, task_id, user_id, created_at) VALUES
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', 'e56eb2a1-091b-45e3-9279-0ff8d2804b09', '2026-07-20T19:51:20.631Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', '24108268-4781-47be-8bbd-ca000d7a2422', 'a6d83681-cdaf-4674-9cde-da072a12b025', '2026-07-20T19:51:20.661Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'c87eb6a9-103d-4e87-9bf1-1ab08883e9fe', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:20.766Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'f1c7eedf-f63c-4814-aeeb-74a9e8240391', 'e56eb2a1-091b-45e3-9279-0ff8d2804b09', '2026-07-20T19:51:20.879Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', '1b2e9199-43d4-422b-844d-5b7c4ad3e026', 'e56eb2a1-091b-45e3-9279-0ff8d2804b09', '2026-07-20T19:51:20.915Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'eefdbb80-e716-46a0-bdf6-be1664ba7801', 'a6d83681-cdaf-4674-9cde-da072a12b025', '2026-07-20T19:51:20.987Z')
ON CONFLICT DO NOTHING;

INSERT INTO task_tags (workspace_id, task_id, tag_id) VALUES
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', '5adca91a-b5e9-464b-968c-c628586c052a'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', '24108268-4781-47be-8bbd-ca000d7a2422', 'b2c62fc2-91a3-4c2c-afc9-2afe62214aaa'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', '24108268-4781-47be-8bbd-ca000d7a2422', '5dab2457-743f-40b1-a1e3-211c9376075a'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'b275e5ed-0fec-458b-ae7a-e8ad99db35af', '5adca91a-b5e9-464b-968c-c628586c052a')
ON CONFLICT DO NOTHING;

INSERT INTO checklists (id, workspace_id, task_id, name, position, created_at) VALUES
  ('0e678468-8a65-40fe-bc0a-b389315e251f', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c87eb6a9-103d-4e87-9bf1-1ab08883e9fe', 'Launch checklist', 0, '2026-07-20T19:51:21.083Z')
ON CONFLICT DO NOTHING;

INSERT INTO checklist_items (id, workspace_id, checklist_id, name, resolved, assignee_user_id, position, created_at) VALUES
  ('4763ff14-510f-4751-ab2f-b08c21fa6a56', 'b91277e9-7018-42e1-96e5-615aae0058ee', '0e678468-8a65-40fe-bc0a-b389315e251f', 'Copy reviewed', false, NULL, 0, '2026-07-20T19:51:21.088Z'),
  ('d8c3c63c-15c6-4900-a9d0-b4bbb7703a49', 'b91277e9-7018-42e1-96e5-615aae0058ee', '0e678468-8a65-40fe-bc0a-b389315e251f', 'A/B test set up', false, NULL, 1, '2026-07-20T19:51:21.093Z'),
  ('ed279145-feab-4b68-a143-9d235e9fc3e7', 'b91277e9-7018-42e1-96e5-615aae0058ee', '0e678468-8a65-40fe-bc0a-b389315e251f', 'Analytics wired', false, NULL, 2, '2026-07-20T19:51:21.097Z')
ON CONFLICT DO NOTHING;

INSERT INTO custom_field_values (workspace_id, task_id, field_id, value, updated_at) VALUES
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', '8a305759-95be-4599-b0fe-56f31cd9bf7c', '{"number":8}'::jsonb, '2026-07-20T19:51:20.643Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', '24108268-4781-47be-8bbd-ca000d7a2422', '8a305759-95be-4599-b0fe-56f31cd9bf7c', '{"number":3}'::jsonb, '2026-07-20T19:51:20.687Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'b275e5ed-0fec-458b-ae7a-e8ad99db35af', '8a305759-95be-4599-b0fe-56f31cd9bf7c', '{"number":5}'::jsonb, '2026-07-20T19:51:20.716Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'eda211b0-8566-4a12-aa7f-b4f92b6fa778', '8a305759-95be-4599-b0fe-56f31cd9bf7c', '{"number":2}'::jsonb, '2026-07-20T19:51:20.738Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'c87eb6a9-103d-4e87-9bf1-1ab08883e9fe', '8a305759-95be-4599-b0fe-56f31cd9bf7c', '{"number":5}'::jsonb, '2026-07-20T19:51:20.773Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', '682cf3fe-553e-4817-ac79-dbdc16557443', '8a305759-95be-4599-b0fe-56f31cd9bf7c', '{"number":8}'::jsonb, '2026-07-20T19:51:20.792Z'),
  ('b91277e9-7018-42e1-96e5-615aae0058ee', '2bcbe9b4-0a84-43b2-9c84-04add8851080', '8a305759-95be-4599-b0fe-56f31cd9bf7c', '{"number":2}'::jsonb, '2026-07-20T19:51:20.837Z')
ON CONFLICT DO NOTHING;

INSERT INTO task_dependencies (workspace_id, task_id, depends_on_task_id, created_by, created_at) VALUES
  ('b91277e9-7018-42e1-96e5-615aae0058ee', 'eda211b0-8566-4a12-aa7f-b4f92b6fa778', '24108268-4781-47be-8bbd-ca000d7a2422', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.102Z')
ON CONFLICT DO NOTHING;

INSERT INTO views (id, workspace_id, list_id, name, kind, config, is_shared, position, created_by, created_at, updated_at) VALUES
  ('5fd41d42-bfce-493c-8bd3-f7301391368f', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', 'Board', 'board', '{}'::jsonb, true, 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.108Z', '2026-07-20T19:51:21.108Z'),
  ('caf0abbf-bda7-467b-ba4b-034567ba5b74', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c93101e6-356f-45c8-82a7-05682329a973', 'Table', 'table', '{}'::jsonb, true, 1, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.114Z', '2026-07-20T19:51:21.114Z')
ON CONFLICT DO NOTHING;

INSERT INTO comments (id, workspace_id, task_id, parent_comment_id, author_user_id, body, assignee_user_id, resolved_at, edited_at, created_at) VALUES
  ('134a1ce0-7c55-4629-ab69-3e8e7ede75aa', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', NULL, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', 'First pass looks great — can we tighten the CTA copy?', NULL, NULL, NULL, '2026-07-20T19:51:21.119Z'),
  ('bdb4bd72-e6d8-4f4b-a3f2-a53cbbf9f95a', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', NULL, 'e56eb2a1-091b-45e3-9279-0ff8d2804b09', 'On it. New version by Thursday.', NULL, NULL, NULL, '2026-07-20T19:51:21.127Z'),
  ('37b1fcd8-9d83-4273-a6ef-a890f00b24dd', 'b91277e9-7018-42e1-96e5-615aae0058ee', '24108268-4781-47be-8bbd-ca000d7a2422', NULL, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', 'Repro steps attached. Priority for this sprint.', NULL, NULL, NULL, '2026-07-20T19:51:21.157Z')
ON CONFLICT DO NOTHING;

INSERT INTO docs (id, workspace_id, space_id, name, icon, is_private, created_by, created_at, updated_at) VALUES
  ('5128bfd2-f769-4120-a16e-e8ace1e4df74', 'b91277e9-7018-42e1-96e5-615aae0058ee', NULL, 'Product Spec — v2', '📄', false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.166Z', '2026-07-20T19:51:21.178Z')
ON CONFLICT DO NOTHING;

INSERT INTO doc_pages (id, workspace_id, doc_id, parent_page_id, title, content, position, updated_by, created_at, updated_at) VALUES
  ('e700879d-a4cd-4bcc-9f6c-b24ac487328b', 'b91277e9-7018-42e1-96e5-615aae0058ee', '5128bfd2-f769-4120-a16e-e8ace1e4df74', NULL, 'Product Spec — v2', '<h1>Product Spec v2</h1><p>Goals: faster onboarding, biometric login, redesigned pricing.</p><ul><li>Reduce signup to 2 steps</li><li>Ship to App Store by end of quarter</li></ul>', 0, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.166Z', '2026-07-20T19:51:21.178Z')
ON CONFLICT DO NOTHING;

INSERT INTO time_entries (id, workspace_id, task_id, user_id, started_at, ended_at, duration_seconds, billable, note, created_at) VALUES
  ('e03b1cf6-3b8e-45f9-8edb-a2e11076b64b', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'b7011c05-dd09-4c63-b646-eb772f6f68ab', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-18T19:51:20.071Z', '2026-07-18T21:21:20.071Z', 5400, false, 'Wireframing', '2026-07-20T19:51:21.185Z'),
  ('10c76b52-f25e-42d8-8e6f-022c2b507ece', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'c87eb6a9-103d-4e87-9bf1-1ab08883e9fe', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-19T19:51:20.071Z', '2026-07-19T21:51:20.071Z', 7200, false, 'Pricing layout', '2026-07-20T19:51:21.189Z')
ON CONFLICT DO NOTHING;

INSERT INTO goals (id, workspace_id, folder_id, name, description, owner_user_id, due_date, archived, created_by, created_at, updated_at) VALUES
  ('3b19b8bd-331b-4975-ad28-fc0dde5fa2b2', 'b91277e9-7018-42e1-96e5-615aae0058ee', NULL, 'Launch v2.0 by end of Q3', 'Ship the redesigned mobile app and website.', NULL, NULL, false, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.195Z', '2026-07-20T19:51:21.195Z')
ON CONFLICT DO NOTHING;

INSERT INTO sprints (id, workspace_id, space_id, list_id, name, start_date, end_date, archived, created_at) VALUES
  ('2f33c4fb-70c3-4628-839e-9a13cda347fd', 'b91277e9-7018-42e1-96e5-615aae0058ee', '63f2f902-5aaa-4516-a8e5-a01001e50e79', '1ad79c10-e201-4d0b-8cfa-cf4d03d0b4db', 'Sprint 12', '2026-07-17T00:00:00.000Z', '2026-07-31T00:00:00.000Z', false, '2026-07-20T19:51:21.209Z')
ON CONFLICT DO NOTHING;

INSERT INTO dashboards (id, workspace_id, name, created_by, created_at, updated_at) VALUES
  ('8e1ddfb2-55fe-47a4-b19b-f6a49fd4bcba', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'Team Overview', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.216Z', '2026-07-20T19:51:21.221Z')
ON CONFLICT DO NOTHING;

INSERT INTO dashboard_cards (id, workspace_id, dashboard_id, kind, title, config, position, width, created_at) VALUES
  ('ebfec871-8e30-4dfe-b22a-f3e7841eb9d7', 'b91277e9-7018-42e1-96e5-615aae0058ee', '8e1ddfb2-55fe-47a4-b19b-f6a49fd4bcba', 'statusBreakdown', 'Tasks by status', '{}'::jsonb, 0, 'half', '2026-07-20T19:51:21.221Z')
ON CONFLICT DO NOTHING;

INSERT INTO channels (id, workspace_id, name, description, is_dm, dm_key, created_by, created_at) VALUES
  ('36ca2fcc-cba1-460b-ac67-b64a5100a1d7', 'b91277e9-7018-42e1-96e5-615aae0058ee', 'general', '', false, NULL, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.227Z')
ON CONFLICT DO NOTHING;

INSERT INTO channel_members (id, workspace_id, channel_id, user_id, last_read_at, created_at) VALUES
  ('324876a3-57f2-42f6-a367-c2545d958db5', 'b91277e9-7018-42e1-96e5-615aae0058ee', '36ca2fcc-cba1-460b-ac67-b64a5100a1d7', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.239Z', '2026-07-20T19:51:21.227Z'),
  ('44856cb2-bef6-442d-9e16-1780ea19b9dd', 'b91277e9-7018-42e1-96e5-615aae0058ee', '36ca2fcc-cba1-460b-ac67-b64a5100a1d7', 'e56eb2a1-091b-45e3-9279-0ff8d2804b09', '2026-07-20T19:51:21.245Z', '2026-07-20T19:51:21.235Z')
ON CONFLICT DO NOTHING;

INSERT INTO messages (id, workspace_id, channel_id, parent_message_id, author_user_id, body, edited_at, created_at) VALUES
  ('15ee6708-b3af-4fe9-bff4-7ec984f6a9db', 'b91277e9-7018-42e1-96e5-615aae0058ee', '36ca2fcc-cba1-460b-ac67-b64a5100a1d7', NULL, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', 'Welcome to Acme Inc 👋 Kicking off the v2 launch this week!', NULL, '2026-07-20T19:51:21.239Z'),
  ('67dccaa9-b00a-4a9b-9958-96c853c86b7c', 'b91277e9-7018-42e1-96e5-615aae0058ee', '36ca2fcc-cba1-460b-ac67-b64a5100a1d7', NULL, 'e56eb2a1-091b-45e3-9279-0ff8d2804b09', 'Pricing page redesign is in progress — review coming Friday.', NULL, '2026-07-20T19:51:21.245Z')
ON CONFLICT DO NOTHING;

INSERT INTO whiteboards (id, workspace_id, space_id, name, elements, updated_by, created_by, created_at, updated_at) VALUES
  ('e063ab7f-16bd-474b-8535-8091c8172b15', 'b91277e9-7018-42e1-96e5-615aae0058ee', NULL, 'Roadmap Jam', '[{"h":110,"w":160,"x":60,"y":60,"id":"a","kind":"sticky","text":"Onboarding v2","color":"#FDE68A"},{"h":110,"w":160,"x":260,"y":90,"id":"b","kind":"sticky","text":"Biometric login","color":"#BBF7D0"},{"h":110,"w":160,"x":160,"y":240,"id":"c","kind":"sticky","text":"Pricing redesign","color":"#DDD6FE"}]'::jsonb, 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', 'ab4fb81e-05ea-433d-b31c-ab60a05c134f', '2026-07-20T19:51:21.250Z', '2026-07-20T19:51:21.257Z')
ON CONFLICT DO NOTHING;

-- make the demo workspace show up under your admin account
INSERT INTO memberships (workspace_id, user_id, role)
  SELECT 'b91277e9-7018-42e1-96e5-615aae0058ee', u.id, 'owner' FROM users u WHERE lower(u.email) = lower('misiatipeter@gmail.com')
  ON CONFLICT DO NOTHING;

COMMIT;
