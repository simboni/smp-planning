import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Do (Copilot operator) — execution + validation. These exercise POST /ai/do
 * directly with hand-built operations (no LLM needed), proving that operations
 * run through the real services AND that the id-allowlist rejects anything not
 * in the caller's visible snapshot.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const email = () => `u${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setup() {
  const su = await http
    .post("/auth/signup")
    .send({ email: email(), fullName: "Op User", password: "password123" })
    .expect(201);
  const ws = await http
    .post("/workspaces")
    .set(auth(su.body.identityToken))
    .send({ name: "Op WS" })
    .expect(201);
  const tok = (
    await http
      .post(`/workspaces/${ws.body.workspace.id}/token`)
      .set(auth(su.body.identityToken))
      .expect(200)
  ).body.accessToken as string;
  const space = (
    await http.post("/spaces").set(auth(tok)).send({ name: "Delivery" }).expect(201)
  ).body.space.id as string;
  const list = (
    await http.post(`/spaces/${space}/lists`).set(auth(tok)).send({ name: "Sprint" }).expect(201)
  ).body.list.id as string;
  const task = (
    await http.post(`/lists/${list}/tasks`).set(auth(tok)).send({ name: "Ship feature" }).expect(201)
  ).body.task.id as string;
  return { tok, space, list, task };
}

async function getTask(tok: string, id: string) {
  return (await http.get(`/tasks/${id}`).set(auth(tok)).expect(200)).body.task;
}

describe("Copilot Do (operator)", () => {
  it("executes set_status, set_assignees, add_comment on a real task", async () => {
    const { tok, task } = await setup();
    const me = (await http.get("/ai/build/context").set(auth(tok)).expect(200)).body
      .members[0];

    const res = await http
      .post("/ai/do")
      .set(auth(tok))
      .send({
        operations: [
          { type: "set_status", summary: "Move to In Progress", taskId: task, statusName: "In Progress" },
          { type: "set_assignees", summary: "Assign to me", taskId: task, assigneeIds: [me.id] },
          { type: "add_comment", summary: "Note it", taskId: task, body: "Kicking this off." },
          { type: "set_priority", summary: "Bump priority", taskId: task, priority: "high" },
        ],
      })
      .expect(201);

    expect(res.body.applied).toBe(4);
    expect(res.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);

    const detail = await getTask(tok, task);
    expect(detail.status.type).toBe("active"); // In Progress
    expect(detail.priority).toBe("high");
    expect(detail.assignees.map((a: { id: string }) => a.id)).toContain(me.id);
  });

  it("refuses operations that reference tasks outside the visible snapshot", async () => {
    const a = await setup();
    const b = await setup(); // a different workspace + user

    // User A tries to act on User B's task id.
    const res = await http
      .post("/ai/do")
      .set(auth(a.tok))
      .send({
        operations: [
          { type: "set_status", summary: "hack", taskId: b.task, statusName: "Done" },
        ],
      })
      .expect(201);
    // Validation drops the unknown task id → nothing applied.
    expect(res.body.applied).toBe(0);

    // B's task is untouched.
    const bTask = await getTask(b.tok, b.task);
    expect(bTask.status.type).not.toBe("done");
  });

  it("rejects an empty operations payload", async () => {
    const { tok } = await setup();
    await http.post("/ai/do").set(auth(tok)).send({ operations: [] }).expect(400);
  });

  it("plan without an AI key returns no operations (heuristic)", async () => {
    const { tok } = await setup();
    const res = await http
      .post("/ai/do/plan")
      .set(auth(tok))
      .send({ command: "reassign overdue tasks" })
      .expect(201);
    expect(res.body.source).toBe("heuristic");
    expect(res.body.operations).toEqual([]);
  });
});
