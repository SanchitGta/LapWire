import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MetaClient } from "../src/metaClient.js";
import { createRuntimeDependencies, registerMetaHandlers } from "../src/index.js";
import type { CommandHandlerArgs, MetaAppLike, ViewHandlerArgs } from "../src/link/index.js";
import { registerStatusHandlers } from "../src/status/index.js";
import { createCommandArgs } from "./mocks/slack.js";
import {
  createInitialState,
  startMockMindlap,
  type FactoryStatus,
  type MockMindlapServer,
} from "./mocks/mindlap.js";

class FakeApp implements MetaAppLike {
  readonly commandHandlers = new Map<string, (args: CommandHandlerArgs) => Promise<void>>();
  readonly viewHandlers = new Map<string, (args: ViewHandlerArgs) => Promise<void>>();

  command(name: string, handler: (args: CommandHandlerArgs) => Promise<void>): void {
    this.commandHandlers.set(name, handler);
  }

  view(callbackId: string, handler: (args: ViewHandlerArgs) => Promise<void>): void {
    this.viewHandlers.set(callbackId, handler);
  }
}

const servers: MockMindlapServer[] = [];
const stores: Array<{ close(): void }> = [];

afterEach(async () => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }

  await Promise.all(servers.splice(0, servers.length).map((server) => server.stop()));
});

async function boot(overrides?: {
  metaClientFactory?: (options: { accessToken: string }) => MetaClient;
}) {
  const server = await startMockMindlap();
  servers.push(server);

  const app = new FakeApp();
  const workspace = mkdtempSync(join(tmpdir(), "lapwire-status-"));
  const dbPath = join(workspace, "lapwire.db");
  const runtime = createRuntimeDependencies({
    apiBase: server.apiBase,
    dbPath,
    encryptionKey: "test-encryption-key",
    now: () => new Date("2026-06-25T00:00:00.000Z"),
  });
  stores.push(runtime.store);

  registerStatusHandlers(app, {
    ...runtime,
    metaBaseUrl: server.baseUrl,
    metaOrg: server.state.org,
    metaClientFactory: overrides?.metaClientFactory,
  });

  return {
    app,
    runtime,
    server,
  };
}

async function bootMeta(overrides?: {
  metaClientFactory?: (options: { accessToken: string }) => MetaClient;
}) {
  const server = await startMockMindlap();
  servers.push(server);

  const app = new FakeApp();
  const workspace = mkdtempSync(join(tmpdir(), "lapwire-meta-"));
  const dbPath = join(workspace, "lapwire.db");
  const runtime = createRuntimeDependencies({
    apiBase: server.apiBase,
    dbPath,
    encryptionKey: "test-encryption-key",
    metaBaseUrl: server.baseUrl,
    metaOrg: server.state.org,
    now: () => new Date("2026-06-25T00:00:00.000Z"),
  });
  stores.push(runtime.store);

  registerMetaHandlers(app, {
    ...runtime,
    metaClientFactory: overrides?.metaClientFactory,
  });

  return {
    app,
    runtime,
    server,
  };
}

