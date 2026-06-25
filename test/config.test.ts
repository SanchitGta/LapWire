import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeDependencies, registerMetaHandlers } from "../src/index.js";
import { CONFIG_BLOCK_IDS } from "../src/config/modals.js";
import type { ActionHandlerArgs, CommandHandlerArgs, MetaAppLike, ViewHandlerArgs } from "../src/link/index.js";
import {
  createActionArgs,
  createCommandArgs,
  createViewSubmitArgs,
  mergeViewState,
  selectStateValue,
  viewStateValue,
} from "./mocks/slack.js";
import { startMockMindlap, type MockMindlapServer } from "./mocks/mindlap.js";

class FakeApp implements MetaAppLike {
  readonly commandHandlers = new Map<string, (args: CommandHandlerArgs) => Promise<void>>();
  readonly viewHandlers = new Map<string, (args: ViewHandlerArgs) => Promise<void>>();
  readonly actionHandlers = new Map<string, (args: ActionHandlerArgs) => Promise<void>>();

  command(name: string, handler: (args: CommandHandlerArgs) => Promise<void>): void {
    this.commandHandlers.set(name, handler);
  }

  view(callbackId: string, handler: (args: ViewHandlerArgs) => Promise<void>): void {
    this.viewHandlers.set(callbackId, handler);
  }

  action(actionId: string, handler: (args: ActionHandlerArgs) => Promise<void>): void {
    this.actionHandlers.set(actionId, handler);
  }
}

const servers: MockMindlapServer[] = [];
const stores: Array<{ close(): void }> = [];

afterEach(async () => {
  while (stores.length > 0) stores.pop()?.close();
  await Promise.all(servers.splice(0, servers.length).map((s) => s.stop()));
});

async function boot() {
  const server = await startMockMindlap();
  servers.push(server);
  const workspace = mkdtempSync(join(tmpdir(), "lapwire-config-"));
  const runtime = createRuntimeDependencies({
    apiBase: server.apiBase,
    dbPath: join(workspace, "lapwire.db"),
    encryptionKey: "test-encryption-key",
    metaBaseUrl: server.baseUrl,
    metaOrg: "acme",
    now: () => new Date("2026-06-25T00:00:00.000Z"),
  });
  stores.push(runtime.store);
  const app = new FakeApp();
  registerMetaHandlers(app, runtime);
  return { app, runtime, server };
}

function linkUser(
  runtime: ReturnType<typeof createRuntimeDependencies>,
  server: MockMindlapServer,
  options: { slackUserId: string; role: "admin" | "member" },
) {
  const token = options.role === "admin" ? server.state.tokens.admin : server.state.tokens.member;
  const user = options.role === "admin" ? server.state.users.admin : server.state.users.member;
  runtime.store.putLink({
    slackUserId: options.slackUserId,
    mindlapUserId: user.id,
    email: user.email,
    accessToken: token,
    role: options.role,
    exp: 1783036800,
    createdAt: 1719273600,
  });
}

