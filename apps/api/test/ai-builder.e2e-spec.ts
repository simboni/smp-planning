import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * AI Builder (M15) — brief → preview plan → execute. Runs the heuristic path
 * (no ANTHROPIC_API_KEY in tests) so it's deterministic; the executor is the
 * same for the Claude path. Verifies that a plan creates real spaces/lists/
 * tasks and that a plan with no spaces is rejected.
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

describe("AI Builder", () => {
  let token: string;

  beforeAll(async () => {
    const me = await signup();
    const ws = await createWorkspaceWithToken(me.identityToken, "AI Build WS");
    token = ws.accessToken;
  });

  it("plans a structure from a brief (no writes)", async () => {
    const res = await http
      .post("/ai/build/plan")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "Plan a product launch with marketing and dev tasks" })
      .expect(201);
    expect(res.body.source).toBe("heuristic");
    expect(Array.isArray(res.body.plan.spaces)).toBe(true);
    expect(res.body.plan.spaces.length).toBeGreaterThan(0);
    expect(res.body.plan.spaces[0].lists.length).toBeGreaterThan(0);
  });

  it("rejects an empty prompt", async () => {
    await http
      .post("/ai/build/plan")
      .set("Authorization", `Bearer ${token}`)
      .send({ prompt: "  " })
      .expect(400);
  });

  it("builds a plan into real spaces, lists and tasks", async () => {
    const plan = {
      summary: "Test plan",
      spaces: [
        {
          name: "Launch",
          icon: "🚀",
          lists: [
            {
              name: "Marketing",
              tasks: [
                { name: "Write launch post", priority: "high", dueInDays: 3 },
                { name: "Design social assets" },
              ],
            },
            { name: "Engineering", tasks: [{ name: "Ship feature flag" }] },
          ],
          docs: [{ name: "Launch brief", content: "The plan." }],
        },
      ],
    };

    const res = await http
      .post("/ai/build")
      .set("Authorization", `Bearer ${token}`)
      .send({ plan })
      .expect(201);

    expect(res.body.counts.spaces).toBe(1);
    expect(res.body.counts.lists).toBe(2);
    expect(res.body.counts.tasks).toBe(3);
    expect(res.body.counts.docs).toBe(1);
    expect(res.body.spaces[0].name).toBe("Launch");
    expect(res.body.spaces[0].url).toContain("/space?id=");

    // The created space is really there.
    const spaceId = res.body.spaces[0].id as string;
    const check = await http
      .get(`/spaces/${spaceId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(check.body.space.name).toBe("Launch");
  });

  it("rejects a plan with no spaces", async () => {
    await http
      .post("/ai/build")
      .set("Authorization", `Bearer ${token}`)
      .send({ plan: { summary: "x", spaces: [] } })
      .expect(400);
  });
});
