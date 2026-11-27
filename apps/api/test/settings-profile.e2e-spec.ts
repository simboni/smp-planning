import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/** Settings → Profile: change your name and your password. */
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const email = () => `sp${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;

describe("profile settings", () => {
  it("renames you", async () => {
    const s = await http.post("/auth/signup").send({ email: email(), fullName: "Old Name", password: "password123" }).expect(201);
    const r = await http.patch("/auth/me").set(auth(s.body.identityToken)).send({ fullName: "Peter Misiati" }).expect(200);
    expect(r.body.user.fullName).toBe("Peter Misiati");
  });

  it("changes the password, keeps this device, signs out the others", async () => {
    const e = email();
    const s = await http.post("/auth/signup").send({ email: e, fullName: "P", password: "password123" }).expect(201);
    const other = await http.post("/auth/login").send({ email: e, password: "password123" }).expect(200);
    const tok = s.body.identityToken as string;

    await http.post("/auth/me/password").set(auth(tok)).send({ currentPassword: "wrong-pass", newPassword: "newpassword456" }).expect(400);
    await http.post("/auth/me/password").set(auth(tok)).send({ currentPassword: "password123", newPassword: "short" }).expect(400);
    await http
      .post("/auth/me/password")
      .set(auth(tok))
      .set("x-refresh-token", s.body.refreshToken)
      .send({ currentPassword: "password123", newPassword: "newpassword456" })
      .expect(204);

    // This device keeps working; the other device is signed out.
    await http.post("/auth/refresh").send({ refreshToken: s.body.refreshToken }).expect(200);
    await http.post("/auth/refresh").send({ refreshToken: other.body.refreshToken }).expect(401);
    // Old password no longer works, the new one does.
    await http.post("/auth/login").send({ email: e, password: "password123" }).expect(401);
    await http.post("/auth/login").send({ email: e, password: "newpassword456" }).expect(200);
  });
});
