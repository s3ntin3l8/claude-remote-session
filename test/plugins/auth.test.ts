import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "../../src/services/auth.js";

// Issue #19's optional in-process auth: a single shared token, checked via
// src/plugins/auth.ts's global onRequest hook, plus its POST
// /api/auth/login|logout and GET /api/auth/me routes (src/routes/auth.ts).
// The /ws/terminal upgrade's own real-socket coverage lives alongside
// test/routes/terminal.test.ts's existing PTY-mocking infrastructure
// instead of here (see that file's own "in-process auth gate" describe
// block) — this file covers everything reachable via app.inject().

const TEST_TOKEN = "test-auth-token-0123456789";
const TEST_SECRET = "test-session-secret-0123456789";

describe("auth plugin + routes (issue #19)", () => {
  afterEach(() => {
    delete process.env.TESSERA_AUTH_TOKEN;
    delete process.env.TESSERA_SESSION_SECRET;
    delete process.env.PREVIEW_BASE_HOST;
  });

  describe("auth disabled (default — TESSERA_AUTH_TOKEN unset)", () => {
    it("leaves every route reachable with no credential, unchanged from before this feature existed", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/projects" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("GET /api/auth/me reports authMode: none, authenticated: true", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/me" });
      expect(res.json()).toEqual({ authMode: "none", authenticated: true });
      await app.close();
    });
  });

  describe("auth enabled (TESSERA_AUTH_TOKEN set)", () => {
    beforeEach(() => {
      process.env.TESSERA_AUTH_TOKEN = TEST_TOKEN;
      process.env.TESSERA_SESSION_SECRET = TEST_SECRET;
    });

    it("refuses to boot if TESSERA_SESSION_SECRET is missing — an unsigned session cookie would be forgeable", async () => {
      delete process.env.TESSERA_SESSION_SECRET;
      await expect(buildApp()).rejects.toThrow(/TESSERA_SESSION_SECRET/);
    });

    it("401s a protected API route with no credential", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/projects" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("401s the /ws/terminal path itself (pre-upgrade) with no credential", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/ws/terminal?sessionId=1" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("allows /health without a credential — infrastructure, not product surface", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("allows GET / without a credential — the SPA shell has to load before it can call /api/auth/me", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("200s a protected route with a valid bearer token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("401s a protected route with a wrong bearer token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/projects",
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    describe("POST /api/auth/login", () => {
      it("is itself reachable with no credential — a gate can't block the endpoint that satisfies it", async () => {
        const app = await buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { token: "wrong" },
        });
        // 401 for the *wrong token*, not for missing auth on the route itself.
        expect(res.statusCode).toBe(401);
        await app.close();
      });

      it("sets a session cookie for a valid token, which then authenticates subsequent requests", async () => {
        const app = await buildApp();
        const loginRes = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { token: TEST_TOKEN },
        });
        expect(loginRes.statusCode).toBe(204);
        const cookie = loginRes.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
        expect(cookie).toBeDefined();
        expect(cookie?.httpOnly).toBe(true);
        expect(cookie?.sameSite).toBe("Lax");

        const res = await app.inject({
          method: "GET",
          url: "/api/projects",
          cookies: { [SESSION_COOKIE_NAME]: cookie!.value },
        });
        expect(res.statusCode).toBe(200);
        await app.close();
      });

      it("is rate-limited independently of RATE_LIMIT_MAX — a dedicated brute-force bound (CodeQL js/missing-rate-limiting)", async () => {
        const app = await buildApp();
        // src/routes/auth.ts's LOGIN_RATE_LIMIT caps this route at 10/min
        // regardless of the app-wide default, since a request that only
        // ever hits this one route could otherwise spend that whole budget
        // guessing tokens.
        for (let i = 0; i < 10; i++) {
          const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { token: "wrong" },
          });
          expect(res.statusCode).toBe(401);
        }
        const eleventh = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { token: TEST_TOKEN },
        });
        expect(eleventh.statusCode).toBe(429);
        await app.close();
      });
    });

    describe("POST /api/auth/logout", () => {
      it("clears the session cookie", async () => {
        const app = await buildApp();
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          cookies: { [SESSION_COOKIE_NAME]: createSessionCookieValue(TEST_SECRET) },
        });
        expect(res.statusCode).toBe(204);
        const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
        expect(cookie?.value).toBe("");
        await app.close();
      });
    });

    describe("GET /api/auth/me", () => {
      it("reports authenticated: true via a valid session cookie", async () => {
        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/api/auth/me",
          cookies: { [SESSION_COOKIE_NAME]: createSessionCookieValue(TEST_SECRET) },
        });
        expect(res.json()).toEqual({ authMode: "token", authenticated: true });
        await app.close();
      });

      it("reports authenticated: false with no credential", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/api/auth/me" });
        expect(res.json()).toEqual({ authMode: "token", authenticated: false });
        await app.close();
      });

      it("reports authenticated: false for a tampered session cookie", async () => {
        const app = await buildApp();
        const tampered = createSessionCookieValue(TEST_SECRET) + "x";
        const res = await app.inject({
          method: "GET",
          url: "/api/auth/me",
          cookies: { [SESSION_COOKIE_NAME]: tampered },
        });
        expect(res.json()).toEqual({ authMode: "token", authenticated: false });
        await app.close();
      });
    });

    describe("preview-host exemption (see src/plugins/auth.ts's own doc comment on why)", () => {
      beforeEach(() => {
        process.env.PREVIEW_BASE_HOST = "preview.test";
      });

      it("does not gate a GET preview-host request, even against an /api/ path, with no credential", async () => {
        const app = await buildApp();
        // No preview is registered for this slug — previewProxyPlugin's own
        // onRequest hook resolves it and 404s "Unknown preview". A 401 here
        // would mean the auth gate (registered earlier) intercepted first;
        // a 404 instead proves it recognized the preview Host header and
        // got out of the way, letting previewProxyPlugin's hook run — even
        // though the path (/api/whatever) would otherwise be gated. GET is
        // the method previewProxyPlugin actually serves — see the sibling
        // "does not extend the preview-host bypass to non-GET/HEAD" test
        // below for why this can't extend to every method.
        const res = await app.inject({
          method: "GET",
          url: "/api/whatever",
          headers: { host: "preview-nonexistent.preview.test" },
        });
        expect(res.statusCode).toBe(404);
        await app.close();
      });

      it("does not extend the preview-host bypass to non-GET/HEAD methods — the fix for a real auth-bypass found in review", async () => {
        // previewProxyPlugin's own onRequest hook only ever serves GET/HEAD
        // (preview-proxy.ts). request.headers.host is fully attacker-
        // controlled, so a bypass keyed on Host alone (regardless of method)
        // would let a forged `Host: preview-x.<PREVIEW_BASE_HOST>` on a
        // state-changing request fall straight through to the real /api/*
        // handler with no credential check at all — previewProxyPlugin
        // never touches non-GET/HEAD requests either, so nothing else would
        // catch it. Exercises the actual state-changing routes these
        // methods gate, not just a bare /api/whatever placeholder, so a
        // regression here would mean a real unauthenticated write, not a
        // hypothetical one.
        const app = await buildApp();
        const previewHeaders = { host: "preview-nonexistent.preview.test" };

        const post = await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: previewHeaders,
          payload: { name: "p", cwd: "/tmp" },
        });
        expect(post.statusCode).toBe(401);

        const patch = await app.inject({
          method: "PATCH",
          url: "/api/settings",
          headers: previewHeaders,
          payload: {},
        });
        expect(patch.statusCode).toBe(401);

        const del = await app.inject({
          method: "DELETE",
          url: "/api/projects/1",
          headers: previewHeaders,
        });
        expect(del.statusCode).toBe(401);

        await app.close();
      });

      it("still gates a normal (non-preview) request to the same path", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/api/whatever" });
        expect(res.statusCode).toBe(401);
        await app.close();
      });
    });
  });
});
