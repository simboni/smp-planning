import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * End-to-end tests for Module 7 (Docs, Wikis & Notepad) against the migrated
 * stackup_test database. Same harness as M5: unique emails, supertest,
 * setup.ts; owner signs up, creates a workspace + access token.
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

async function ownerWorkspace(name = "M7 WS") {
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

const docIds = (res: { body: { docs: { id: string }[] } }) =>
  res.body.docs.map((d) => d.id);

describe("docs", () => {
  it("creates a doc with an auto root page and lists it", async () => {
    const owner = await ownerWorkspace();

    const created = await http
      .post("/docs")
      .set(auth(owner.accessToken))
      .send({ name: "  Handbook  ", icon: "📕" })
      .expect(201);
    const doc = created.body.doc;
    expect(doc.name).toBe("Handbook"); // trimmed
    expect(doc.icon).toBe("📕");
    expect(doc.spaceId).toBeNull();
    expect(doc.spaceName).toBeNull();
    expect(doc.isPrivate).toBe(false);
    expect(doc.createdBy).toBe(owner.userId);
    expect(doc.pageCount).toBe(1);

    // Detail: one root page titled like the doc.
    const detail = await http
      .get(`/docs/${doc.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(detail.body.doc.id).toBe(doc.id);
    expect(detail.body.pages).toHaveLength(1);
    expect(detail.body.pages[0].title).toBe("Handbook");
    expect(detail.body.pages[0].parentPageId).toBeNull();
    expect(detail.body.pages[0].position).toBe(0);

    const listed = await http
      .get("/docs")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(docIds(listed)).toContain(doc.id);

    // Empty name is rejected.
    await http
      .post("/docs")
      .set(auth(owner.accessToken))
      .send({ name: "   " })
      .expect(400);
  });

  it("nests pages under a parent and reorders via PATCH position", async () => {
    const owner = await ownerWorkspace();
    const doc = (
      await http
        .post("/docs")
        .set(auth(owner.accessToken))
        .send({ name: "Wiki" })
        .expect(201)
    ).body.doc;
    const root = (
      await http.get(`/docs/${doc.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.pages[0];

    const pageA = (
      await http
        .post(`/docs/${doc.id}/pages`)
        .set(auth(owner.accessToken))
        .send({ title: "A", parentPageId: root.id })
        .expect(201)
    ).body.page;
    const pageB = (
      await http
        .post(`/docs/${doc.id}/pages`)
        .set(auth(owner.accessToken))
        .send({ title: "B", parentPageId: root.id })
        .expect(201)
    ).body.page;
    expect(pageA.parentPageId).toBe(root.id);
    expect(pageA.position).toBe(0);
    expect(pageB.position).toBe(1); // max+1 among siblings

    // Flat list ordered by (parent, position): root, then A, then B.
    let pages = (
      await http.get(`/docs/${doc.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.pages;
    expect(pages.map((p: { title: string }) => p.title)).toEqual([
      "Wiki",
      "A",
      "B",
    ]);

    // Reorder: push A after B.
    await http
      .patch(`/pages/${pageA.id}`)
      .set(auth(owner.accessToken))
      .send({ position: 2 })
      .expect(200);
    pages = (
      await http.get(`/docs/${doc.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.pages;
    expect(pages.map((p: { title: string }) => p.title)).toEqual([
      "Wiki",
      "B",
      "A",
    ]);

    // A page cannot become its own parent, nor move under its descendant.
    await http
      .patch(`/pages/${pageA.id}`)
      .set(auth(owner.accessToken))
      .send({ parentPageId: pageA.id })
      .expect(400);
    const child = (
      await http
        .post(`/docs/${doc.id}/pages`)
        .set(auth(owner.accessToken))
        .send({ title: "A child", parentPageId: pageA.id })
        .expect(201)
    ).body.page;
    await http
      .patch(`/pages/${pageA.id}`)
      .set(auth(owner.accessToken))
      .send({ parentPageId: child.id })
      .expect(400);
  });

  it("PATCH content roundtrips and the sanitizer strips script/onclick", async () => {
    const owner = await ownerWorkspace();
    const doc = (
      await http
        .post("/docs")
        .set(auth(owner.accessToken))
        .send({ name: "Notes" })
        .expect(201)
    ).body.doc;
    const root = (
      await http.get(`/docs/${doc.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.pages[0];

    const dirty =
      '<h1>Hello</h1><p onclick="steal()">Hi <b>bold</b></p>' +
      '<script>alert("xss")</script><a href="javascript:evil()">x</a>' +
      "<style>body{display:none}</style>";
    const patched = await http
      .patch(`/pages/${root.id}`)
      .set(auth(owner.accessToken))
      .send({ title: "Welcome", content: dirty })
      .expect(200);
    const content = patched.body.page.content as string;
    expect(content).toContain("<h1>Hello</h1>");
    expect(content).toContain("<b>bold</b>");
    expect(content).not.toContain("<script");
    expect(content).not.toContain("onclick");
    expect(content).not.toContain("javascript:");
    expect(content).not.toContain("<style");
    expect(patched.body.page.updatedBy).toBe(owner.userId);

    // Roundtrips through GET /pages/:id with the same sanitized content.
    const got = await http
      .get(`/pages/${root.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(got.body.page.content).toBe(content);
    expect(got.body.page.title).toBe("Welcome");
    expect(got.body.page.docId).toBe(doc.id);

    // Clean content is stored verbatim.
    const clean = "<h2>Agenda</h2><ul><li>One</li><li>Two</li></ul>";
    const again = await http
      .patch(`/pages/${root.id}`)
      .set(auth(owner.accessToken))
      .send({ content: clean })
      .expect(200);
    expect(again.body.page.content).toBe(clean);
  });

  it("a private unattached doc is visible only to its creator", async () => {
    const owner = await ownerWorkspace();
    const memberA = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const memberB = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const secret = (
      await http
        .post("/docs")
        .set(auth(memberA.accessToken))
        .send({ name: "My secret", isPrivate: true })
        .expect(201)
    ).body.doc;
    expect(secret.isPrivate).toBe(true);

    // Creator sees it.
    const mine = await http
      .get("/docs")
      .set(auth(memberA.accessToken))
      .expect(200);
    expect(docIds(mine)).toContain(secret.id);

    // Another member does not — list and direct GET both hide it.
    const theirs = await http
      .get("/docs")
      .set(auth(memberB.accessToken))
      .expect(200);
    expect(docIds(theirs)).not.toContain(secret.id);
    await http
      .get(`/docs/${secret.id}`)
      .set(auth(memberB.accessToken))
      .expect(404);

    // Even the workspace OWNER does not see others' private docs.
    const owners = await http
      .get("/docs")
      .set(auth(owner.accessToken))
      .expect(200);
    expect(docIds(owners)).not.toContain(secret.id);
    await http
      .get(`/docs/${secret.id}`)
      .set(auth(owner.accessToken))
      .expect(404);
    await http
      .delete(`/docs/${secret.id}`)
      .set(auth(owner.accessToken))
      .expect(404);
  });

  it("a space-attached doc follows the space's visibility and sharing", async () => {
    const owner = await ownerWorkspace();
    const member = await memberOf(owner.accessToken, owner.workspaceId, "member");
    const space = (
      await http
        .post("/spaces")
        .set(auth(owner.accessToken))
        .send({ name: "Private space", isPrivate: true })
        .expect(201)
    ).body.space;

    const doc = (
      await http
        .post("/docs")
        .set(auth(owner.accessToken))
        .send({ name: "Space doc", spaceId: space.id })
        .expect(201)
    ).body.doc;
    expect(doc.spaceId).toBe(space.id);
    expect(doc.spaceName).toBe("Private space");

    // Unshared private space -> the member sees nothing.
    const before = await http
      .get("/docs")
      .set(auth(member.accessToken))
      .expect(200);
    expect(docIds(before)).not.toContain(doc.id);
    await http.get(`/docs/${doc.id}`).set(auth(member.accessToken)).expect(404);

    // Share the space 'view' -> visible but read-only.
    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({
        principalType: "user",
        principalId: member.userId,
        permission: "view",
      })
      .expect(200);
    const after = await http
      .get("/docs")
      .set(auth(member.accessToken))
      .expect(200);
    expect(docIds(after)).toContain(doc.id);
    const detail = await http
      .get(`/docs/${doc.id}`)
      .set(auth(member.accessToken))
      .expect(200);
    await http
      .patch(`/docs/${doc.id}`)
      .set(auth(member.accessToken))
      .send({ name: "Hijack" })
      .expect(403);
    await http
      .patch(`/pages/${detail.body.pages[0].id}`)
      .set(auth(member.accessToken))
      .send({ content: "<p>nope</p>" })
      .expect(403);

    // Upgrade to 'edit' -> the member may edit doc and pages.
    await http
      .put(`/spaces/${space.id}/shares`)
      .set(auth(owner.accessToken))
      .send({
        principalType: "user",
        principalId: member.userId,
        permission: "edit",
      })
      .expect(200);
    await http
      .patch(`/pages/${detail.body.pages[0].id}`)
      .set(auth(member.accessToken))
      .send({ content: "<p>hello</p>" })
      .expect(200);
  });

  it("guests cannot see or create unattached docs", async () => {
    const owner = await ownerWorkspace();
    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");
    const doc = (
      await http
        .post("/docs")
        .set(auth(owner.accessToken))
        .send({ name: "Company wiki" })
        .expect(201)
    ).body.doc;

    const listed = await http
      .get("/docs")
      .set(auth(guest.accessToken))
      .expect(200);
    expect(docIds(listed)).not.toContain(doc.id);
    await http.get(`/docs/${doc.id}`).set(auth(guest.accessToken)).expect(404);
    await http
      .post("/docs")
      .set(auth(guest.accessToken))
      .send({ name: "Guest doc" })
      .expect(403);
  });

  it("blocks deleting a doc's last page, cascades subtree deletes", async () => {
    const owner = await ownerWorkspace();
    const doc = (
      await http
        .post("/docs")
        .set(auth(owner.accessToken))
        .send({ name: "Single" })
        .expect(201)
    ).body.doc;
    const root = (
      await http.get(`/docs/${doc.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.pages[0];

    // Only page in the doc -> blocked.
    await http
      .delete(`/pages/${root.id}`)
      .set(auth(owner.accessToken))
      .expect(400);

    // Add a second root page with a child; deleting it cascades the child.
    const second = (
      await http
        .post(`/docs/${doc.id}/pages`)
        .set(auth(owner.accessToken))
        .send({ title: "Second" })
        .expect(201)
    ).body.page;
    expect(second.parentPageId).toBeNull();
    await http
      .post(`/docs/${doc.id}/pages`)
      .set(auth(owner.accessToken))
      .send({ title: "Child of second", parentPageId: second.id })
      .expect(201);
    await http
      .delete(`/pages/${second.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    const pages = (
      await http.get(`/docs/${doc.id}`).set(auth(owner.accessToken)).expect(200)
    ).body.pages;
    expect(pages).toHaveLength(1); // child went with its parent

    // Back to a single page -> blocked again; doc delete still works.
    await http
      .delete(`/pages/${root.id}`)
      .set(auth(owner.accessToken))
      .expect(400);
    await http
      .delete(`/docs/${doc.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http.get(`/docs/${doc.id}`).set(auth(owner.accessToken)).expect(404);
  });

  it("uploaded documents: PDF becomes a doc, downloads inline-sandboxed, deletes with the doc", async () => {
    const owner = await ownerWorkspace();
    const guest = await memberOf(owner.accessToken, owner.workspaceId, "guest");
    const pdfBytes = Buffer.from("%PDF-1.4 fake-but-fine");
    const dataBase64 = pdfBytes.toString("base64");

    // Guests can't upload.
    await http
      .post("/docs/upload")
      .set(auth(guest.accessToken))
      .send({ name: "Nope", mime: "application/pdf", dataBase64 })
      .expect(403);

    const up = await http
      .post("/docs/upload")
      .set(auth(owner.accessToken))
      .send({ name: "Company policy", mime: "application/pdf", dataBase64 })
      .expect(201);
    const doc = up.body.doc;
    expect(doc.fileId).toBeTruthy();
    expect(doc.fileMime).toBe("application/pdf");
    expect(doc.fileSizeBytes).toBe(pdfBytes.length);
    expect(doc.pageCount).toBe(0);

    // Appears in the docs list with its file metadata.
    const listed = await http
      .get("/docs")
      .set(auth(owner.accessToken))
      .expect(200);
    const row = listed.body.docs.find((d: { id: string }) => d.id === doc.id);
    expect(row.fileId).toBe(doc.fileId);

    // Download streams the bytes inline with the sandbox CSP (PDF viewer).
    const dl = await http
      .get(`/files/${doc.fileId}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(dl.headers["content-type"]).toContain("application/pdf");
    expect(dl.headers["content-disposition"]).toContain("inline");
    expect(dl.headers["content-security-policy"]).toBe("sandbox");

    // A guest can't reach a workspace-level uploaded doc's file.
    await http
      .get(`/files/${doc.fileId}`)
      .set(auth(guest.accessToken))
      .expect(404);

    // Deleting the doc cascades the file away.
    await http
      .delete(`/docs/${doc.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    await http
      .get(`/files/${doc.fileId}`)
      .set(auth(owner.accessToken))
      .expect(404);
  });

  it("notepad is strictly per-user CRUD", async () => {
    const owner = await ownerWorkspace();
    const other = await memberOf(owner.accessToken, owner.workspaceId, "member");

    const first = (
      await http
        .post("/notes")
        .set(auth(owner.accessToken))
        .send({ content: "buy milk" })
        .expect(201)
    ).body.note;
    const second = (
      await http
        .post("/notes")
        .set(auth(owner.accessToken))
        .send({ content: "call bob" })
        .expect(201)
    ).body.note;

    // Newest first; PATCHing the first bumps it to the top.
    let notes = (
      await http.get("/notes").set(auth(owner.accessToken)).expect(200)
    ).body.notes;
    expect(notes.map((n: { id: string }) => n.id)).toEqual([
      second.id,
      first.id,
    ]);
    const patched = await http
      .patch(`/notes/${first.id}`)
      .set(auth(owner.accessToken))
      .send({ content: "buy oat milk" })
      .expect(200);
    expect(patched.body.note.content).toBe("buy oat milk");
    notes = (await http.get("/notes").set(auth(owner.accessToken)).expect(200))
      .body.notes;
    expect(notes.map((n: { id: string }) => n.id)).toEqual([
      first.id,
      second.id,
    ]);

    // Another user sees none of them and cannot touch them (404, not 403).
    const others = await http
      .get("/notes")
      .set(auth(other.accessToken))
      .expect(200);
    expect(others.body.notes.map((n: { id: string }) => n.id)).not.toContain(
      first.id,
    );
    await http
      .patch(`/notes/${first.id}`)
      .set(auth(other.accessToken))
      .send({ content: "hijack" })
      .expect(404);
    await http
      .delete(`/notes/${first.id}`)
      .set(auth(other.accessToken))
      .expect(404);

    // Note content passes through the sanitizer too.
    const dirty = (
      await http
        .post("/notes")
        .set(auth(owner.accessToken))
        .send({ content: '<p onclick="x()">hi</p><script>bad()</script>' })
        .expect(201)
    ).body.note;
    expect(dirty.content).toContain("<p");
    expect(dirty.content).not.toContain("<script");
    expect(dirty.content).not.toContain("onclick");

    await http
      .delete(`/notes/${second.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
    notes = (await http.get("/notes").set(auth(owner.accessToken)).expect(200))
      .body.notes;
    expect(notes.map((n: { id: string }) => n.id)).not.toContain(second.id);
  });
});
