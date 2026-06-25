import { afterEach, describe, expect, it } from "vitest";
import { createAuthClient } from "../src/auth.js";
import { AdminRequiredError, InvalidTokenError } from "../src/errors.js";
import { createMetaClient } from "../src/metaClient.js";
import { startMockMindlap, type MockMindlapServer } from "./mocks/mindlap.js";

const servers: MockMindlapServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0, servers.length).map(async (server) => {
      await server.stop();
    }),
  );
});

async function bootMock(): Promise<MockMindlapServer> {
  const server = await startMockMindlap();
  servers.push(server);
  return server;
}

describe("auth client", () => {
  it("uses API_BASE for sendOtp, verifyOtp, and me", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const authClient = createAuthClient({
      apiBase: "https://auth.example.test/root",
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          authorization: headers.get("authorization"),
        });

        if (url.endsWith("/api/auth/send-otp")) {
          return Response.json({ ok: true });
        }

        if (url.endsWith("/api/auth/verify-otp")) {
          return Response.json({ access_token: "jwt-123" });
        }

        return Response.json({ id: "usr-1", email: "testuser@mindlap.dev", role: "admin" });
      },
    });

    await authClient.sendOtp({ email: "testuser@mindlap.dev" });
    await authClient.verifyOtp({ email: "testuser@mindlap.dev", otp: "414141" });
    await authClient.getMe("jwt-123");

    expect(calls.map((call) => call.url)).toEqual([
      "https://auth.example.test/root/api/auth/send-otp",
      "https://auth.example.test/root/api/auth/verify-otp",
      "https://auth.example.test/root/api/auth/me",
    ]);
    expect(calls[2]?.authorization).toBe("Bearer jwt-123");
  });

  it("round-trips the OTP flow against the mock", async () => {
    const server = await bootMock();
    const authClient = createAuthClient({ apiBase: server.apiBase });

    await expect(authClient.sendOtp({ email: "testuser@mindlap.dev" })).resolves.toEqual({ ok: true });
    await expect(
      authClient.verifyOtp({ email: "testuser@mindlap.dev", otp: "414141" }),
    ).resolves.toEqual({ access_token: server.state.tokens.admin });
    await expect(authClient.getMe(server.state.tokens.admin)).resolves.toEqual({
      id: server.state.users.admin.id,
      email: server.state.users.admin.email,
      role: "admin",
    });
    await expect(
      authClient.verifyOtp({ email: "testuser@mindlap.dev", otp: "000000" }),
    ).rejects.toThrow("Invalid OTP code.");
  });
});

