import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { securityHeaders } from "../src/common/security-headers";

/** Audit security quick wins: HSTS on HTTPS, no X-Powered-By, CSP kept. */
let app: INestApplication;
let http: ReturnType<typeof request>;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use(securityHeaders([]));
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

describe("security headers", () => {
  it("HTTPS responses carry HSTS; nothing announces Express", async () => {
    const r = await http.get("/health").set("X-Forwarded-Proto", "https");
    expect(r.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("plain-HTTP development responses are not pinned", async () => {
    const r = await http.get("/health");
    expect(r.headers["strict-transport-security"]).toBeUndefined();
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });
});
