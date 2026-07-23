import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AiProvider } from "../src/ai/ai.provider";

/**
 * Foundation F1 — structured outputs. CI has no ANTHROPIC_API_KEY, so we stand
 * in a fake AiProvider whose completeJson() returns a canned, schema-shaped
 * object (as the real forced-tool call would). This proves the new path:
 * completeJson → normalizePlan/normalizeForm (validating ids against the live
 * workspace) → build, and that `source` reports 'claude'. complete() returns
 * null so ONLY the structured path can succeed.
 */

class FakeAi {
  available() {
    return true;
  }
  model() {
    return "claude-test";
  }
  async complete() {
    return null; // force the structured path to be the one that works
  }
  async completeJson(_system: string, _prompt: string, schema: Record<string, unknown>) {
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    if ("answer" in props) {
      return { answer: "Nothing is blocking it right now.", usedRefs: [] };
    }
    if ("targets" in props) {
      return {
        summary: "Structured plan",
        targets: [
          {
            space: { create: true, name: "Operations", icon: "⚙️" },
            list: { create: true, name: "Onboarding" },
            tasks: [
              { name: "Draft the runbook", priority: "high", dueInDays: 5 },
              { name: "Schedule kickoff" },
            ],
          },
        ],
      };
    }
    if ("fields" in props) {
      return {
        name: "Signup survey",
        description: "Tell us about you.",
        fields: [
          { label: "Your name", type: "text", asTitle: true },
          { label: "Role", type: "select", options: ["Eng", "Design"], required: true },
        ],
      };
    }
    return null;
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiProvider)
    .useClass(FakeAi)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
});

const email = () => `u${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function token() {
  const su = await http
    .post("/auth/signup")
    .send({ email: email(), fullName: "Struct User", password: "password123" })
    .expect(201);
  const ws = await http
    .post("/workspaces")
    .set(auth(su.body.identityToken))
    .send({ name: "Struct WS" })
    .expect(201);
  const tok = await http
    .post(`/workspaces/${ws.body.workspace.id}/token`)
    .set(auth(su.body.identityToken))
    .expect(200);
  return tok.body.accessToken as string;
}

describe("AI structured outputs", () => {
  let t: string;
  beforeAll(async () => {
    t = await token();
  });

  it("plans via structured output (source=claude) and builds it", async () => {
    const res = await http
      .post("/ai/build/plan")
      .set(auth(t))
      .send({ prompt: "set up ops onboarding" })
      .expect(201);
    expect(res.body.source).toBe("claude");
    expect(res.body.plan.summary).toBe("Structured plan");
    expect(res.body.plan.targets).toHaveLength(1);
    expect(res.body.plan.targets[0].space.create).toBe(true);
    expect(res.body.plan.targets[0].tasks).toHaveLength(2);
    expect(res.body.plan.targets[0].tasks[0].priority).toBe("high");

    const built = await http
      .post("/ai/build")
      .set(auth(t))
      .send({ plan: res.body.plan })
      .expect(201);
    expect(built.body.counts.spacesCreated).toBe(1);
    expect(built.body.counts.listsCreated).toBe(1);
    expect(built.body.counts.tasks).toBe(2);
  });

  it("drafts a form via structured output (source=claude)", async () => {
    const res = await http
      .post("/ai/form/plan")
      .set(auth(t))
      .send({ prompt: "signup survey" })
      .expect(201);
    expect(res.body.source).toBe("claude");
    expect(res.body.form.name).toBe("Signup survey");
    expect(res.body.form.fields).toHaveLength(2);
    expect(res.body.form.fields[1].type).toBe("select");
  });

  it("answers a question grounded in the workspace (Ask)", async () => {
    const res = await http
      .post("/ai/ask")
      .set(auth(t))
      .send({ question: "what is blocking the launch?" })
      .expect(201);
    expect(res.body.source).toBe("claude");
    expect(typeof res.body.answer).toBe("string");
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.sources)).toBe(true);
  });

  it("rejects an empty Ask question", async () => {
    await http.post("/ai/ask").set(auth(t)).send({ question: "  " }).expect(400);
  });

  it("parses a command via structured output", async () => {
    // completeJson is schema-driven; the command schema has no targets/fields,
    // so the fake returns null and the deterministic heuristic takes over —
    // proving the fallback chain stays intact.
    const res = await http
      .post("/ai/command")
      .set(auth(t))
      .send({ text: "create a task called Ship it" })
      .expect(201);
    expect(res.body.command.intent).toBe("create_task");
  });
});
