import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  EmailService,
  type BrandedMessage,
  type EmailMessage,
  type SendMeta,
} from "../src/comms/email.service";
import { brandedText, renderBrandedEmail } from "../src/comms/email.template";
import {
  NotificationMailerService,
  digestCutoff,
} from "../src/comms/notification-mailer.service";

/**
 * The email suite, end to end: invites, assignment and @mention emails,
 * reminders when due, batching, the daily summary, each person's on / summary /
 * off choice, the daily cap, and a relay that is down. The relay is a fake
 * that captures each message; the sender is driven one pass at a time and
 * limited to the test's own workspace, since suites share one database.
 */

interface Captured extends EmailMessage {
  meta?: SendMeta;
}
const sent: Captured[] = [];
let relayDown = false;

class FakeEmail {
  providerName() {
    return "fake";
  }
  configured() {
    return true;
  }
  async send(msg: EmailMessage, meta?: SendMeta) {
    if (relayDown) return { ok: false, provider: "fake", detail: "relay responded 503" };
    sent.push({ ...msg, meta });
    return { ok: true, provider: "fake", detail: "captured" };
  }
  async sendTest(to: string) {
    return this.send({ to, subject: "t", text: "t" });
  }
  async sendBranded(msg: BrandedMessage, meta?: SendMeta) {
    const { to, subject, ...fields } = msg;
    return this.send(
      { to, subject, text: brandedText(fields), html: renderBrandedEmail(fields) },
      meta,
    );
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;
let mailer: NotificationMailerService;
const pool = new Pool({ connectionString: process.env.APP_DB_URL });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useClass(FakeEmail)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());
  mailer = app.get(NotificationMailerService);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const uniqueEmail = () => `en${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const to = (email: string) => sent.filter((m) => m.to === email);

async function signup(fullName = "Bob Mwangi") {
  const email = uniqueEmail();
  const res = await http
    .post("/auth/signup")
    .send({ email, fullName, password: "password123" })
    .expect(201);
  return { email, identityToken: res.body.identityToken as string, userId: res.body.user.id as string };
}

async function fixture() {
  const owner = await signup("Alice Owner");
  const ws = await http
    .post("/workspaces")
    .set(auth(owner.identityToken))
    .send({ name: "Mail WS" })
    .expect(201);
  const workspaceId = ws.body.workspace.id as string;
  const tok = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(owner.identityToken))
    .expect(200);
  const access = tok.body.accessToken as string;
  const space = await http.post("/spaces").set(auth(access)).send({ name: "S" }).expect(201);
  const list = await http
    .post(`/spaces/${space.body.space.id}/lists`)
    .set(auth(access))
    .send({ name: "L" })
    .expect(201);
  const listId = list.body.list.id as string;
  const task = await http
    .post(`/lists/${listId}/tasks`)
    .set(auth(access))
    .send({ name: "Fix the roof" })
    .expect(201);
  return { owner, workspaceId, access, listId, taskId: task.body.task.id as string };
}

async function join(f: { access: string; workspaceId: string }, member: { email: string; identityToken: string }) {
  await http
    .post("/workspaces/current/members")
    .set(auth(f.access))
    .send({ email: member.email, role: "member" })
    .expect(201);
  const tok = await http
    .post(`/workspaces/${f.workspaceId}/token`)
    .set(auth(member.identityToken))
    .expect(200);
  return tok.body.accessToken as string;
}

async function newTask(f: { access: string; listId: string }, name: string) {
  const t = await http.post(`/lists/${f.listId}/tasks`).set(auth(f.access)).send({ name }).expect(201);
  return t.body.task.id as string;
}

async function assign(access: string, taskId: string, userId: string) {
  await http.post(`/tasks/${taskId}/assignees`).set(auth(access)).send({ userId }).expect(201);
}

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const run = (f: { workspaceId: string }, now?: Date) => mailer.runOnce({ only: [f.workspaceId], now });
/** A moment after tomorrow's summary time. */
const tomorrowAfterDigest = () => {
  const c = digestCutoff(new Date(), 4);
  return new Date(c.getTime() + 24 * 3600_000 + 60_000);
};

describe("invites", () => {
  it("emails a new person a link that sets their password, and it works", async () => {
    const f = await fixture();
    const email = uniqueEmail();
    await http
      .post("/workspaces/current/members")
      .set(auth(f.access))
      .send({ email, role: "member" })
      .expect(201);
    const msg = await waitFor(() => to(email)[0]);
    expect(msg.subject).toBe("Alice Owner invited you to Mail WS on StackUp");
    expect(msg.meta?.kind).toBe("invite");
    expect(msg.html).toContain("Accept and set your password");
    const token = msg.text.match(/\/reset\?token=([a-f0-9]+)&invite=1/)?.[1];
    expect(token).toBeDefined();
    expect(msg.text).toContain("https://stackup.smp.co.ke/reset?token=");

    await http.post("/auth/reset-password").send({ token, password: "newpassword9" }).expect(200);
    await http.post("/auth/login").send({ email, password: "newpassword9" }).expect(200);
    // Single use.
    await http.post("/auth/reset-password").send({ token, password: "another1234" }).expect(400);
  });

  it("tells someone who already uses StackUp, without a password link", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f, bob);
    const msg = await waitFor(() => to(bob.email)[0]);
    expect(msg.subject).toContain("invited you to Mail WS");
    expect(msg.text).not.toContain("/reset?token=");
    expect(msg.text).toContain("https://stackup.smp.co.ke/login");
  });
});

describe("assignments and mentions", () => {
  it("emails an assignment once, with a link to the task; self-assign stays quiet", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f, bob);
    const before = to(bob.email).length; // the invite
    await assign(f.access, f.taskId, bob.userId);
    await assign(f.access, f.taskId, f.owner.userId); // self
    await run(f);
    const mails = to(bob.email).slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Alice Owner assigned you “Fix the roof”");
    expect(mails[0].meta).toEqual({ kind: "assigned", userId: bob.userId });
    expect(mails[0].text).toContain(`https://stackup.smp.co.ke/list?id=${f.listId}&task=${f.taskId}`);
    expect(mails[0].html).toContain("https://stackup.smp.co.ke/settings"); // email settings link
    expect(to(f.owner.email).filter((m) => m.meta?.kind === "assigned")).toHaveLength(0);