describe("status commands", () => {
  it("routes /meta fleet and /meta status through the live command entrypoint", async () => {
    const { app, runtime, server } = await bootMeta();
    runtime.store.putLink({
      slackUserId: "U_STATUS",
      mindlapUserId: server.state.users.admin.id,
      email: server.state.users.admin.email,
      accessToken: server.state.tokens.admin,
      role: "admin",
      exp: 1783036800,
      createdAt: 1719273600,
    });

    const fleet = createCommandArgs({
      text: "fleet",
      user_id: "U_STATUS",
    });
    await app.commandHandlers.get("/meta")?.(fleet as unknown as CommandHandlerArgs);

    const fleetResponse = fleet.respond.lastCall()?.args[0] as { text: string; blocks: unknown[] };
    expect(fleetResponse.text).toBe("Live fleet status for acme");
    expect(JSON.stringify(fleetResponse.blocks)).toContain("crispr-bench");

    const status = createCommandArgs({
      text: "status CRISPR-BENCH",
      user_id: "U_STATUS",
    });
    await app.commandHandlers.get("/meta")?.(status as unknown as CommandHandlerArgs);

    const statusResponse = status.respond.lastCall()?.args[0] as { text: string; blocks: unknown[] };
    expect(statusResponse.text).toBe("Live status for crispr-bench");
    expect(JSON.stringify(statusResponse.blocks)).toContain("factory-lap-3");
  });

  it("hydrates fleet status in parallel and renders both fixture projects", async () => {
    const state = createInitialState();
    const projects = Object.values(state.projects).map((project) => project.summary);
    const statusById = Object.fromEntries(
      Object.values(state.projects).map((project) => [project.summary.id, project.status]),
    ) as Record<string, FactoryStatus>;

    const pending = new Map<string, Promise<FactoryStatus>>();
    const resolvers = new Map<string, (status: FactoryStatus) => void>();
    const requestedIds: string[] = [];

    const { _app, runtime } = await boot({
      metaClientFactory: ({ accessToken }) =>
        ({
          listProjects: async (org) => {
            expect(org).toBe("acme");
            expect(accessToken).toBeDefined();
            return projects;
          },
          getFactoryStatus: (projectId) => {
            requestedIds.push(projectId);
            const deferred =
              pending.get(projectId) ??
              new Promise<FactoryStatus>((resolve) => {
                resolvers.set(projectId, resolve);
              });
            pending.set(projectId, deferred);
            return deferred;
          },
        }) as MetaClient,
    });

    runtime.store.putLink({
      slackUserId: "U_STATUS",
      mindlapUserId: state.users.admin.id,
      email: state.users.admin.email,
      accessToken: state.tokens.admin,
      role: "admin",
      exp: 1783036800,
      createdAt: 1719273600,
    });

    const fleet = createCommandArgs({
      text: "fleet",
      user_id: "U_STATUS",
    });

    const commandPromise = runtime.commandHandlers.fleet?.(fleet as unknown as CommandHandlerArgs);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestedIds).toEqual(["vY8joe", "A2bYWi"]);

    for (const projectId of requestedIds) {
      resolvers.get(projectId)?.(statusById[projectId]!);
    }

    await commandPromise;

    const response = fleet.respond.lastCall()?.args[0] as { text: string; blocks: unknown[] };
    expect(response.text).toBe("Live fleet status for acme");

    const rendered = JSON.stringify(response.blocks);
    expect(rendered).toContain("crispr-bench");
    expect(rendered).toContain("d4-analytics");
    expect(rendered).toContain("factory-lap-3");
    expect(rendered).toContain("No enabled entries");
    expect(rendered).toContain("⚠ *crispr-bench*");
    expect(rendered).toContain("🔴 *d4-analytics*");
    expect(rendered).toContain("view_status");
  });

  it("renders a case-insensitive single-project detail card with repo, cloud, defaults, and actions", async () => {
    const { _app, runtime, server } = await boot();
    runtime.store.putLink({
      slackUserId: "U_STATUS",
      mindlapUserId: server.state.users.admin.id,
      email: server.state.users.admin.email,
      accessToken: server.state.tokens.admin,
      role: "admin",
      exp: 1783036800,
      createdAt: 1719273600,
    });

    const status = createCommandArgs({
      text: "status CRISPR-BENCH",
      user_id: "U_STATUS",
    });

    await runtime.commandHandlers.status?.(status as unknown as CommandHandlerArgs);

    const response = status.respond.lastCall()?.args[0] as { text: string; blocks: unknown[] };
    expect(response.text).toBe("Live status for crispr-bench");

    const rendered = JSON.stringify(response.blocks);
    expect(rendered).toContain("enabled (expires in 12h)");
    expect(rendered).toContain("factory-lap-3");
    expect(rendered).toContain("https://github.com/acme/crispr-bench");
    expect(rendered).toContain("🟢 enabled");
    expect(rendered).toContain("claude / sonnet");
    expect(rendered).toContain("stop_lap");
    expect(rendered).toContain("rearm_hb");
    expect(rendered).toContain("cfg_edit_repo");
    expect(rendered).toContain("disable_hb");
  });

  it("returns a friendly not-found message for an unknown project", async () => {
    const { _app, runtime, server } = await boot();
    runtime.store.putLink({
      slackUserId: "U_STATUS",
      mindlapUserId: server.state.users.admin.id,
      email: server.state.users.admin.email,
      accessToken: server.state.tokens.admin,
      role: "admin",
      exp: 1783036800,
      createdAt: 1719273600,
    });

    const status = createCommandArgs({
      text: "status unknown-project",
      user_id: "U_STATUS",
    });

    await runtime.commandHandlers.status?.(status as unknown as CommandHandlerArgs);

    expect(status.respond.lastCall()?.args[0]).toEqual({
      text: 'Project "unknown-project" was not found in acme.',
    });
  });

  it("surfaces admin_required for a linked member account", async () => {
    const { _app, runtime, server } = await boot();
    runtime.store.putLink({
      slackUserId: "U_MEMBER",
      mindlapUserId: server.state.users.member.id,
      email: server.state.users.member.email,
      accessToken: server.state.tokens.member,
      role: "member",
      exp: 1783036800,
      createdAt: 1719273600,
    });

    const fleet = createCommandArgs({
      text: "fleet",
      user_id: "U_MEMBER",
    });

    await runtime.commandHandlers.fleet?.(fleet as unknown as CommandHandlerArgs);

    expect(fleet.respond.lastCall()?.args[0]).toEqual({
      text: "this requires a MindLap global admin",
    });
  });

  it("prompts for linking when the caller is unlinked or expired without calling the gateway", async () => {
    let createdClients = 0;
    const { _app, runtime, server } = await boot({
      metaClientFactory: () => {
        createdClients += 1;
        return {
          listProjects: async () => [],
        } as MetaClient;
      },
    });

    const unlinked = createCommandArgs({
      text: "fleet",
      user_id: "U_UNLINKED",
    });

    await runtime.commandHandlers.fleet?.(unlinked as unknown as CommandHandlerArgs);
    expect(unlinked.respond.lastCall()?.args[0]).toEqual({
      text: "Not linked — run /meta link",
    });

    runtime.store.putLink({
      slackUserId: "U_EXPIRED",
      mindlapUserId: server.state.users.admin.id,
      email: server.state.users.admin.email,
      accessToken: server.state.tokens.expiredAdmin,
      role: "admin",
      exp: 1719187200,
      createdAt: 1719180000,
    });

    const expired = createCommandArgs({
      text: "status crispr-bench",
      user_id: "U_EXPIRED",
    });

    await runtime.commandHandlers.status?.(expired as unknown as CommandHandlerArgs);
    expect(expired.respond.lastCall()?.args[0]).toEqual({
      text: "⚠ link expired — run /meta link",
    });
    expect(createdClients).toBe(0);
  });
});
