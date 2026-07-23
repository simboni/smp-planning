import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * AI Builder (M15) — placement-aware task/space/list building + form drafting.
 * Runs the heuristic path (no ANTHROPIC_API_KEY in tests) so it's
 * deterministic; the executor is shared with the Claude path. Verifies that a
 * plan can (a) create a new space+list, (b) target an EXISTING list, and that
 * the form builder creates a form into a chosen list.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
});

const uniqueEmail = () =>
  `u${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;

async function signup(email = uniqueEmail(), password = "password123") {
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName: "Test User", password })
    .expect(201);
  return { email, password, ...res.body };
}

async function createWorkspaceWithToken(identityToken: string, name: string) {
  const created = await http
    .post("/workspaces")
    .set("Authorization", `Bearer ${identityToken}`)
    .send({ name })
    .expect(201);
  const workspaceId = created.body.workspace.id as string;
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set("Authorization", `Bearer ${identityToken}`)
    .expect(200);
  return { workspaceId, accessToken: tokenRes.body.accessToken as string };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("AI Builder", () => {
  let token: string;

  beforeAll(async () => {
    const me = await signup();
    const ws = await createWorkspaceWithToken(me.identityToken, "AI Build WS");
    token = ws.accessToken;
  });

  it("plans placement + returns editable workspace context", async () => {
    const res = await http
      .post("/ai/build/plan")
      .set(auth(token))
      .send({ prompt: "Plan a product launch with marketing and dev tasks" })
      .expect(201);
    expect(res.body.source).toBe("heuristic");
    expect(Array.isArray(res.body.plan.targets)).toBe(true);
    expect(res.body.plan.targets.length).toBeGreaterThan(0);
    expect(res.body.context).toBeDefined();
    expect(Array.isArray(res.body.context.spaces)).toBe(true);
    // First-time workspace: no matching place → proposes a new space.
    const target = res.body.plan.targets[0];
    expect(target.space.create).toBe(true);
    expect(target.list.create).toBe(true);
  });

  it("rejects an empty prompt", async () => {
    await http
      .post("/ai/build/plan")
      .set(auth(token))
      .send({ prompt: "  " })
      .expect(400);
  });

  it("builds a new space + list + tasks", async () => {
    const plan = {
      summary: "Launch",
      targets: [
        {
          space: { create: true, name: "Launch", icon: "🚀" },
          list: { create: true, name: "Marketing" },
          tasks: [
            { name: "Write launch post", priority: "high", dueInDays: 3 },
            { name: "Design social assets" },
          ],
          docs: [{ name: "Launch brief", content: "The plan." }],
        },
      ],
    };
    const res = await http
      .post("/ai/build")
      .set(auth(token))
      .send({ plan })
      .expect(201);
    expect(res.body.counts.spacesCreated).toBe(1);
    expect(res.body.counts.listsCreated).toBe(1);
    expect(res.body.counts.tasks).toBe(2);
    expect(res.body.counts.docs).toBe(1);
    expect(res.body.spaces[0].created).toBe(true);
    expect(res.body.spaces[0].url).toContain("/space?id=");
  });

  it("adds tasks to an EXISTING list (no new space)", async () => {
    // Build a target, then read context to get its list id.
    const ctx = await http.get("/ai/build/context").set(auth(token)).expect(200);
    const space = ctx.body.spaces.find((s: { name: string }) => s.name === "Launch");
    expect(space).toBeDefined();
    const list = space.lists.find((l: { name: string }) => l.name === "Marketing");
    expect(list).toBeDefined();

    const plan = {
      summary: "More tasks",
      targets: [
        {
          space: { existingId: space.id },
          list: { existingId: list.id },
          tasks: [{ name: "Schedule the announcement" }],
        },
      ],
    };
    const res = await http
      .post("/ai/build")
      .set(auth(token))
      .send({ plan })
      .expect(201);
    // Nothing new created — the task landed in the existing list.
    expect(res.body.counts.spacesCreated).toBe(0);
    expect(res.body.counts.listsCreated).toBe(0);
    expect(res.body.counts.tasks).toBe(1);
    expect(res.body.tasks[0].listId).toBe(list.id);
  });

  it("rejects a plan with no targets", async () => {
    await http
      .post("/ai/build")
      .set(auth(token))
      .send({ plan: { summary: "x", targets: [] } })
      .expect(400);
  });

  it("drafts and builds a form into a chosen list", async () => {
    const draft = await http
      .post("/ai/form/plan")
      .set(auth(token))
      .send({ prompt: "Feedback form about project management apps" })
      .expect(201);
    expect(draft.body.source).toBe("heuristic");
    expect(Array.isArray(draft.body.form.fields)).toBe(true);
    expect(draft.body.form.fields.length).toBeGreaterThan(0);

    const built = await http
      .post("/ai/form")
      .set(auth(token))
      .send({
        form: draft.body.form,
        space: { create: true, name: "Research" },
        list: { create: true, name: "User Feedback" },
      })
      .expect(201);
    expect(typeof built.body.formId).toBe("string");
    expect(built.body.publicToken).toHaveLength(32);
    expect(built.body.fieldCount).toBeGreaterThan(0);

    // The form is really there and listed.
    const forms = await http.get("/forms").set(auth(token)).expect(200);
    expect(
      forms.body.forms.some((f: { id: string }) => f.id === built.body.formId),
    ).toBe(true);
  });
});