    await run(f);
    expect(to(bob.email).slice(before)).toHaveLength(1);
  });

  it("emails an @mention with the comment, names in place of tokens", async () => {
    const f = await fixture();
    const bob = await signup("Bob Mwangi");
    await join(f, bob);
    const before = to(bob.email).length;
    await http
      .post(`/tasks/${f.taskId}/comments`)
      .set(auth(f.access))
      .send({ body: `@[${bob.userId}] can you check the gutters too?` })
      .expect(201);
    await run(f);
    const [m] = to(bob.email).slice(before);
    expect(m.subject).toBe("Alice Owner mentioned you on “Fix the roof”");
    expect(m.text).toContain("“@Bob Mwangi can you check the gutters too?”");
    expect(m.meta?.kind).toBe("mention");
  });

  it("puts several updates in the same minute into one email", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f, bob);
    const before = to(bob.email).length;
    await assign(f.access, f.taskId, bob.userId);
    await assign(f.access, await newTask(f, "Paint the gate"), bob.userId);
    await assign(f.access, await newTask(f, "Order cement"), bob.userId);
    await run(f);
    const mails = to(bob.email).slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("3 new updates for you in Mail WS");
    expect(mails[0].text).toContain("• Alice Owner assigned you a task — “Paint the gate”");
  });

  it("does not email what was already read in the app", async () => {
    const f = await fixture();
    const bob = await signup();
    const bobAccess = await join(f, bob);
    const before = to(bob.email).length;
    await assign(f.access, f.taskId, bob.userId);
    await http.post("/notifications/read-all").set(auth(bobAccess)).expect(200);
    await run(f);
    expect(to(bob.email).slice(before)).toHaveLength(0);
  });

  it("comments and chat stay in the inbox only", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f, bob);
    await assign(f.access, f.taskId, bob.userId);
    await run(f);
    const before = to(bob.email).length;
    await http.post(`/tasks/${f.taskId}/comments`).set(auth(f.access)).send({ body: "Done?" }).expect(201);
    await run(f);
    expect(to(bob.email).slice(before)).toHaveLength(0);
  });
});

