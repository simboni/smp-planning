import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * The CRUD sweep (docs/crud-sweep.md): one test per defect that was fixed in
 * the API, each written to fail on the old behaviour.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;
// The migrator connection, only to set up states the API (rightly) refuses
// to create — e.g. leave that has already started.
const admin = new Pool({
  connectionString: "postgres://stackup_migrator:migrator_dev_pw@localhost:5432/stackup_test",
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
  await admin.end();
});

const uniqueEmail = () => `sw${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signup(fullName = "Sweep User") {
  const email = uniqueEmail();
  const r = await http.post("/auth/signup").send({ email, fullName, password: "password123" }).expect(201);
  return { email, identityToken: r.body.identityToken as string, userId: r.body.user.id as string };
}
async function token(identityToken: string, workspaceId: string) {
  return (await http.post(`/workspaces/${workspaceId}/token`).set(auth(identityToken)).expect(200)).body
    .accessToken as string;
}
async function workspace(name = "Sweep WS") {
  const owner = await signup("Olive Owner");
  const ws = await http.post("/workspaces").set(auth(owner.identityToken)).send({ name }).expect(201);
  const workspaceId = ws.body.workspace.id as string;
  return { ...owner, workspaceId, access: await token(owner.identityToken, workspaceId) };
}
async function join(ownerAccess: string, workspaceId: string, role: "member" | "guest" | "admin" = "member") {
  const u = await signup("Mo Member");
  await http.post("/workspaces/current/members").set(auth(ownerAccess)).send({ email: u.email, role }).expect(201);
  return { ...u, access: await token(u.identityToken, workspaceId) };
}
async function space(access: string, name = "S") {
  return (await http.post("/spaces").set(auth(access)).send({ name }).expect(201)).body.space;
}
async function list(access: string, spaceId: string, name = "L", folderId?: string) {
  return (await http.post(`/spaces/${spaceId}/lists`).set(auth(access)).send({ name, folderId }).expect(201)).body
    .list;
}
async function task(access: string, listId: string, name = "T") {
  return (await http.post(`/lists/${listId}/tasks`).set(auth(access)).send({ name }).expect(201)).body.task;
}

describe("hierarchy", () => {
  it("a live list under an archived folder still shows, at space level", async () => {
    const w = await workspace();
    const s = await space(w.access);
    const folder = (await http.post(`/spaces/${s.id}/folders`).set(auth(w.access)).send({ name: "F" }).expect(201))
      .body.folder;
    const l = await list(w.access, s.id, "Keep me", folder.id);
    await http.patch(`/folders/${folder.id}`).set(auth(w.access)).send({ archived: true }).expect(200);
    const tree = (await http.get("/hierarchy").set(auth(w.access)).expect(200)).body.spaces;
    const sp = tree.find((x: { id: string }) => x.id === s.id);
    expect(sp.lists.map((x: { id: string }) => x.id)).toContain(l.id);
  });

  it("archived items are listed and can be restored", async () => {
    const w = await workspace();
    const s = await space(w.access, "Old space");
    const s2 = await space(w.access, "Live");
    const l = await list(w.access, s2.id, "Old list");
    await http.patch(`/spaces/${s.id}`).set(auth(w.access)).send({ archived: true }).expect(200);
    await http.patch(`/lists/${l.id}`).set(auth(w.access)).send({ archived: true }).expect(200);
    const arch = (await http.get("/hierarchy/archived").set(auth(w.access)).expect(200)).body;
    expect(arch.spaces).toEqual([expect.objectContaining({ id: s.id, canRestore: true })]);
    expect(arch.lists).toEqual([expect.objectContaining({ id: l.id, spaceName: "Live", canRestore: true })]);
    await http.patch(`/spaces/${s.id}`).set(auth(w.access)).send({ archived: false }).expect(200);
    const tree = (await http.get("/hierarchy").set(auth(w.access)).expect(200)).body.spaces;
    expect(tree.map((x: { id: string }) => x.id)).toContain(s.id);
  });

  it("a member who creates a space can manage it", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    const s = await space(m.access, "Mine");
    expect(s.myPermission).toBe("full");
    await http.patch(`/spaces/${s.id}`).set(auth(m.access)).send({ name: "Mine, renamed" }).expect(200);
    await http.patch(`/spaces/${s.id}`).set(auth(m.access)).send({ archived: true }).expect(200);
  });

  it("a task moves to a list in another space and takes that space's statuses", async () => {
    const w = await workspace();
    const a = await space(w.access, "A");
    const b = await space(w.access, "B");
    const la = await list(w.access, a.id);
    const lb = await list(w.access, b.id);
    const t = await task(w.access, la.id, "Move me");
    await http.patch(`/tasks/${t.id}`).set(auth(w.access)).send({ listId: lb.id }).expect(200);
    const moved = (await http.get(`/tasks/${t.id}`).set(auth(w.access)).expect(200)).body.task;
    expect(moved.listId).toBe(lb.id);
    const bStatuses = (await http.get(`/spaces/${b.id}/statuses`).set(auth(w.access)).expect(200)).body.statuses;
    expect(bStatuses.map((x: { id: string }) => x.id)).toContain(moved.status.id);
  });

  it("done -> another done status keeps the original completion time", async () => {
    const w = await workspace();
    const s = await space(w.access);
    const l = await list(w.access, s.id);
    const t = await task(w.access, l.id);
    const statuses = (await http.get(`/spaces/${s.id}/statuses`).set(auth(w.access)).expect(200)).body.statuses;
    const done = statuses.find((x: { type: string }) => x.type === "done");
    const closed = (
      await http.post(`/spaces/${s.id}/statuses`).set(auth(w.access)).send({ name: "Closed", type: "done" }).expect(201)
    ).body.status;
    await http.patch(`/tasks/${t.id}`).set(auth(w.access)).send({ statusId: done.id }).expect(200);
    const first = (await http.get(`/tasks/${t.id}`).set(auth(w.access)).expect(200)).body.task.completedAt;
    await new Promise((r) => setTimeout(r, 50));
    await http.patch(`/tasks/${t.id}`).set(auth(w.access)).send({ statusId: closed.id }).expect(200);
    const second = (await http.get(`/tasks/${t.id}`).set(auth(w.access)).expect(200)).body.task.completedAt;
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });
});

describe("notes", () => {
  it("search finds your own notes, never someone else's", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    await http.post("/notes").set(auth(w.access)).send({ content: "Call the plumber\nabout the kitchen zebrafish" }).expect(201);
    await http.post("/notes").set(auth(m.access)).send({ content: "member zebrafish secret" }).expect(201);
    const mine = (await http.get("/search?q=zebrafish").set(auth(w.access)).expect(200)).body.results.notes;
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Call the plumber");
    expect(mine[0].snippet).toContain("zebrafish");
  });
});

describe("forms", () => {
  it("answers are kept by field id: renaming a field keeps earlier answers; manual tasks aren't responses", async () => {
    const w = await workspace();
    const s = await space(w.access);
    const l = await list(w.access, s.id);
    const form = (
      await http
        .post("/forms")
        .set(auth(w.access))
        .send({
          name: "Intake",
          listId: l.id,
          fields: [
            { label: "Subject", type: "text", required: true, asTitle: true },
            { label: "Notes", type: "textarea", required: false },
          ],
        })
        .expect(201)
    ).body.form;
    const [subject, notes] = form.fields as { id: string; label: string }[];
    await http
      .post(`/public/forms/${form.publicToken}/submit`)
      .send({ values: { [subject.id]: "Leaky tap", [notes.id]: "Subject: not really\nsecond line" } })
      .expect(201);
    // A manual task with a description is not a response.
    await http.post(`/lists/${l.id}/tasks`).set(auth(w.access)).send({ name: "Manual", description: "Some text" }).expect(201);
    // Rename the field.
    await http
      .patch(`/forms/${form.id}`)
      .set(auth(w.access))
      .send({ fields: [{ ...subject, label: "Topic" }, notes] })
      .expect(200);
    const res = (await http.get(`/forms/${form.id}/responses`).set(auth(w.access)).expect(200)).body;
    expect(res.responses).toHaveLength(1);
    expect(res.responses[0].values[subject.id]).toBe("Leaky tap");
    expect(res.responses[0].values[notes.id]).toBe("Subject: not really\nsecond line");
    const listed = (await http.get("/forms").set(auth(w.access)).expect(200)).body.forms;
    expect(listed.find((f: { id: string }) => f.id === form.id).responseCount).toBe(1);
  });
});

describe("custom fields", () => {
  it("deleting a labels option prunes it from tasks, so the field still works", async () => {
    const w = await workspace();
    const s = await space(w.access);
    const l = await list(w.access, s.id);
    const t = await task(w.access, l.id);
    const field = (
      await http
        .post(`/spaces/${s.id}/fields`)
        .set(auth(w.access))
        .send({ name: "Area", type: "labels", config: { options: [{ name: "api" }, { name: "web" }] } })
        .expect(201)
    ).body.field;
    const [api, web] = field.config.options as { id: string; name: string }[];
    await http.put(`/tasks/${t.id}/fields/${field.id}`).set(auth(w.access)).send({ value: { optionIds: [api.id, web.id] } }).expect(200);
    // Remove "web".
    await http.patch(`/fields/${field.id}`).set(auth(w.access)).send({ config: { options: [api] } }).expect(200);
    const detail = (await http.get(`/tasks/${t.id}`).set(auth(w.access)).expect(200)).body.task;
    const stored = JSON.stringify(detail);
    expect(stored).not.toContain(web.id);
    // ...and the next change is accepted.
    await http.put(`/tasks/${t.id}/fields/${field.id}`).set(auth(w.access)).send({ value: { optionIds: [api.id] } }).expect(200);
  });
});

describe("public links", () => {
  it("sharing again after revoking gives a NEW link; the old one stays dead", async () => {
    const w = await workspace();
    const s = await space(w.access);
    const l = await list(w.access, s.id);
    const first = (await http.post("/shares").set(auth(w.access)).send({ entityType: "list", entityId: l.id }).expect(201)).body.share;
    await http.delete(`/shares/${first.id}`).set(auth(w.access)).expect(204);
    const second = (await http.post("/shares").set(auth(w.access)).send({ entityType: "list", entityId: l.id }).expect(201)).body.share;
    expect(second.token).not.toBe(first.token);
    await http.get(`/public/share/${first.token}`).expect(404);
    await http.get(`/public/share/${second.token}`).expect(200);
    // A live link keeps its token when shared again.
    const third = (await http.post("/shares").set(auth(w.access)).send({ entityType: "list", entityId: l.id }).expect(201)).body.share;
    expect(third.token).toBe(second.token);
  });
});

describe("organization", () => {
  it("one department head: the lead dropdown and the roster agree, both ways", async () => {
    const w = await workspace();
    const a = await join(w.access, w.workspaceId);
    const b = await join(w.access, w.workspaceId);
    const dept = (await http.post("/departments").set(auth(w.access)).send({ name: "Ops", leadUserId: a.userId }).expect(201)).body
      .department;
    let d = (await http.get(`/departments/${dept.id}`).set(auth(w.access)).expect(200)).body.department;
    expect(d.lead.id).toBe(a.userId);
    expect(d.members.find((m: { userId: string }) => m.userId === a.userId).deptRole).toBe("head");
    // "Make head" on the roster moves the lead.
    await http.post(`/departments/${dept.id}/members`).set(auth(w.access)).send({ userId: b.userId }).expect(201);
    await http.patch(`/departments/${dept.id}/members/${b.userId}`).set(auth(w.access)).send({ deptRole: "head" }).expect(200);
    d = (await http.get(`/departments/${dept.id}`).set(auth(w.access)).expect(200)).body.department;
    expect(d.lead.id).toBe(b.userId);
    expect(d.members.find((m: { userId: string }) => m.userId === a.userId).deptRole).toBe("member");
    // Removing the head leaves no head anywhere.
    await http.delete(`/departments/${dept.id}/members/${b.userId}`).set(auth(w.access)).expect(204);
    d = (await http.get(`/departments/${dept.id}`).set(auth(w.access)).expect(200)).body.department;
    expect(d.lead).toBeNull();
  });

  it("a removed member leaves no ghost rows in departments or teams", async () => {
    const w = await workspace();
    const m = await join(w.access, w.workspaceId);
    const dept = (await http.post("/departments").set(auth(w.access)).send({ name: "Sales", leadUserId: m.userId }).expect(201)).body
      .department;
    const team = (await http.post("/teams").set(auth(w.access)).send({ name: "Crew" }).expect(201)).body.team;
    await http.post(`/teams/${team.id}/members`).set(auth(w.access)).send({ userId: m.userId }).expect(201);
    await http.delete(`/workspaces/current/members/${m.userId}`).set(auth(w.access)).expect(204);
    const d = (await http.get(`/departments/${dept.id}`).set(auth(w.access)).expect(200)).body.department;
    expect(d.members).toHaveLength(0);
    expect(d.lead).toBeNull();
    const t = (await http.get(`/teams/${team.id}`).set(auth(w.access)).expect(200)).body;
    expect(JSON.stringify(t)).not.toContain(m.userId);
  });

  it("an admin in two workspaces appears once on a department roster", async () => {
    const w = await workspace("WS one");
    const m = await join(w.access, w.workspaceId, "admin");
    // m also owns a second workspace.
    await http.post("/workspaces").set(auth(m.identityToken)).send({ name: "WS two" }).expect(201);
    const dept = (await http.post("/departments").set(auth(w.access)).send({ name: "Eng" }).expect(201)).body.department;
    await http.post(`/departments/${dept.id}/members`).set(auth(w.access)).send({ userId: m.userId }).expect(201);
    const d = (await http.get(`/departments/${dept.id}`).set(auth(m.access)).expect(200)).body.department;
    expect(d.members.filter((x: { userId: string }) => x.userId === m.userId)).toHaveLength(1);
    expect(d.members[0].role).toBe("admin");
  });

  it("guests can't read teams", async () => {
    const w = await workspace();
    const g = await join(w.access, w.workspaceId, "guest");
    await http.get("/teams").set(auth(g.access)).expect(403);
  });

  it("leave: two approvers at once — exactly one wins; started leave can't be cancelled", async () => {
    const w = await workspace();
    const admin2 = await join(w.access, w.workspaceId, "admin");
    const m = await join(w.access, w.workspaceId);
    const type = (await http.post("/leave/types").set(auth(w.access)).send({ name: "Annual", daysPerYear: 21 }).expect(201)).body.type;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 21);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    const start = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 2);
    const req = (
      await http.post("/leave/requests").set(auth(m.access)).send({ leaveTypeId: type.id, startDate: start, endDate: d.toISOString().slice(0, 10) }).expect(201)
    ).body.request;
    const results = await Promise.all([
      http.post(`/leave/requests/${req.id}/decide`).set(auth(w.access)).send({ approve: true }),
      http.post(`/leave/requests/${req.id}/decide`).set(auth(admin2.access)).send({ approve: false }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400].sort());
    // Make it approved and already started, then try to cancel it.
    await admin.query(
      `UPDATE leave_requests SET status = 'approved', start_date = current_date - 3, end_date = current_date + 1 WHERE id = $1`,
      [req.id],
    );
    await http.post(`/leave/requests/${req.id}/cancel`).set(auth(m.access)).expect(400);
  });
});

describe("docs", () => {
  it("adding a page bumps the doc's page count and date in the list", async () => {
    const w = await workspace();
    const doc = (await http.post("/docs").set(auth(w.access)).send({ name: "Handbook" }).expect(201)).body.doc;
    await new Promise((r) => setTimeout(r, 30));
    await http.post(`/docs/${doc.id}/pages`).set(auth(w.access)).send({ title: "Two" }).expect(201);
    const listed = (await http.get("/docs").set(auth(w.access)).expect(200)).body.docs.find((d: { id: string }) => d.id === doc.id);
    expect(listed.pageCount).toBe(2);
    expect(new Date(listed.updatedAt).getTime()).toBeGreaterThan(new Date(doc.updatedAt).getTime());
  });
});
