import { INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PageNotFoundFilter } from "../src/common/page-not-found.filter";
import { isOverdue, localDateKey, shiftDateKey } from "../src/common/dates";
import { EventsService } from "../src/events/events.service";

/**
 * StackUp App Audit (27 Nov 2026) — the high-priority items the API can prove:
 * H2 branded 404, H3 owner vs plan gate, H4 paid plans not self-selectable,
 * H5 refresh cookie + one-time stream tickets, H6 one overdue rule.
 */

let app: INestApplication;
let http: ReturnType<typeof request>;
const notFoundHtml = join(mkdtempSync(join(tmpdir(), "su404-")), "404.html");
writeFileSync(notFoundHtml, "<!doctype html><title>Page not found</title><h1>Page not found</h1>");

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new PageNotFoundFilter(notFoundHtml, app.get(HttpAdapterHost).httpAdapter));
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () => `au${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function owner() {
  const email = uniqueEmail();
  const s = await http.post("/auth/signup").send({ email, fullName: "Owner", password: "password123" }).expect(201);
  const ws = await http.post("/workspaces").set(auth(s.body.identityToken)).send({ name: "Audit" }).expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const access = (await http.post(`/workspaces/${workspaceId}/token`).set(auth(s.body.identityToken)).expect(200)).body
    .accessToken as string;
  return { email, workspaceId, access };
}
function cookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("stackup_rt="));
}

describe("H2: unknown addresses", () => {
  it("a browser gets the branded 404 page, not raw JSON", async () => {
    const r = await http.get("/this-page-does-not-exist").set("Accept", "text/html,*/*").expect(404);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.text).toContain("Page not found");
  });
  it("API callers still get JSON, and real API 404s are untouched", async () => {
    const r = await http.get("/this-page-does-not-exist").expect(404);
    expect(r.body).toMatchObject({ statusCode: 404 });
    const o = await owner();
    const t = await http
      .get("/tasks/00000000-0000-0000-0000-000000000000")
      .set(auth(o.access))
      .set("Accept", "text/html")
      .expect(404);
    expect(t.headers["content-type"]).toMatch(/json/);
  });
});

describe("H3: audit log", () => {
  it("the owner is refused by the plan, not by permissions", async () => {
    const o = await owner();
    const caps = await http.get("/governance/me").set(auth(o.access)).expect(200);
    expect(caps.body.capabilities.viewAuditLog).toBe(true);
    const r = await http.get("/audit").set(auth(o.access)).expect(403);
    expect(r.body.message).toMatch(/plan/i);
  });
});

describe("H4: plans", () => {
  const saved = process.env.PLAN_SELF_SERVE;
  afterEach(() => {
    if (saved === undefined) delete process.env.PLAN_SELF_SERVE;
    else process.env.PLAN_SELF_SERVE = saved;
  });
  it("without billing, an owner can't switch to a paid plan (Free is fine)", async () => {
    process.env.PLAN_SELF_SERVE = "false";
    const o = await owner();
    const plans = await http.get("/plans").set(auth(o.access)).expect(200);
    expect(plans.body.selfServe).toBe(false);
    await http.post("/plans/select").set(auth(o.access)).send({ plan: "business" }).expect(403);
    await http.post("/plans/select").set(auth(o.access)).send({ plan: "free" }).expect(200);
    expect((await http.get("/plans").set(auth(o.access))).body.current).toBe("free");
  });
  it("branding stays locked on Free", async () => {
    const o = await owner();
    await http.patch("/workspaces/current").set(auth(o.access)).send({ color: "#FF0000" }).expect(403);
    await http.patch("/workspaces/current").set(auth(o.access)).send({ name: "Renamed" }).expect(200);
  });
});

describe("H5: refresh token in an httpOnly cookie", () => {
  it("web sign-in sets the cookie and keeps the token out of the body", async () => {
    const email = uniqueEmail();
    await http.post("/auth/signup").send({ email, fullName: "Web", password: "password123" }).expect(201);
    const login = await http
      .post("/auth/login")
      .set("X-Auth-Cookie", "1")
      .send({ email, password: "password123" })
      .expect(200);
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.body.identityToken).toBeTruthy();
    const cookie = cookieFrom(login)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/auth/);

    // Refresh from the cookie alone: rotated, still not in the body.
    const pair = cookie.split(";")[0];
    const r1 = await http.post("/auth/refresh").set("Cookie", pair).send({}).expect(200);
    expect(r1.body.refreshToken).toBeUndefined();
    const next = cookieFrom(r1)!.split(";")[0];
    expect(next).not.toBe(pair);
    // The old cookie was rotated away.
    await http.post("/auth/refresh").set("Cookie", pair).send({}).expect(401);

    // Sessions flags this device from the cookie.
    const sess = await http.get("/auth/sessions").set(auth(r1.body.identityToken)).set("Cookie", next).expect(200);
    expect(sess.body.sessions.some((s: { current: boolean }) => s.current)).toBe(true);

    // Logout revokes it and clears the cookie.
    const out = await http.post("/auth/logout").set("Cookie", next).send({}).expect(204);
    expect(cookieFrom(out)).toMatch(/stackup_rt=;/);
    await http.post("/auth/refresh").set("Cookie", next).send({}).expect(401);
  });

  it("the installed app (no opt-in header) still gets the token in the body", async () => {
    const email = uniqueEmail();
    await http.post("/auth/signup").send({ email, fullName: "App", password: "password123" }).expect(201);
    const login = await http.post("/auth/login").send({ email, password: "password123" }).expect(200);
    expect(typeof login.body.refreshToken).toBe("string");
    expect(cookieFrom(login)).toBeUndefined();
    const r = await http.post("/auth/refresh").send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(typeof r.body.refreshToken).toBe("string");
  });

  it("an old web session moves its stored token into the cookie on refresh", async () => {
    const email = uniqueEmail();
    const s = await http.post("/auth/signup").send({ email, fullName: "Old", password: "password123" }).expect(201);
    const r = await http
      .post("/auth/refresh")
      .set("X-Auth-Cookie", "1")
      .send({ refreshToken: s.body.refreshToken })
      .expect(200);
    expect(r.body.refreshToken).toBeUndefined();
    expect(cookieFrom(r)).toMatch(/HttpOnly/i);
  });
});

describe("H5: live updates use one-time tickets", () => {
  it("issues a ticket for the access token; tickets work once", async () => {
    const o = await owner();
    const t = await http.post("/events/ticket").set(auth(o.access)).expect(200);
    expect(typeof t.body.ticket).toBe("string");
    await http.post("/events/ticket").expect(401);
    await http.get("/events/stream?ticket=not-a-ticket").expect(401);
    const events = app.get(EventsService);
    expect(events.redeemTicket(t.body.ticket)).toMatchObject({ workspaceId: o.workspaceId });
    expect(events.redeemTicket(t.body.ticket)).toBeNull();
  });
});

describe("H6: one overdue rule", () => {
  it("due today is not overdue; yesterday is; done never is", () => {
    const today = localDateKey();
    const yesterday = shiftDateKey(today, -1);
    expect(isOverdue(`${today}T00:00:00Z`, false)).toBe(false);
    expect(isOverdue(`${yesterday}T00:00:00Z`, false)).toBe(true);
    expect(isOverdue(`${yesterday}T00:00:00Z`, true)).toBe(false);
    expect(isOverdue(null, false)).toBe(false);
  });

  it("My Work puts a task due today under Due today, not Overdue", async () => {
    const o = await owner();
    const me = (await http.get("/auth/me").set(auth(o.access))).body.user ?? null;
    const sp = (await http.post("/spaces").set(auth(o.access)).send({ name: "S" }).expect(201)).body.space;
    const ls = (await http.post(`/spaces/${sp.id}/lists`).set(auth(o.access)).send({ name: "L" }).expect(201)).body.list;
    const today = localDateKey();
    const yesterday = shiftDateKey(today, -1);
    const mk = async (name: string, dueDate: string) => {
      const t = (await http.post(`/lists/${ls.id}/tasks`).set(auth(o.access)).send({ name, dueDate }).expect(201)).body.task;
      const meId = me?.id ?? (await http.get("/workspaces/current/members").set(auth(o.access))).body.members[0].id;
      await http.post(`/tasks/${t.id}/assignees`).set(auth(o.access)).send({ userId: meId });
      return t;
    };
    await mk("Due today", today);
    await mk("Due yesterday", yesterday);
    const home = (await http.get("/home").set(auth(o.access)).expect(200)).body;
    const names = (xs: { name: string }[]) => xs.map((t) => t.name);
    expect(names(home.dueToday)).toContain("Due today");
    expect(names(home.overdue)).toEqual(["Due yesterday"]);
  });
});