describe("reminders", () => {
  it("emails a reminder when it comes due, once; not before, not when done", async () => {
    const f = await fixture();
    const before = to(f.owner.email).length;
    const past = new Date(Date.now() - 30_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    await http
      .post("/reminders")
      .set(auth(f.access))
      .send({ note: "Call the plumber", remindAt: past, taskId: f.taskId })
      .expect(201);
    await http.post("/reminders").set(auth(f.access)).send({ note: "Later thing", remindAt: future }).expect(201);
    const done = await http
      .post("/reminders")
      .set(auth(f.access))
      .send({ note: "Already handled", remindAt: past })
      .expect(201);
    await http.patch(`/reminders/${done.body.id ?? done.body.reminder?.id}`).set(auth(f.access)).send({ done: true });

    await run(f);
    await run(f);
    const mails = to(f.owner.email).slice(before);
    expect(mails.map((m) => m.subject)).toEqual(["Reminder: Call the plumber"]);
    expect(mails[0].text).toContain("On “Fix the roof” in Mail WS.");
    expect(mails[0].text).toContain(`/list?id=${f.listId}&task=${f.taskId}`);
  });
});

describe("each person's choice", () => {
  it("rejects a value that is not instant, digest or off", async () => {
    const bob = await signup();
    await http.patch("/auth/me/email").set(auth(bob.identityToken)).send({ emailNotify: "hourly" }).expect(400);
    const r = await http.get("/auth/me/email").set(auth(bob.identityToken)).expect(200);
    expect(r.body).toEqual({ emailNotify: "instant", deliveryConfigured: true });
  });

  it("digest: nothing now, one summary after the morning cutoff", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f, bob);
    await http.patch("/auth/me/email").set(auth(bob.identityToken)).send({ emailNotify: "digest" }).expect(200);
    const before = to(bob.email).length;
    await assign(f.access, f.taskId, bob.userId);
    await assign(f.access, await newTask(f, "Sweep"), bob.userId);
    await run(f);
    expect(to(bob.email).slice(before)).toHaveLength(0);

    await run(f, tomorrowAfterDigest());
    const mails = to(bob.email).slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Your StackUp summary: 2 updates in Mail WS");
    expect(mails[0].meta?.kind).toBe("digest");

    await run(f, tomorrowAfterDigest());
    expect(to(bob.email).slice(before)).toHaveLength(1);
  });

  it("digest people still get reminders on time", async () => {
    const f = await fixture();
    await http
      .patch("/auth/me/email")
      .set(auth(f.owner.identityToken))
      .send({ emailNotify: "digest" })
      .expect(200);
    const before = to(f.owner.email).length;
    await http
      .post("/reminders")
      .set(auth(f.access))
      .send({ note: "Standup", remindAt: new Date(Date.now() - 1000).toISOString() })
      .expect(201);
    await run(f);
    expect(to(f.owner.email).slice(before).map((m) => m.subject)).toEqual(["Reminder: Standup"]);
  });

  it("off: no notification email at all, but invites still arrive", async () => {
    const f = await fixture();
    const bob = await signup();
    await http.patch("/auth/me/email").set(auth(bob.identityToken)).send({ emailNotify: "off" }).expect(200);
    await join(f, bob);
    await waitFor(() => to(bob.email).find((m) => m.meta?.kind === "invite"));
    const before = to(bob.email).length;
    await assign(f.access, f.taskId, bob.userId);
    await run(f);
    await run(f, tomorrowAfterDigest());
    expect(to(bob.email).slice(before)).toHaveLength(0);
  });
});