describe("config hub", () => {
  it("renders hub card with repo, cloud, defaults, env, credentials, and members sections", async () => {
    const { runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const args = createCommandArgs({ text: "config crispr-bench", user_id: "U_ADMIN", channel_id: "C_TEST" });
    await runtime.commandHandlers.config?.(args as unknown as CommandHandlerArgs);

    const responded = args.respond.lastCall()?.args[0] as { blocks: unknown[] };
    expect(responded).toBeTruthy();
    const blocksStr = JSON.stringify(responded.blocks);

    expect(blocksStr).toContain("crispr-bench");
    expect(blocksStr).toContain("https://github.com/acme/crispr-bench");
    expect(blocksStr).toContain("claude");
    expect(blocksStr).toContain("sonnet");
    expect(blocksStr).toContain("2 vars set");
    expect(blocksStr).toContain("claude ✓");
    expect(blocksStr).toContain("codex ✓");
    expect(blocksStr).toContain("Members");
  });

  it("editing defaults via modal calls PUT /defaults and re-rendered hub shows the new values", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const editAction = createActionArgs("cfg_edit_defaults", {
      user: { id: "U_ADMIN" },
      channel: { id: "C_TEST" },
      message: { ts: "1719321600.000100" },
      actions: [
        {
          action_id: "cfg_edit_defaults",
          value: JSON.stringify({ org: "acme", projectId: "vY8joe", projectName: "crispr-bench" }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_edit_defaults")?.(editAction as unknown as ActionHandlerArgs);

    const opened = editAction.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string; blocks: Array<Record<string, unknown>> };
    };
    expect(opened).toBeTruthy();
    expect(opened.view.blocks[0]).toMatchObject({
      block_id: CONFIG_BLOCK_IDS.defaultsTool,
      element: { initial_value: "claude" },
    });

    const stateValues = mergeViewState(
      viewStateValue(CONFIG_BLOCK_IDS.defaultsTool, "value", "codex"),
      viewStateValue(CONFIG_BLOCK_IDS.defaultsModel, "value", "gpt-5"),
    );

    const submit = createViewSubmitArgs("cfg_defaults", stateValues, {
      user: { id: "U_ADMIN" },
      view: {
        callback_id: "cfg_defaults",
        private_metadata: opened.view.private_metadata,
        state: { values: stateValues },
      },
    });

    await app.viewHandlers.get("cfg_defaults")?.(submit as unknown as ViewHandlerArgs);

    expect(server.state.projects.vY8joe.status.defaults).toEqual({ tool: "codex", model: "gpt-5" });

    const updated = submit.client.chat.update.lastCall()?.args[0] as { blocks: unknown[] };
    const updatedStr = JSON.stringify(updated.blocks);
    expect(updatedStr).toContain("codex");
    expect(updatedStr).toContain("gpt-5");
  });

  it("AC-11: env value never appears in rendered Block Kit text; hub shows only set count", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const envAction = createActionArgs("cfg_manage_env", {
      user: { id: "U_ADMIN" },
      channel: { id: "C_TEST" },
      message: { ts: "1719321600.000100" },
      actions: [
        {
          action_id: "cfg_manage_env",
          value: JSON.stringify({ org: "acme", projectId: "vY8joe", projectName: "crispr-bench" }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_manage_env")?.(envAction as unknown as ActionHandlerArgs);

    const openedEnv = envAction.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };

    const secret = "super-secret-api-key-xyz123";
    const envState = mergeViewState(
      viewStateValue(CONFIG_BLOCK_IDS.envKey, "value", "ENV_NEW_KEY"),
      viewStateValue(CONFIG_BLOCK_IDS.envValue, "value", secret),
    );

    const envSubmit = createViewSubmitArgs("cfg_env", envState, {
      user: { id: "U_ADMIN" },
      view: {
        callback_id: "cfg_env",
        private_metadata: openedEnv.view.private_metadata,
        state: { values: envState },
      },
    });

    await app.viewHandlers.get("cfg_env")?.(envSubmit as unknown as ViewHandlerArgs);

    const updated = envSubmit.client.chat.update.lastCall()?.args[0] as { blocks: unknown[] };
    expect(JSON.stringify(updated.blocks)).not.toContain(secret);
    expect(JSON.stringify(updated.blocks)).toContain("3 vars set");
  });

  it("AC-11: credential token never appears in rendered Block Kit text; hub shows only provider set-status", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const credAction = createActionArgs("cfg_manage_creds", {
      user: { id: "U_ADMIN" },
      channel: { id: "C_TEST" },
      message: { ts: "1719321600.000100" },
      actions: [
        {
          action_id: "cfg_manage_creds",
          value: JSON.stringify({ org: "acme", projectId: "vY8joe", projectName: "crispr-bench" }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_manage_creds")?.(credAction as unknown as ActionHandlerArgs);

    const openedCred = credAction.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };

    const credSecret = "sk-gemini-ultra-secret-token-789";
    const credState = mergeViewState(
      selectStateValue(CONFIG_BLOCK_IDS.credProvider, "value", "gemini"),
      viewStateValue(CONFIG_BLOCK_IDS.credToken, "value", credSecret),
      viewStateValue(CONFIG_BLOCK_IDS.credDelete, "value", ""),
    );

    const credSubmit = createViewSubmitArgs("cfg_creds", credState, {
      user: { id: "U_ADMIN" },
      view: {
        callback_id: "cfg_creds",
        private_metadata: openedCred.view.private_metadata,
        state: { values: credState },
      },
    });

    await app.viewHandlers.get("cfg_creds")?.(credSubmit as unknown as ViewHandlerArgs);

    const updated = credSubmit.client.chat.update.lastCall()?.args[0] as { blocks: unknown[] };
    expect(JSON.stringify(updated.blocks)).not.toContain(credSecret);
    expect(JSON.stringify(updated.blocks)).toContain("gemini ✓");
  });
});
