import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 10 (Dashboards & reporting cards) against the
 * migrated stackup_test database. Same harness as M9: unique emails,
 * supertest, setup.ts; owner signs up, creates a workspace + access token.
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

async function createWorkspaceWithToken(identityToken: string, name: string) {
  const created = await http
    .post("/workspaces")
    .set(auth(identityToken))
    .send({ name })
    .expect(201);
  const workspaceId = created.body.workspace.id as string;
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(identityToken))
    .expect(200);
  return { workspaceId, accessToken: tokenRes.body.accessToken as string };
}

async function ownerWorkspace(name = "M10 WS") {
  const owner = await signup();
  const ws = await createWorkspaceWithToken(owner.identityToken, name);
  return { ...owner, ...ws };
}

async function memberOf(
  ownerToken: string,
  workspaceId: string,
  role: "member" | "admin" | "guest",
) {
  const user = await signup();
  await http
    .post("/workspaces/current/members")
    .set(auth(ownerToken))
    .send({ email: user.email, role })
    .expect(201);
  const tokenRes = await http
    .post(`/workspaces/${workspaceId}/token`)
    .set(auth(user.identityToken))
    .expect(200);
  return { ...user, accessToken: tokenRes.body.accessToken as string };
}

async function makeSpaceAndList(
  token: string,
  spaceBody: Record<string, unknown> = {},
) {
  const space = (
    await http
      .post("/spaces")
      .set(auth(token))
      .send({ name: "Space", ...spaceBody })
      .expect(201)
  ).body.space;
  const list = (
    await http
      .post(`/spaces/${space.id}/lists`)
      .set(auth(token))
      .send({ name: "List" })
      .expect(201)
  ).body.list;
  return { space, list };
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

async function spaceStatuses(token: string, spaceId: string) {
  const res = await http
    .get(`/spaces/${spaceId}/statuses`)
    .set(auth(token))
    .expect(200);
  return res.body.statuses as { id: string; type: string; name: string }[];
}

async function makeDashboard(token: string, name = "Dash") {
  return (
    await http
      .post("/dashboards")
      .set(auth(token))
      .send({ name })
      .expect(201)
  ).body.dashboard;
}

async function makeCard(
  token: string,
  dashboardId: string,
  body: Record<string, unknown>,
) {
  return (
    await http
      .post(`/dashboards/${dashboardId}/cards`)
      .set(auth(token))
      .send(body)
      .expect(201)
  ).body.card;
}

async function cardData(token: string, cardId: string) {
  return (
    await http.get(`/cards/${cardId}/data`).set(auth(token)).expect(200)
  ).body.data;
}

describe("dashboards", () => {
  it("dashboard + card CRUD; text card echoes its config; edit rule enforced", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");

    await http
      .post("/dashboards")
      .set(auth(member.accessToken))
      .send({})
      .expect(400); // name required

    // Any member can create a dashboard.
    const dash = await makeDashboard(member.accessToken, "Team pulse");
    expect(dash.name).toBe("Team pulse");

    const listed = await http
      .get("/dashboards")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(listed.body.dashboards).toEqual([
      {
        id: dash.id,
        name: "Team pulse",
        cardCount: 0,
        updatedAt: expect.any(String),
      },
    ]);

    // Cards: bad kind rejected, then a text card is created and echoed.
    await http
      .post(`/dashboards/${dash.id}/cards`)
      .set(auth(member.accessToken))
      .send({ kind: "pieChart" })
      .expect(400);
    const card = await makeCard(member.accessToken, dash.id, {
      kind: "text",
      title: "Notes",
      config: { text: "hello world" },
      width: "full",
    });
    expect(card).toMatchObject({
      kind: "text",
      title: "Notes",
      width: "full",
      position: 0,
    });
    expect(await cardData(member.accessToken, card.id)).toEqual({
      text: "hello world",
    });

    // A second member is neither creator nor admin -> 403 on edits, but can
    // still VIEW the dashboard and its card data (workspace-wide).
    const other = await memberOf(owner.accessToken, owner.workspaceId, "member");
    await http
      .patch(`/dashboards/${dash.id}`)
      .set(auth(other.accessToken))
      .send({ name: "hijack" })
      .expect(403);
    await http
      .patch(`/cards/${card.id}`)
      .set(auth(other.accessToken))
      .send({ title: "hijack" })
      .expect(403);
    await http
      .delete(`/dashboards/${dash.id}`)
      .set(auth(other.accessToken))
      .expect(403);
    expect(await cardData(other.accessToken, card.id)).toEqual({
      text: "hello world",
    });

    // Creator edits card and dashboard; detail shows the card.
    const patchedCard = await http
      .patch(`/cards/${card.id}`)
      .set(auth(member.accessToken))
      .send({ title: "Readme", width: "half", position: 3, config: { text: "v2" } })
      .expect(200);
    expect(patchedCard.body.card).toMatchObject({
      title: "Readme",
      width: "half",
      position: 3,
    });
    expect(await cardData(member.accessToken, card.id)).toEqual({ text: "v2" });

    const patchedDash = await http
      .patch(`/dashboards/${dash.id}`)
      .set(auth(member.accessToken))
      .send({ name: "Pulse v2" })
      .expect(200);
    expect(patchedDash.body.dashboard.name).toBe("Pulse v2");

    const detail = await http
      .get(`/dashboards/${dash.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.dashboard.name).toBe("Pulse v2");
    expect(detail.body.cards).toHaveLength(1);
    expect(detail.body.cards[0].id).toBe(card.id);

    // An ADMIN (workspace owner) can delete another member's card/dashboard.
    await http
      .delete(`/cards/${card.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .delete(`/dashboards/${dash.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .get(`/dashboards/${dash.id}`)
      .set(auth(owner.accessToken))
      .expect(404);
  });

  it("statusBreakdown counts non-archived tasks by status", async () => {
    const owner = await ownerWorkspace();
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    await makeTask(owner.accessToken, list.id, { name: "A" });
    await makeTask(owner.accessToken, list.id, { name: "B" });
    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;
    await makeTask(owner.accessToken, list.id, { name: "C", statusId: done.id });
    // An archived task never counts.
    const archived = await makeTask(owner.accessToken, list.id, { name: "X" });
    await http
      .patch(`/tasks/${archived.id}`)
      .set(auth(owner.accessToken))
      .send({ archived: true })
      .expect(200);

    const dash = await makeDashboard(owner.accessToken);
    const card = await makeCard(owner.accessToken, dash.id, {
      kind: "statusBreakdown",
      config: { spaceId: space.id },
    });
    const data = await cardData(owner.accessToken, card.id);
    const bySlice = Object.fromEntries(
      data.slices.map((s: { label: string; count: number }) => [
        s.label,
        s.count,
      ]),
    );
    expect(bySlice["To Do"]).toBe(2);
    expect(bySlice["Complete"]).toBe(1);
    expect(
      data.slices.reduce(
        (n: number, s: { count: number }) => n + s.count,
        0,
      ),
    ).toBe(3);
    expect(data.slices[0].color).toEqual(expect.stringMatching(/^#/));
  });

  it("assigneeLoad splits open vs done per assignee", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const { space, list } = await makeSpaceAndList(owner.accessToken);
    await makeTask(owner.accessToken, list.id, {
      name: "A",
      assigneeIds: [member.userId],
    });
    await makeTask(owner.accessToken, list.id, {
      name: "B",
      assigneeIds: [member.userId],
    });
    const statuses = await spaceStatuses(owner.accessToken, space.id);
    const done = statuses.find((s) => s.type === "done")!;
    await makeTask(owner.accessToken, list.id, {
      name: "C",
      assigneeIds: [member.userId],
      statusId: done.id,
    });
    await makeTask(owner.accessToken, list.id, { name: "Unassigned" });

    const dash = await makeDashboard(owner.accessToken);
    const card = await makeCard(owner.accessToken, dash.id, {
      kind: "assigneeLoad",
      config: { listId: list.id },
    });
    const data = await cardData(owner.accessToken, card.id);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toEqual({
      user: {
        id: member.userId,
        fullName: "Test User",
        avatarUrl: null,
      },
      open: 2,
      done: 1,
    });
  });

  it("guests get 403 on the whole dashboards surface", async () => {
    const owner = await ownerWorkspace();
    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");
    const dash = await makeDashboard(owner.accessToken);
    const card = await makeCard(owner.accessToken, dash.id, { kind: "text" });

    await http.get("/dashboards").set(auth(guest.accessToken)).expect(403);
    await http
      .post("/dashboards")
      .set(auth(guest.accessToken))
      .send({ name: "Nope" })
      .expect(403);
    await http
      .get(`/dashboards/${dash.id}`)
      .set(auth(guest.accessToken))
      .expect(403);
    await http
      .get(`/cards/${card.id}/data`)
      .set(auth(guest.accessToken))
      .expect(403);
  });

  it("card data NEVER includes tasks from spaces invisible to the caller", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");

    // Owner: a PRIVATE space with two tasks and a public space with one.
    const { list: privateList } = await makeSpaceAndList(owner.accessToken, {
      name: "Secret",
      isPrivate: true,
    });
    await makeTask(owner.accessToken, privateList.id, { name: "S1" });
    await makeTask(owner.accessToken, privateList.id, { name: "S2" });
    const { list: publicList } = await makeSpaceAndList(owner.accessToken, {
      name: "Open",
    });
    await makeTask(owner.accessToken, publicList.id, { name: "P1" });

    // Unscoped card = "all visible spaces" — visibility is the CALLER's.
    const dash = await makeDashboard(member.accessToken);
    const card = await makeCard(member.accessToken, dash.id, {
      kind: "statusBreakdown",
    });

    const memberData = await cardData(member.accessToken, card.id);
    const memberTotal = memberData.slices.reduce(
      (n: number, s: { count: number }) => n + s.count,
      0,
    );
    expect(memberTotal).toBe(1); // only the public-space task

    const ownerData = await cardData(owner.accessToken, card.id);
    const ownerTotal = ownerData.slices.reduce(
      (n: number, s: { count: number }) => n + s.count,
      0,
    );
    expect(ownerTotal).toBe(3); // owner sees everything

    // A card EXPLICITLY scoped to the private space is empty for the member.
    const scoped = await makeCard(member.accessToken, dash.id, {
      kind: "statusBreakdown",
      config: { listId: privateList.id },
    });
    const scopedData = await cardData(member.accessToken, scoped.id);
    expect(scopedData.slices).toHaveLength(0);
  });
});