describe("limits and failures", () => {
  it("past the daily cap, updates wait for the summary instead", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f, bob);
    const before = to(bob.email).length;
    const cap = 200; // EMAIL_DAILY_CAP default
    await pool.query(
      "INSERT INTO email_sends (kind) SELECT 'cap-test' FROM generate_series(1, $1)",
      [cap],
    );
    try {
      await assign(f.access, f.taskId, bob.userId);
      await run(f);
      expect(to(bob.email).slice(before)).toHaveLength(0);
    } finally {
      await pool.query("DELETE FROM email_sends WHERE kind = 'cap-test'");
    }
    // Room again: it goes in the next summary, not as a late instant email.
    await run(f);
    expect(to(bob.email).slice(before)).toHaveLength(0);
    await run(f, tomorrowAfterDigest());
    const mails = to(bob.email).slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0].meta?.kind).toBe("digest");
    expect(mails[0].text).toContain("allowance for the day ran out");
  });

  it("when the relay is down, nothing is lost: it goes on the next pass", async () => {
    const f = await fixture();
    const bob = await signup();
    await join(f, bob);
    await waitFor(() => to(bob.email)[0]);
    const before = to(bob.email).length;
    await assign(f.access, f.taskId, bob.userId);
    relayDown = true;
    try {
      await run(f);
    } finally {
      relayDown = false;
    }
    expect(to(bob.email).slice(before)).toHaveLength(0);
    await run(f);
    expect(to(bob.email).slice(before).map((m) => m.meta?.kind)).toEqual(["assigned"]);
  });
});

describe("the real EmailService", () => {
  it("posts to the relay with its token, and counts only what the relay accepted", async () => {
    let status = 200;
    const got: { auth?: string; body: Record<string, unknown> }[] = [];
    const relay = createServer((req: IncomingMessage, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        got.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        res.writeHead(status).end("{}");
      });
    });
    await new Promise<void>((r) => relay.listen(0, "127.0.0.1", r));
    const port = (relay.address() as AddressInfo).port;
    const saved = { ...process.env };
    Object.assign(process.env, {
      EMAIL_PROVIDER: "http",
      EMAIL_RELAY_URL: `http://127.0.0.1:${port}/send`,
      EMAIL_RELAY_AUTH: "Bearer relay-token",
      EMAIL_FROM: "StackUp <no-reply@smp.co.ke>",
    });
    const kind = `real-${Date.now()}`;
    const count = async () =>
      (await pool.query("SELECT count(*)::int AS n FROM email_sends WHERE kind = $1", [kind])).rows[0].n;
    try {
      const real = new EmailService({ query: (t: string, p?: unknown[]) => pool.query(t, p) } as never);
      const ok = await real.sendBranded({ to: "x@t.test", subject: "Hi", heading: "Hi", body: "Body" }, { kind });
      expect(ok).toMatchObject({ ok: true, provider: "http" });
      expect(got[0].auth).toBe("Bearer relay-token");
      expect(got[0].body).toMatchObject({ from: "StackUp <no-reply@smp.co.ke>", to: "x@t.test", subject: "Hi" });
      expect(String(got[0].body.html)).toContain("Body");
      expect(await count()).toBe(1);

      status = 503;
      const bad = await real.send({ to: "x@t.test", subject: "Hi", text: "t" }, { kind });
      expect(bad).toMatchObject({ ok: false, detail: "relay responded 503" });
      expect(await count()).toBe(1);
    } finally {
      process.env = saved;
      relay.close();
      await pool.query("DELETE FROM email_sends WHERE kind = $1", [kind]);
    }
  });
});

describe("digestCutoff", () => {
  it("is the latest summary time at or before now", () => {
    expect(digestCutoff(new Date("2026-11-05T03:59:00Z"), 4).toISOString()).toBe("2026-11-04T04:00:00.000Z");
    expect(digestCutoff(new Date("2026-11-05T04:00:00Z"), 4).toISOString()).toBe("2026-11-05T04:00:00.000Z");
    expect(digestCutoff(new Date("2026-11-05T23:00:00Z"), 4).toISOString()).toBe("2026-11-05T04:00:00.000Z");
  });
});
