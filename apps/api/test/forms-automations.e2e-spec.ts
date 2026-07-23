import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AutomationsService } from "../src/automations/automations.service";

/**
 * End-to-end tests for Module 11 (Forms & Automations) against the migrated
 * stackup_test database: public forms create tasks through the token-scoped
 * RLS context, and space automations fire on task events without cascading.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;
let automationsService: AutomationsService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
  automationsService = app.get(AutomationsService);
});

afterAll(async () => {
  await app.close();
});

const uniqueEmail = () =>
  `u${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signup(email = uniqueEmail(), password = "password123") {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Test User", password })
    .expect(201);
  return {
    email,
    password,
    identityToken: res.body.identityToken as string,
    userId: res.body.user.id as string,
  };
}

async function ownerWorkspace(name = "M11 WS") {
  const owner = await signup();
  const created = await http
    .post("/workspaces")
    .set(auth(owner.identityToken))
    .send({ name })
    .expect(201);
  const workspaceId = created.body.workspace.id as string;
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(owner.identityToken))
    .expect(200);
  return {
    ...owner,
    workspaceId,
    accessToken: tokenRes.body.accessToken as string,
  };
}

/** A workspace with a space + list, ready for forms/automations. */
async function fixture() {
  const owner = await ownerWorkspace();
  const space = (
    await http
      .post("/spaces")
      .set(auth(owner.accessToken))
      .send({ name: "Space" })
      .expect(201)
  ).body.space;
  const list = (
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(owner.accessToken))
      .send({ name: "Intake" })
      .expect(201)
  ).body.list;
  return { owner, space, list };
}

async function spaceStatuses(token: string, spaceId: string) {
  const res = await http
    .get(`/spaces/${spaceId}/statuses`)
    .set(auth(token))
    .expect(200);
  return res.body.statuses as {
    id: string;
    name: string;
    type: string;
  }[];
}

async function makeTask(
  token: string,
  listId: string,
  body: Record<string, unknown> = {},
) {
  return (
    await http
      .post(`/lists/${listId}/tasks`)
      .set(auth(token))
      .send({ name: "Task", ...body })
      .expect(201)
  ).body.task;
}

async function getTask(token: string, taskId: string) {
  return (await http.get(`/tasks/${taskId}`).set(auth(token)).expect(200))
    .body.task;
}

async function getRuns(token: string, automationId: string) {
  return (
    await http
      .get(`/automations/${automationId}/runs`)
      .set(auth(token))
      .expect(200)
  ).body.runs as {
    id: string;
    taskId: string | null;
    taskName: string | null;
    ok: boolean;
    detail: string;
  }[];
}

const FORM_FIELDS = [
  { label: "Subject", type: "text", required: true, asTitle: true },
  { label: "Your email", type: "email", required: true },
  {
    label: "Category",
    type: "select",
    required: false,
    options: ["Bug", "Feature"],
  },
  { label: "Urgent?", type: "checkbox", required: false },
];

async function makeForm(
  token: string,
  listId: string,
  body: Record<string, unknown> = {},
) {
  return (
    await http
      .post("/forms")
      .set(auth(token))
      .send({ name: "Support intake", listId, fields: FORM_FIELDS, ...body })
      .expect(201)
  ).body.form;
}

