import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * StackUp App Audit (27 Nov 2026) — the medium/low items the API can prove:
 * M3 no mid-word titles, M4 planned steps nest as subtasks, L3 activity log,
 * L11 distinct Space colors, L14 Copilot answers in bullets with plurals.
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

const uniqueEmail = () => `ml${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function workspace() {
  const s = await http.post("/auth/signup").send({ email: uniqueEmail(), fullName: "Owner", password: "password123" }).expect(201);
  const ws = await http.post("/workspaces").set(auth(s.body.identityToken)).send({ name: "ML" }).expect(201);
  const access = (await http.post(`/workspaces/${ws.body.workspace.id}/token`).set(auth(s.body.identityToken)).expect(200)).body
    .accessToken as string;
  return { access, userId: s.body.user.id as string };
}
async function listIn(access: string) {
  const sp = (await http.post("/spaces").set(auth(access)).send({ name: "S" }).expect(201)).body.space;
  return (await http.post(`/spaces/${sp.id}/lists`).set(auth(access)).send({ name: "L" }).expect(201)).body.list;
}

describe("M3/M4: Copilot's built-in planner", () => {
  it("plans one task named after the brief, with the steps as subtasks", async () => {
    const w = await workspace();
    const brief =
      "Prepare the quarterly report about CIVORA on monday with the finance team and the board members";
    const res = await http.post("/ai/build/plan").set(auth(w.access)).send({ prompt: brief }).expect(201);
    expect(res.body.source).toBe("heuristic");
    const tasks = res.body.plan.targets[0].tasks as { name: string; subtasks?: { name: string }[] }[];
    expect(tasks).toHaveLength(1);
    // Never cut mid-word: either the whole sentence, or whole words + "…".
    const name = tasks[0].name;
    expect(brief.toLowerCase().startsWith(name.replace(/…$/, "").toLowerCase())).toBe(true);
    if (name.endsWith("…")) expect(brief.charAt(name.length - 1)).toBe(" ");
    expect(tasks[0].subtasks?.map((s) => s.name)).toEqual([
      "Define the scope and goals",
      "Agree owners and key dates",
      "Break the work into milestones",
      "Kick off and track progress",
    ]);

    // Building it creates ONE top-level task with four subtasks.
    const built = await http.post("/ai/build").set(auth(w.access)).send({ plan: res.body.plan }).expect(201);
    expect(built.body.counts.tasks).toBe(1);
    const task = (await http.get(`/tasks/${built.body.tasks[0].id}`).set(auth(w.access)).expect(200)).body.task;
    expect(task.subtasks).toHaveLength(4);
  });

  it("the subtask fallback doesn't paste a cut-off task name into each step", async () => {
    const w = await workspace();
    const ls = await listIn(w.access);
    const t = (await http
      .post(`/lists/${ls.id}/tasks`)
      .set(auth(w.access))
      .send({ name: "Write the onboarding email about CIVORA on monday for every new member" })
      .expect(201)).body.task;
    const r = await http.post(`/ai/tasks/${t.id}/subtasks`).set(auth(w.access)).expect(201);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const item of r.body.items as string[]) expect(item).not.toMatch(/CIVORA/);
  });
});

describe("L3: activity log", () => {
  it("re-saving the same dates logs nothing; subtasks and checklists are logged", async () => {
    const w = await workspace();
    const ls = await listIn(w.access);
    const t = (await http.post(`/lists/${ls.id}/tasks`).set(auth(w.access)).send({ name: "T" }).expect(201)).body.task;
    await http.patch(`/tasks/${t.id}`).set(auth(w.access)).send({ dueDate: "2026-12-10" }).expect(200);
    await http.patch(`/tasks/${t.id}`).set(auth(w.access)).send({ dueDate: "2026-12-10" }).expect(200);
    await http.post(`/tasks/${t.id}/subtasks`).set(auth(w.access)).send({ name: "Step one" }).expect(201);
    await http.post(`/tasks/${t.id}/checklists`).set(auth(w.access)).send({ name: "QA" }).expect(201);
    const act = (await http.get(`/tasks/${t.id}/activity`).set(auth(w.access)).expect(200)).body;
    const entries = (act.activity ?? act.entries ?? act) as { kind: string; data: Record<string, unknown> }[];
    expect(entries.filter((e) => e.kind === "dates")).toHaveLength(1);
    expect(entries.find((e) => e.kind === "subtask_added")?.data.name).toBe("Step one");
    expect(entries.find((e) => e.kind === "checklist_added")?.data.name).toBe("QA");
  });
});

describe("L11: Spaces get distinct colors", () => {
  it("the first keeps the brand purple; the next ones differ", async () => {
    const w = await workspace();
    const colors: string[] = [];
    for (const name of ["A", "B", "C"]) {
      colors.push((await http.post("/spaces").set(auth(w.access)).send({ name }).expect(201)).body.space.color);
    }
    expect(colors[0]).toBe("#7B68EE");
    expect(new Set(colors).size).toBe(3);
    // A chosen color is respected.
    const own = (await http.post("/spaces").set(auth(w.access)).send({ name: "D", color: "#123456" }).expect(201)).body.space;
    expect(own.color).toBe("#123456");
  });
});

describe("L14: Copilot basic-mode answers", () => {
  it("uses bullets and real plurals", async () => {
    const w = await workspace();
    const ls = await listIn(w.access);
    await http.post(`/lists/${ls.id}/tasks`).set(auth(w.access)).send({ name: "Only task" }).expect(201);
    const r = await http.post("/ai/ask").set(auth(w.access)).send({ question: "How are we doing?" });
    expect([200, 201]).toContain(r.status);
    const answer = r.body.answer as string;
    expect(answer).not.toMatch(/\(s\)/);
    expect(answer).toMatch(/^- 1 open task$/m);
  });
});
