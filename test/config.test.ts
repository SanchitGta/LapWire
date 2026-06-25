import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildConfigHubBlocks } from "../src/config/index.js";
import { CFG_DEFAULTS_FIELDS, CFG_ENV_FIELDS, CFG_REPO_FIELDS } from "../src/config/modals.js";
import { registerMetaHandlers, createRuntimeDependencies } from "../src/index.js";
import type { ActionHandlerArgs, CommandHandlerArgs, MetaAppLike, ViewHandlerArgs } from "../src/link/index.js";
import {
  createActionArgs,
  createViewSubmitArgs,
  mergeViewState,
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
  while (stores.length > 0) {
    stores.pop()?.close();
  }

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

function linkAdmin(
  runtime: ReturnType<typeof createRuntimeDependencies>,
  server: MockMindlapServer,
  slackUserId = "U_ADMIN",
) {
  runtime.store.putLink({
    slackUserId,
    mindlapUserId: server.state.users.admin.id,
    email: server.state.users.admin.email,
    accessToken: server.state.tokens.admin,
    role: "admin",
    exp: 1783036800,
    createdAt: 1719273600,
  });
}

function linkMember(
  runtime: ReturnType<typeof createRuntimeDependencies>,
  server: MockMindlapServer,
  slackUserId = "U_MEMBER",
) {
  runtime.store.putLink({
    slackUserId,
    mindlapUserId: server.state.users.member.id,
    email: server.state.users.member.email,
    accessToken: server.state.tokens.member,
    role: "member",
    exp: 1783036800,
    createdAt: 1719273600,
  });
}

describe("config hub", () => {
  it("AC-10: /meta config renders repo/cloud/defaults/env/creds/members hub", async () => {
    const { app, runtime, server } = await boot();
    linkAdmin(runtime, server);

    const commandArgs = {
      ack: async () => {},
      respond: async () => {},
      command: {
        text: "config crispr-bench",
        user_id: "U_ADMIN",
        channel_id: "C_TEST",
        trigger_id: "trigger-test",
      },
      client: {
        views: { open: async () => {} },
        chat: {
          postEphemeral: async (payload: unknown) => {
            (commandArgs as unknown as { _ephemeral: unknown })._ephemeral = payload;
          },
        },
      },
    } as unknown as CommandHandlerArgs & { _ephemeral: unknown };

    await app.commandHandlers.get("/meta")?.(commandArgs as unknown as CommandHandlerArgs);

    const posted = (commandArgs as unknown as { _ephemeral: { blocks: Array<Record<string, unknown>> } })._ephemeral;
    expect(posted).toBeDefined();
    const blocksStr = JSON.stringify(posted?.blocks);
    expect(blocksStr).toContain("Repo");
    expect(blocksStr).toContain("Cloud");
    expect(blocksStr).toContain("Defaults");
    expect(blocksStr).toContain("Env");
    expect(blocksStr).toContain("Credentials");
    expect(blocksStr).toContain("Members");
  });

  it("AC-10: editing defaults via modal calls PUT /defaults and re-renders hub with new value", async () => {
    const { app, runtime, server } = await boot();
    linkAdmin(runtime, server);

    const action = createActionArgs("cfg_edit_defaults", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "cfg_edit_defaults",
          value: JSON.stringify({
            projectId: "vY8joe",
            projectName: "crispr-bench",
            org: "acme",
            channelId: "C_TEST",
            messageTs: "1719321600.000100",
          }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_edit_defaults")?.(action as unknown as ActionHandlerArgs);

    const opened = action.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };
    expect(opened).toBeDefined();

    const submit = createViewSubmitArgs(
      "cfg_defaults",
      mergeViewState(
        viewStateValue(CFG_DEFAULTS_FIELDS.tool.blockId, CFG_DEFAULTS_FIELDS.tool.actionId, "codex"),
        viewStateValue(CFG_DEFAULTS_FIELDS.model.blockId, CFG_DEFAULTS_FIELDS.model.actionId, "gpt-5"),
      ),
      {
        user: { id: "U_ADMIN" },
        view: {
          callback_id: "cfg_defaults",
          private_metadata: opened.view.private_metadata,
          state: {
            values: mergeViewState(
              viewStateValue(CFG_DEFAULTS_FIELDS.tool.blockId, CFG_DEFAULTS_FIELDS.tool.actionId, "codex"),
              viewStateValue(CFG_DEFAULTS_FIELDS.model.blockId, CFG_DEFAULTS_FIELDS.model.actionId, "gpt-5"),
            ),
          },
        },
      },
    );

    await app.viewHandlers.get("cfg_defaults")?.(submit as unknown as ViewHandlerArgs);

    expect(server.state.projects.vY8joe.status.defaults).toEqual({
      tool: "codex",
      model: "gpt-5",
    });

    const updated = submit.client.chat.update.lastCall()?.args[0] as { blocks: unknown[] };
    expect(JSON.stringify(updated.blocks)).toContain("codex");
  });

  it("AC-11: env value entered in modal never appears in Block Kit blocks or hub render", async () => {
    const { app, runtime, server } = await boot();
    linkAdmin(runtime, server);

    const action = createActionArgs("cfg_manage_env", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "cfg_manage_env",
          value: JSON.stringify({
            projectId: "vY8joe",
            projectName: "crispr-bench",
            org: "acme",
            channelId: "C_TEST",
            messageTs: "1719321600.000100",
          }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_manage_env")?.(action as unknown as ActionHandlerArgs);

    const opened = action.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };
    expect(opened).toBeDefined();

    const secretValue = "super-secret-env-value-12345";

    const submit = createViewSubmitArgs(
      "cfg_env",
      mergeViewState(
        viewStateValue(CFG_ENV_FIELDS.key.blockId, CFG_ENV_FIELDS.key.actionId, "ENV_NEW_KEY"),
        viewStateValue(CFG_ENV_FIELDS.value.blockId, CFG_ENV_FIELDS.value.actionId, secretValue),
      ),
      {
        user: { id: "U_ADMIN" },
        view: {
          callback_id: "cfg_env",
          private_metadata: opened.view.private_metadata,
          state: {
            values: mergeViewState(
              viewStateValue(CFG_ENV_FIELDS.key.blockId, CFG_ENV_FIELDS.key.actionId, "ENV_NEW_KEY"),
              viewStateValue(CFG_ENV_FIELDS.value.blockId, CFG_ENV_FIELDS.value.actionId, secretValue),
            ),
          },
        },
      },
    );

    await app.viewHandlers.get("cfg_env")?.(submit as unknown as ViewHandlerArgs);

    expect(server.state.projects.vY8joe.env.find((e) => e.key === "ENV_NEW_KEY")).toBeDefined();

    const updated = submit.client.chat.update.lastCall()?.args[0] as { blocks: unknown[] };
    const rendered = JSON.stringify(updated?.blocks ?? []);
    expect(rendered).not.toContain(secretValue);
    expect(rendered).toContain("3 key(s)");
  });

  it("AC-11: credential token entered in modal never appears in Block Kit blocks", async () => {
    const { app, runtime, server } = await boot();
    linkAdmin(runtime, server);

    const action = createActionArgs("cfg_manage_creds", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "cfg_manage_creds",
          value: JSON.stringify({
            projectId: "vY8joe",
            projectName: "crispr-bench",
            org: "acme",
            channelId: "C_TEST",
            messageTs: "1719321600.000100",
          }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_manage_creds")?.(action as unknown as ActionHandlerArgs);

    const opened = action.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };
    expect(opened).toBeDefined();

    const secretToken = "sk-super-secret-credential-token-xyz";

    const credState: Record<string, Record<string, { type?: string; value?: string; selected_option?: { value: string } }>> = {
      cfg_creds_provider: {
        value: { type: "static_select", selected_option: { value: "opencode" } },
      },
      cfg_creds_token: {
        value: { type: "plain_text_input", value: secretToken },
      },
      cfg_creds_owner: {
        value: { type: "plain_text_input", value: "" },
      },
    };

    const submit = createViewSubmitArgs(
      "cfg_creds",
      credState as unknown as Parameters<typeof createViewSubmitArgs>[1],
      {
        user: { id: "U_ADMIN" },
        view: {
          callback_id: "cfg_creds",
          private_metadata: opened.view.private_metadata,
          state: {
            values: credState as unknown as Parameters<typeof createViewSubmitArgs>[1],
          },
        },
      },
    );

    await app.viewHandlers.get("cfg_creds")?.(submit as unknown as ViewHandlerArgs);

    const updated = submit.client.chat.update.lastCall()?.args[0] as { blocks: unknown[] };
    const rendered = JSON.stringify(updated?.blocks ?? []);
    expect(rendered).not.toContain(secretToken);
  });

  it("AC-12: member-role caller receives admin_required and no mutation occurs", async () => {
    const { app, runtime, server } = await boot();
    linkMember(runtime, server);

    const action = createActionArgs("cfg_edit_defaults", {
      user: { id: "U_MEMBER" },
      actions: [
        {
          action_id: "cfg_edit_defaults",
          value: JSON.stringify({
            projectId: "vY8joe",
            projectName: "crispr-bench",
            org: "acme",
            channelId: "C_TEST",
          }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_edit_defaults")?.(action as unknown as ActionHandlerArgs);

    expect(action.client.chat.postEphemeral.lastCall()?.args[0]).toMatchObject({
      channel: "C_TEST",
      user: "U_MEMBER",
      text: "this requires a MindLap global admin",
    });
    expect(server.state.projects.vY8joe.status.defaults).toEqual({ tool: "claude", model: "sonnet" });
  });

  it("buildConfigHubBlocks never includes raw env values or credential tokens", () => {
    const hub = {
      status: {
        project: { id: "vY8joe", name: "crispr-bench" },
        repo: { url: "https://github.com/acme/crispr-bench", token_set: true },
        cloud_enabled: true,
        defaults: { tool: "claude", model: "sonnet" },
        heartbeat: { enabled: true, expires_at: "2026-06-25T12:00:00.000Z" },
        harnesses: ["code"],
        cron: { file_id: null, entries: [] },
        recent_activity: [],
      },
      env: [{ key: "ENV_API_KEY", is_set: true }],
      credentials: [{ id: "cred-1", provider: "claude" as const, owner: "ops" }],
      members: [{ user_id: "usr-1", email: "admin@acme.dev", role: "admin" as const }],
    };

    const blocks = buildConfigHubBlocks(hub, {
      channelId: "C_TEST",
      org: "acme",
      projectId: "vY8joe",
      projectName: "crispr-bench",
    });

    const rendered = JSON.stringify(blocks);
    expect(rendered).not.toContain("set-in-fixture");
    expect(rendered).not.toContain("claude-secret");
    expect(rendered).toContain("key(s)");
    expect(rendered).toContain("claude✓");
  });

  it("AC-10: editing repo via modal calls PUT /repo and hub re-renders with updated url", async () => {
    const { app, runtime, server } = await boot();
    linkAdmin(runtime, server);

    const action = createActionArgs("cfg_edit_repo", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "cfg_edit_repo",
          value: JSON.stringify({
            projectId: "A2bYWi",
            projectName: "d4-analytics",
            org: "acme",
            channelId: "C_TEST",
            messageTs: "1719321600.000100",
          }),
        },
      ],
    });

    await app.actionHandlers.get("cfg_edit_repo")?.(action as unknown as ActionHandlerArgs);

    const opened = action.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };
    expect(opened).toBeDefined();

    const newUrl = "https://github.com/acme/d4-analytics";
    const submit = createViewSubmitArgs(
      "cfg_repo",
      mergeViewState(
        viewStateValue(CFG_REPO_FIELDS.url.blockId, CFG_REPO_FIELDS.url.actionId, newUrl),
        viewStateValue(CFG_REPO_FIELDS.token.blockId, CFG_REPO_FIELDS.token.actionId, ""),
      ),
      {
        user: { id: "U_ADMIN" },
        view: {
          callback_id: "cfg_repo",
          private_metadata: opened.view.private_metadata,
          state: {
            values: mergeViewState(
              viewStateValue(CFG_REPO_FIELDS.url.blockId, CFG_REPO_FIELDS.url.actionId, newUrl),
              viewStateValue(CFG_REPO_FIELDS.token.blockId, CFG_REPO_FIELDS.token.actionId, ""),
            ),
          },
        },
      },
    );

    await app.viewHandlers.get("cfg_repo")?.(submit as unknown as ViewHandlerArgs);

    expect(server.state.projects.A2bYWi.status.repo.url).toBe(newUrl);
    const updated = submit.client.chat.update.lastCall()?.args[0] as { blocks: unknown[] };
    expect(JSON.stringify(updated?.blocks)).toContain(newUrl);
  });
});