describe("forms", () => {
  it("create + public GET by token (no auth) + submit creates a task in the list", async () => {
    const { owner, list } = await fixture();

    // Field validation at save: select without options, two asTitle flags.
    await http
      .post("/forms")
      .set(auth(owner.accessToken))
      .send({
        name: "Bad",
        listId: list.id,
        fields: [{ label: "Pick", type: "select", required: true }],
      })
      .expect(400);
    await http
      .post("/forms")
      .set(auth(owner.accessToken))
      .send({
        name: "Bad",
        listId: list.id,
        fields: [
          { label: "A", type: "text", asTitle: true },
          { label: "B", type: "text", asTitle: true },
        ],
      })
      .expect(400);

    const form = await makeForm(owner.accessToken, list.id, {
      description: "Tell us what broke",
    });
    expect(form.publicToken).toHaveLength(32);
    expect(form.fields).toHaveLength(4);
    // Server generated the field ids.
    for (const f of form.fields) expect(typeof f.id).toBe("string");

    // Authed listing includes listName + fieldCount.
    const listed = await http
      .get("/forms")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.forms).toEqual([
      expect.objectContaining({
        id: form.id,
        name: "Support intake",
        listId: list.id,
        listName: "Intake",
        active: true,
        publicToken: form.publicToken,
        fieldCount: 4,
      }),
    ]);

    // Public GET needs NO auth and never exposes list/workspace ids.
    const pub = await http.get(`/public/forms/${form.publicToken}`).expect(200);
    expect(pub.body.form.name).toBe("Support intake");
    expect(pub.body.form.description).toBe("Tell us what broke");
    expect(pub.body.form.fields).toHaveLength(4);
    expect(JSON.stringify(pub.body)).not.toContain(list.id);
    expect(JSON.stringify(pub.body)).not.toContain(owner.workspaceId);

    const byLabel = new Map(
      (pub.body.form.fields as { id: string; label: string }[]).map((f) => [
        f.label,
        f.id,
      ]),
    );
    await http
      .post(`/public/forms/${form.publicToken}/submit`)
      .send({
        values: {
          [byLabel.get("Subject")!]: "Printer on fire",
          [byLabel.get("Your email")!]: "sam@example.com",
          [byLabel.get("Category")!]: "Bug",
          [byLabel.get("Urgent?")!]: true,
        },
      })
      .expect(201)
      .expect(({ body }) => expect(body).toEqual({ ok: true }));

    // The task landed in the target list, titled from the asTitle field.
    const tasks = (
      await http
        .get(`/lists/${list.id}/tasks`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.tasks as { id: string; name: string }[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("Printer on fire");
    const detail = await getTask(owner.accessToken, tasks[0].id);
    expect(detail.description).toContain("Subject: Printer on fire");
    expect(detail.description).toContain("Your email: sam@example.com");
    expect(detail.description).toContain("Category: Bug");
    expect(detail.description).toContain("Urgent?: Yes");

    // Omitting the required asTitle field is a 400, not an untitled task.
    await http
      .post(`/public/forms/${form.publicToken}/submit`)
      .send({ values: { [byLabel.get("Your email")!]: "x@y.zz" } })
      .expect(400); // Subject required
  });

  it("reconstructs responses from submissions (with CSV-ready values)", async () => {
    const { owner, list } = await fixture();
    const form = await makeForm(owner.accessToken, list.id);
    const byLabel = new Map(
      (form.fields as { id: string; label: string }[]).map((f) => [f.label, f.id]),
    );

    // Two public submissions.
    await http
      .post(`/public/forms/${form.publicToken}/submit`)
      .send({
        values: {
          [byLabel.get("Subject")!]: "Login broken",
          [byLabel.get("Your email")!]: "ana@example.com",
          [byLabel.get("Category")!]: "Bug",
          [byLabel.get("Urgent?")!]: true,
        },
      })
      .expect(201);
    await http
      .post(`/public/forms/${form.publicToken}/submit`)
      .send({
        values: {
          [byLabel.get("Subject")!]: "Dark mode please",
          [byLabel.get("Your email")!]: "ben@example.com",
          [byLabel.get("Category")!]: "Feature",
        },
      })
      .expect(201);

    // Listing reports the response count.
    const listed = await http.get("/forms").set(auth(owner.accessToken)).expect(200);
    expect(listed.body.forms[0].responseCount).toBe(2);

    // Responses endpoint returns per-field answers keyed by field id.
    const res = await http
      .get(`/forms/${form.id}/responses`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(res.body.form.fields).toHaveLength(4);
    expect(res.body.responses).toHaveLength(2);

    const subjectId = byLabel.get("Subject")!;
    const emailId = byLabel.get("Your email")!;
    const titles = res.body.responses.map(
      (r: { values: Record<string, string> }) => r.values[subjectId],
    );
    expect(titles).toEqual(
      expect.arrayContaining(["Login broken", "Dark mode please"]),
    );
    const ana = res.body.responses.find(
      (r: { values: Record<string, string> }) =>
        r.values[subjectId] === "Login broken",
    );
    expect(ana.values[emailId]).toBe("ana@example.com");
    expect(ana.values[byLabel.get("Category")!]).toBe("Bug");
    expect(ana.values[byLabel.get("Urgent?")!]).toBe("Yes");
    expect(ana.title).toBe("Login broken");
    expect(typeof ana.taskId).toBe("string");
  });

  it("conditional fields (visibleIf) gate required-ness at submit (M21)", async () => {
    const { owner, list } = await fixture();
    // Explicit ids so the condition can reference an earlier field.
    const fields = [
      { id: "subj", label: "Subject", type: "text", required: true, asTitle: true },
      { id: "cat", label: "Category", type: "select", required: true, options: ["Bug", "Feature"] },
      {
        id: "bug",
        label: "Bug details",
        type: "textarea",
        required: true,
        visibleIf: { fieldId: "cat", equals: "Bug" },
      },
    ];
    // A condition pointing at a LATER field is rejected.
    await http
      .post("/forms")
      .set(auth(owner.accessToken))
      .send({
        name: "Bad cond",
        listId: list.id,
        fields: [
          { id: "a", label: "A", type: "text", required: false, visibleIf: { fieldId: "b", equals: "x" } },
          { id: "b", label: "B", type: "text", required: false },
        ],
      })
      .expect(400);

    const form = await makeForm(owner.accessToken, list.id, { fields });
    const pub = await http.get(`/public/forms/${form.publicToken}`).expect(200);
    // The public schema exposes the condition for the client to evaluate.
    const bugField = (pub.body.form.fields as { id: string; visibleIf?: unknown }[]).find(
      (f) => f.id === "bug",
    );
    expect(bugField?.visibleIf).toEqual({ fieldId: "cat", equals: "Bug" });

    const submit = (values: Record<string, unknown>) =>
      http.post(`/public/forms/${form.publicToken}/submit`).send({ values });

    // Category=Feature hides Bug details, so omitting it is fine.
    await submit({ subj: "Nice idea", cat: "Feature" }).expect(201);
    // Category=Bug makes Bug details visible + required → omitting it is 400.
    await submit({ subj: "It broke", cat: "Bug" }).expect(400);
    // Providing it passes.
    await submit({ subj: "It broke", cat: "Bug", bug: "NPE on save" }).expect(201);
  });

  it("validates required fields and types on submit (400)", async () => {
    const { owner, list } = await fixture();
    const form = await makeForm(owner.accessToken, list.id);
    const byLabel = new Map(
      (form.fields as { id: string; label: string }[]).map((f) => [
        f.label,
        f.id,
      ]),
    );
    const submit = (values: Record<string, unknown>) =>
      http.post(`/public/forms/${form.publicToken}/submit`).send({ values });

    await submit({}).expect(400); // required Subject missing
    await submit({
      [byLabel.get("Subject")!]: "Hi",
      [byLabel.get("Your email")!]: "not-an-email",
    }).expect(400);
    await submit({
      [byLabel.get("Subject")!]: "Hi",
      [byLabel.get("Your email")!]: "a@b.co",
      [byLabel.get("Category")!]: "Nope",
    }).expect(400); // not in options
    await submit({
      [byLabel.get("Subject")!]: "Hi",
      [byLabel.get("Your email")!]: "a@b.co",
      [byLabel.get("Urgent?")!]: "yes",
    }).expect(400); // checkbox must be boolean
    await http
      .post(`/public/forms/${form.publicToken}/submit`)
      .send({ values: "nope" })
      .expect(400);

    // A valid submission still passes after the rejections.
    await submit({
      [byLabel.get("Subject")!]: "Hi",
      [byLabel.get("Your email")!]: "a@b.co",
    }).expect(201);
  });

  it("inactive form 404s publicly; token rotation invalidates the old token", async () => {
    const { owner, list } = await fixture();
    const form = await makeForm(owner.accessToken, list.id);

    await http.get(`/public/forms/${form.publicToken}`).expect(200);
    await http.get(`/public/forms/definitely-not-a-real-token00`).expect(404);

    // Deactivate -> both public routes 404.
    await http
      .patch(`/forms/${form.id}`)
      .set(auth(owner.accessToken))
      .send({ active: false })
      .expect(200);
    await http.get(`/public/forms/${form.publicToken}`).expect(404);
    await http
      .post(`/public/forms/${form.publicToken}/submit`)
      .send({ values: {} })
      .expect(404);

    // Reactivate, then rotate: old token dies, new token works.
    await http
      .patch(`/forms/${form.id}`)
      .set(auth(owner.accessToken))
      .send({ active: true })
      .expect(200);
    const rotated = await http
      .post(`/forms/${form.id}/rotate-token`)
      .set(auth(owner.accessToken))
      .expect(200);
    const newToken = rotated.body.publicToken as string;
    expect(newToken).toHaveLength(32);
    expect(newToken).not.toBe(form.publicToken);
    await http.get(`/public/forms/${form.publicToken}`).expect(404);
    await http.get(`/public/forms/${newToken}`).expect(200);

    // Management routes require auth.
    await http.get("/forms").expect(401);
  });
});

describe("automations", () => {
  it("status.changed -> set.priority + post.comment fire and log a run", async () => {
    const { owner, space, list } = await fixture();
    await makeTask(owner.accessToken, list.id, { name: "seed" }); // provisions statuses
    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;

    const automation = (
      await http
        .post(`/spaces/${space.id}/automations`)
        .set(auth(owner.accessToken))
        .send({
          name: "On done",
          trigger: { type: "status.changed", toStatusId: done.id },
          actions: [
            { type: "set.priority", priority: "urgent" },
            { type: "post.comment", body: "Wrapped up automatically" },
          ],
        })
        .expect(201)
    ).body.automation;
    expect(automation.enabled).toBe(true);
    expect(automation.runCount).toBe(0);

    // Bad refs are rejected at save.
    await http
      .post(`/spaces/${space.id}/automations`)
      .set(auth(owner.accessToken))
      .send({
        name: "Bad",
        trigger: { type: "status.changed" },
        actions: [
          { type: "set.status", statusId: "00000000-0000-0000-0000-000000000000" },
        ],
      })
      .expect(400);

    const task = await makeTask(owner.accessToken, list.id, { name: "Ship it" });
    // Moving to a NON-matching status does not fire (filter respected).
    const active = statuses.find((s) => s.type === "active")!;
    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: active.id })
      .expect(200);
    expect(await getRuns(owner.accessToken, automation.id)).toHaveLength(0);

    // Moving INTO the matching status fires both actions atomically.
    const updated = (
      await http
        .patch(`/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ statusId: done.id })
        .expect(200)
    ).body.task;
    expect(updated.priority).toBe("urgent"); // reflected in the same response

    const comments = (
      await http
        .get(`/tasks/${task.id}/comments`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.comments as { body: string }[];
    expect(comments.map((c) => c.body)).toContain("Wrapped up automatically");

    const runs = await getRuns(owner.accessToken, automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ taskId: task.id, taskName: "Ship it", ok: true });
    expect(runs[0].detail).toContain("set.priority");
    expect(runs[0].detail).toContain("post.comment");

    // The listing rolls up runCount/lastRunAt.
    const listed = (
      await http
        .get(`/spaces/${space.id}/automations`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.automations as { id: string; runCount: number; lastRunAt: string }[];
    const mine = listed.find((a) => a.id === automation.id)!;
    expect(mine.runCount).toBe(1);
    expect(mine.lastRunAt).not.toBeNull();

    // The task's activity feed notes the automation.
    const activity = (
      await http
        .get(`/tasks/${task.id}/activity`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.activity as { kind: string; data: Record<string, unknown> }[];
    expect(
      activity.some(
        (a) => a.kind === "automation" && a.data.automationId === automation.id,
      ),
    ).toBe(true);
  });

  it("task.created -> add.tag", async () => {
    const { owner, space, list } = await fixture();
    const tag = (
      await http
        .post(`/spaces/${space.id}/tags`)
        .set(auth(owner.accessToken))
        .send({ name: "intake", color: "#22C55E" })
        .expect(201)
    ).body.tag;

    await http
      .post(`/spaces/${space.id}/automations`)
      .set(auth(owner.accessToken))
      .send({
        name: "Tag new tasks",
        trigger: { type: "task.created" },
        actions: [{ type: "add.tag", tagId: tag.id }],
      })
      .expect(201);

    const task = await makeTask(owner.accessToken, list.id, { name: "Fresh" });
    expect(task.tags.map((t: { id: string }) => t.id)).toContain(tag.id);
  });

  it("loop protection: an automation-driven status change never cascades", async () => {
    const { owner, space, list } = await fixture();
    await makeTask(owner.accessToken, list.id, { name: "seed" });
    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const x = statuses.find((s) => s.type === "active")!;
    const y = statuses.find((s) => s.type === "done")!;

    // A: when a task ENTERS X, push it to Y (direct SQL inside the engine).
    const a = (
      await http
        .post(`/spaces/${space.id}/automations`)
        .set(auth(owner.accessToken))
        .send({
          name: "A: X -> set Y",
          trigger: { type: "status.changed", toStatusId: x.id },
          actions: [{ type: "set.status", statusId: y.id }],
        })
        .expect(201)
    ).body.automation;
    // B: when a task ENTERS Y, push it back to X — a user-visible ping-pong
    // if automation writes re-fired triggers.
    const b = (
      await http
        .post(`/spaces/${space.id}/automations`)
        .set(auth(owner.accessToken))
        .send({
          name: "B: Y -> set X",
          trigger: { type: "status.changed", toStatusId: y.id },
          actions: [{ type: "set.status", statusId: x.id }],
        })
        .expect(201)
    ).body.automation;

    const task = await makeTask(owner.accessToken, list.id, { name: "Pinball" });
    await http
      .patch(`/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ statusId: x.id })
      .expect(200);

    // A fired once (user moved the task into X); its set.status write did
    // NOT trigger B, and nothing cascaded further.
    expect(await getRuns(owner.accessToken, a.id)).toHaveLength(1);
    expect(await getRuns(owner.accessToken, b.id)).toHaveLength(0);
    const after = await getTask(owner.accessToken, task.id);
    expect(after.statusId).toBe(y.id); // A's action stuck; B never ran
  });

  it("due.overdue: scanOverdue applies actions exactly once across two scans", async () => {
    const { owner, space, list } = await fixture();
    const automation = (
      await http
        .post(`/spaces/${space.id}/automations`)
        .set(auth(owner.accessToken))
        .send({
          name: "Escalate overdue",
          trigger: { type: "due.overdue" },
          actions: [
            { type: "set.priority", priority: "urgent" },
            { type: "post.comment", body: "This task is overdue" },
          ],
        })
        .expect(201)
    ).body.automation;

    const overdue = await makeTask(owner.accessToken, list.id, {
      name: "Late",
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const future = await makeTask(owner.accessToken, list.id, {
      name: "On time",
      dueDate: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await automationsService.scanOverdue();
    await automationsService.scanOverdue(); // second pass must be a no-op

    const late = await getTask(owner.accessToken, overdue.id);
    expect(late.priority).toBe("urgent");
    const ontime = await getTask(owner.accessToken, future.id);
    expect(ontime.priority).toBeNull();

    const runs = await getRuns(owner.accessToken, automation.id);
    expect(runs).toHaveLength(1); // exactly once across two scans
    expect(runs[0]).toMatchObject({ taskId: overdue.id, ok: true });

    const comments = (
      await http
        .get(`/tasks/${overdue.id}/comments`)
        .set(auth(owner.accessToken))
        .expect(200)
    ).body.comments as { body: string }[];
    expect(
      comments.filter((c) => c.body === "This task is overdue"),
    ).toHaveLength(1);

    // A disabled rule stops firing: new overdue task, disable, scan.
    await http
      .patch(`/automations/${automation.id}`)
      .set(auth(owner.accessToken))
      .send({ enabled: false })
      .expect(200);
    await makeTask(owner.accessToken, list.id, {
      name: "Late 2",
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await automationsService.scanOverdue();
    expect(await getRuns(owner.accessToken, automation.id)).toHaveLength(1);
  });
});