describe("meta client", () => {
  it("injects the bearer token and exposes typed wrappers for the frozen routes", async () => {
    const server = await bootMock();
    const metaClient = createMetaClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.tokens.admin,
    });

    await expect(metaClient.listProjects("acme")).resolves.toEqual([
      {
        id: "vY8joe",
        name: "crispr-bench",
        type: "factory",
        org_id: "acme",
        created_at: "2026-06-20T10:00:00.000Z",
      },
      {
        id: "A2bYWi",
        name: "d4-analytics",
        type: "factory",
        org_id: "acme",
        created_at: "2026-06-19T08:30:00.000Z",
      },
    ]);

    await expect(metaClient.getFactoryStatus("vY8joe", "acme")).resolves.toMatchObject({
      project: { id: "vY8joe", name: "crispr-bench" },
      repo: { url: "https://github.com/acme/crispr-bench", token_set: true },
      cloud_enabled: true,
      defaults: { tool: "claude", model: "sonnet" },
      heartbeat: { enabled: true, expires_at: "2026-06-25T12:00:00.000Z" },
    });

    await expect(metaClient.getHeartbeat("vY8joe")).resolves.toEqual({
      project_id: "vY8joe",
      enabled: true,
      schedule: "0 * * * *",
      rule_name: "factory-lap-3",
      expires_at: "2026-06-25T12:00:00.000Z",
    });

    await expect(metaClient.getRepo("vY8joe")).resolves.toEqual({
      url: "https://github.com/acme/crispr-bench",
      token_set: true,
    });

    await expect(metaClient.getDefaults("vY8joe")).resolves.toEqual({
      tool: "claude",
      model: "sonnet",
    });

    await expect(metaClient.listEnv("vY8joe")).resolves.toEqual([
      { key: "ENV_API_KEY", is_set: true },
      { key: "ENV_REGION", is_set: true },
    ]);

    await expect(metaClient.listCredentials("vY8joe")).resolves.toEqual([
      { id: "cred-1", provider: "claude", owner: "ops" },
      { id: "cred-2", provider: "codex", owner: "ops" },
    ]);

    await expect(metaClient.listMembers("vY8joe")).resolves.toEqual([
      { user_id: "usr-admin-1", email: "testuser@mindlap.dev", role: "admin" },
      { user_id: "usr-member-1", email: "member@acme.dev", role: "member" },
    ]);

    await expect(
      metaClient.startFactory("A2bYWi", {
        lap_no: 2,
        schedule: "*/15 * * * *",
        agent: "meta",
        tool: "codex",
        model: "gpt-5",
        queue: "cloud",
        enable_heartbeat: true,
      }),
    ).resolves.toMatchObject({
      entry: {
        name: "factory-lap-2",
        enabled: true,
        queue: "cloud",
        tool: "codex",
        model: "gpt-5",
      },
      heartbeat: {
        enabled: true,
        expires_at: "2026-06-26T00:00:00.000Z",
      },
    });

    await expect(metaClient.stopFactory("A2bYWi", { lap_no: 2 })).resolves.toMatchObject({
      entry: {
        name: "factory-lap-2",
        enabled: false,
      },
      heartbeat: {
        enabled: true,
        expires_at: "2026-06-26T00:00:00.000Z",
      },
    });

    await expect(metaClient.updateHeartbeat("A2bYWi", { enabled: false })).resolves.toEqual({
      project_id: "A2bYWi",
      enabled: false,
      schedule: null,
      rule_name: null,
      expires_at: null,
    });

    await expect(
      metaClient.updateRepo("A2bYWi", {
        url: "https://github.com/acme/d4-analytics",
        token: "secret-token",
      }),
    ).resolves.toEqual({
      url: "https://github.com/acme/d4-analytics",
      token_set: true,
    });

    await expect(metaClient.updateCloud("A2bYWi", { enabled: true })).resolves.toEqual({
      enabled: true,
    });

    await expect(
      metaClient.updateDefaults("A2bYWi", { tool: "claude", model: "opus" }),
    ).resolves.toEqual({
      tool: "claude",
      model: "opus",
    });

    await expect(metaClient.setEnv("A2bYWi", "ENV_NEW", { value: "s3cr3t" })).resolves.toEqual({
      key: "ENV_NEW",
      is_set: true,
    });
    await expect(metaClient.deleteEnv("A2bYWi", "ENV_ANALYTICS")).resolves.toEqual({
      deleted: true,
    });

    await expect(
      metaClient.createCredential("A2bYWi", {
        provider: "gemini",
        token: "token-123",
        owner: "ops",
      }),
    ).resolves.toEqual({
      id: "cred-4",
      provider: "gemini",
    });
    await expect(metaClient.deleteCredential("A2bYWi", "cred-4")).resolves.toEqual({
      deleted: true,
    });

    expect(server.state.projects.A2bYWi.status.cloud_enabled).toBe(true);
    expect(server.state.projects.A2bYWi.status.defaults).toEqual({ tool: "claude", model: "opus" });
    expect(server.state.projects.A2bYWi.status.repo.token_set).toBe(true);
    expect(server.state.projects.A2bYWi.env).toContainEqual({ key: "ENV_NEW", value: "s3cr3t" });
    expect(server.state.projects.A2bYWi.credentials).toEqual([
      { id: "cred-3", provider: "gemini", owner: "ops", token: "gemini-secret" },
    ]);
  });

  it("maps invalid_token and admin_required to explicit typed errors with verbatim messages", async () => {
    const server = await bootMock();

    const invalidTokenClient = createMetaClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.tokens.expiredAdmin,
    });

    const invalidTokenError = await invalidTokenClient.listProjects("acme").catch((error) => error);
    expect(invalidTokenError).toBeInstanceOf(InvalidTokenError);
    expect(invalidTokenError).toMatchObject({
      message: "Your MindLap session is invalid or expired. Run /meta link again.",
      status: 401,
      code: "invalid_token",
    });

    const memberClient = createMetaClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.tokens.member,
    });

    const adminRequiredError = await memberClient.listProjects("acme").catch((error) => error);
    expect(adminRequiredError).toBeInstanceOf(AdminRequiredError);
    expect(adminRequiredError).toMatchObject({
      message: "this requires a MindLap global admin",
      status: 403,
      code: "admin_required",
    });
  });

  it("sends the bearer token on gateway calls", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const metaClient = createMetaClient({
      baseUrl: "https://meta.example.test/base",
      getAccessToken: () => "token-456",
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        seen.push({
          url,
          authorization: headers.get("authorization"),
        });

        return Response.json([]);
      },
    });

    await metaClient.listProjects("acme");

    expect(seen).toEqual([
      {
        url: "https://meta.example.test/base/api/meta/orgs/acme/projects",
        authorization: "Bearer token-456",
      },
    ]);
  });
});
