import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import express from "express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { GoogleOAuthClient, type GoogleProfile } from "../src/auth/google-oauth.client";

/**
 * End-to-end tests for Module 18 (SSO / Google OAuth). The real Google
 * endpoints are replaced by a fake GoogleOAuthClient so the whole flow —
 * state signing, code exchange, find-or-create, token issuance — is exercised
 * without network or client credentials. A map lets each test pick which
 * profile a given code resolves to.
 */

const profiles = new Map<string, GoogleProfile>();

class FakeGoogle {
  configured() {
    return true;
  }
  authorizeUrl(state: string) {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  }
  async exchange(code: string): Promise<GoogleProfile> {
    const p = profiles.get(code);
    if (!p) throw new Error("unknown code");
    return p;
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleOAuthClient)
    .useClass(FakeGoogle)
    .compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json({ limit: "12mb" }));
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

const uniqueEmail = () => `sso${Date.now()}${Math.floor(Math.random() * 1e6)}@t.test`;

/** Drive /start to obtain a valid signed state, then hit the callback. */
async function ssoLogin(code: string) {
  const start = await http.get("/auth/oauth/google/start").expect(302);
  const loc = new URL(start.headers.location);
  const state = loc.searchParams.get("state") as string;
  const cb = await http
    .get(`/auth/oauth/google/callback?code=${code}&state=${encodeURIComponent(state)}`)
    .expect(302);
  return new URL(cb.headers.location, "http://x").hash.slice(1);
}

describe("Google SSO", () => {
  it("reports the provider as configured", async () => {
    const res = await http.get("/auth/sso/providers").expect(200);
    expect(res.body.google).toBe(true);
  });

  it("creates a new account on first sign-in and returns tokens", async () => {
    const email = uniqueEmail();
    const code = `code-${email}`;
    profiles.set(code, {
      sub: `g-${email}`,
      email,
      emailVerified: true,
      name: "SSO User",
      picture: "https://img/x.png",
    });
    const frag = new URLSearchParams(await ssoLogin(code));
    expect(frag.get("sso")).toBe("google");
    const identityToken = frag.get("identityToken") as string;
    expect(identityToken).toBeTruthy();
    expect(frag.get("refreshToken")).toBeTruthy();

    // The minted identity token works against an authed endpoint.
    const me = await http
      .get("/auth/me")
      .set("Authorization", `Bearer ${identityToken}`)
      .expect(200);
    expect(me.body.user.email).toBe(email);
  });

  it("links an existing password account with the same verified email", async () => {
    const email = uniqueEmail();
    // Create a password account first.
    await http
      .post("/auth/signup")
      .send({ email, fullName: "Pw User", password: "password123" })
      .expect(201);
    // Now sign in with Google using the same email.
    const code = `code-${email}`;
    profiles.set(code, {
      sub: `g-${email}`,
      email,
      emailVerified: true,
      name: "Pw User",
      picture: null,
    });
    const frag = new URLSearchParams(await ssoLogin(code));
    const id1 = frag.get("identityToken") as string;
    const me = await http.get("/auth/me").set("Authorization", `Bearer ${id1}`).expect(200);
    expect(me.body.user.email).toBe(email);

    // A second Google sign-in resolves to the SAME user (linked by subject).
    const frag2 = new URLSearchParams(await ssoLogin(code));
    const id2 = frag2.get("identityToken") as string;
    const me2 = await http.get("/auth/me").set("Authorization", `Bearer ${id2}`).expect(200);
    expect(me2.body.user.id).toBe(me.body.user.id);
  });

  it("refuses an unverified Google email", async () => {
    const email = uniqueEmail();
    const code = `code-${email}`;
    profiles.set(code, {
      sub: `g-${email}`,
      email,
      emailVerified: false,
      name: "Unverified",
      picture: null,
    });
    const hash = await ssoLogin(code);
    const frag = new URLSearchParams(hash);
    expect(frag.get("identityToken")).toBeNull();
    expect(frag.get("sso_error")).toBeTruthy();
  });

  it("a native-flagged flow deep-links tokens back into the app", async () => {
    const email = uniqueEmail();
    const code = `code-${email}`;
    profiles.set(code, {
      sub: `g-${email}`,
      email,
      emailVerified: true,
      name: "App User",
      picture: null,
    });
    const start = await http.get("/auth/oauth/google/start?native=1").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state") as string;
    const cb = await http
      .get(`/auth/oauth/google/callback?code=${code}&state=${encodeURIComponent(state)}`)
      .expect(302);
    expect(cb.headers.location.startsWith("com.stackup.app://sso#")).toBe(true);
    const frag = new URLSearchParams(cb.headers.location.split("#")[1]);
    expect(frag.get("identityToken")).toBeTruthy();
    expect(frag.get("refreshToken")).toBeTruthy();
  });

  it("rejects a callback with a forged/absent state", async () => {
    const email = uniqueEmail();
    const code = `code-${email}`;
    profiles.set(code, {
      sub: `g-${email}`,
      email,
      emailVerified: true,
      name: "X",
      picture: null,
    });
    const cb = await http
      .get(`/auth/oauth/google/callback?code=${code}&state=not-a-real-token`)
      .expect(302);
    const frag = new URLSearchParams(new URL(cb.headers.location, "http://x").hash.slice(1));
    expect(frag.get("identityToken")).toBeNull();
    expect(frag.get("sso_error")).toBeTruthy();
  });
});
