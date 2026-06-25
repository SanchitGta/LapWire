import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerMetaHandlers, createRuntimeDependencies } from "../src/index.js";
import { buildLifecycleStatusCard } from "../src/lifecycle/index.js";
import { DISABLE_HEARTBEAT_FIELDS, START_MODAL_FIELDS } from "../src/lifecycle/modals.js";
import type { ActionHandlerArgs, CommandHandlerArgs, MetaAppLike, ViewHandlerArgs } from "../src/link/index.js";
import {
  checkboxStateValue,
  createActionArgs,
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
  while (stores.length > 0) {
    stores.pop()?.close();
  }

  await Promise.all(servers.splice(0, servers.length).map((server) => server.stop()));
});

async function boot() {
  const server = await startMockMindlap();
  servers.push(server);

  const workspace = mkdtempSync(join(tmpdir(), "lapwire-lifecycle-"));
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

describe("lifecycle controls", () => {
  it("opens a prefilled start modal and starts a lap with heartbeat enabled by default", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const action = createActionArgs("start_lap", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "start_lap",
          value: JSON.stringify({
            projectId: "vY8joe",
            projectName: "crispr-bench",
            org: "acme",
          }),
        },
      ],
    });

    await app.actionHandlers.get("start_lap")?.(action as unknown as ActionHandlerArgs);

    const opened = action.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string; blocks: Array<Record<string, unknown>> };
    };
    const blocks = opened.view.blocks;
    expect(blocks[0]).toMatchObject({
      block_id: START_MODAL_FIELDS.lapNumber.blockId,
      element: { initial_value: "3" },
    });
    expect(blocks[3]).toMatchObject({
      block_id: START_MODAL_FIELDS.tool.blockId,
      element: { initial_value: "claude" },
    });
    expect(blocks[4]).toMatchObject({
      block_id: START_MODAL_FIELDS.model.blockId,
      element: { initial_value: "sonnet" },
    });
    expect(blocks[6]).toMatchObject({
      block_id: START_MODAL_FIELDS.heartbeat.blockId,
      element: { initial_options: [{ value: "enabled" }] },
    });

    const submit = createViewSubmitArgs(
      "start_form",
      mergeViewState(
        viewStateValue(START_MODAL_FIELDS.lapNumber.blockId, START_MODAL_FIELDS.lapNumber.actionId, "4"),
        viewStateValue(START_MODAL_FIELDS.schedule.blockId, START_MODAL_FIELDS.schedule.actionId, "*/15 * * * *"),
        viewStateValue(START_MODAL_FIELDS.agent.blockId, START_MODAL_FIELDS.agent.actionId, "meta-engineer"),
        viewStateValue(START_MODAL_FIELDS.tool.blockId, START_MODAL_FIELDS.tool.actionId, "claude"),
        viewStateValue(START_MODAL_FIELDS.model.blockId, START_MODAL_FIELDS.model.actionId, "sonnet"),
        selectStateValue(START_MODAL_FIELDS.queue.blockId, START_MODAL_FIELDS.queue.actionId, "cloud"),
        checkboxStateValue(START_MODAL_FIELDS.heartbeat.blockId, START_MODAL_FIELDS.heartbeat.actionId, ["enabled"]),
      ),
      {
        user: { id: "U_ADMIN" },
        view: {
          callback_id: "start_form",
          private_metadata: opened.view.private_metadata,
          state: {
            values: mergeViewState(
              viewStateValue(START_MODAL_FIELDS.lapNumber.blockId, START_MODAL_FIELDS.lapNumber.actionId, "4"),
              viewStateValue(START_MODAL_FIELDS.schedule.blockId, START_MODAL_FIELDS.schedule.actionId, "*/15 * * * *"),
              viewStateValue(START_MODAL_FIELDS.agent.blockId, START_MODAL_FIELDS.agent.actionId, "meta-engineer"),
              viewStateValue(START_MODAL_FIELDS.tool.blockId, START_MODAL_FIELDS.tool.actionId, "claude"),
              viewStateValue(START_MODAL_FIELDS.model.blockId, START_MODAL_FIELDS.model.actionId, "sonnet"),
              selectStateValue(START_MODAL_FIELDS.queue.blockId, START_MODAL_FIELDS.queue.actionId, "cloud"),
              checkboxStateValue(START_MODAL_FIELDS.heartbeat.blockId, START_MODAL_FIELDS.heartbeat.actionId, ["enabled"]),
            ),
          },
        },
      },
    );

    await app.viewHandlers.get("start_form")?.(submit as unknown as ViewHandlerArgs);

    expect(server.state.projects.vY8joe.status.heartbeat).toEqual({
      enabled: true,
      expires_at: "2026-06-26T00:00:00.000Z",
    });
    expect(server.state.projects.vY8joe.status.cron.entries.at(-1)).toMatchObject({
      name: "factory-lap-4",
      schedule: "*/15 * * * *",
      enabled: true,
      queue: "cloud",
      tool: "claude",
      model: "sonnet",
    });

    const updated = submit.client.chat.update.lastCall()?.args[0] as {
      blocks: Array<{ text?: { text: string } }>;
    };
    expect(JSON.stringify(updated.blocks)).toContain("factory-lap-4");
    expect(JSON.stringify(updated.blocks)).toContain("Enabled");
    expect(submit.client.chat.postMessage.lastCall()?.args[0]).toMatchObject({
      channel: "C_TEST",
      thread_ts: "1719321600.000100",
      text: "↳ <@U_ADMIN> started crispr-bench/factory-lap-4",
    });
  });

  it("renders a native confirm for stop and disables the active entry after confirmation", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const blocks = buildLifecycleStatusCard(server.state.projects.vY8joe.status, "acme");
    const actionsBlock = blocks[3] as { elements: Array<Record<string, unknown>> };
    expect(actionsBlock.elements[1]).toMatchObject({
      action_id: "stop_lap",
      confirm: {
        title: { text: "Stop this lap?" },
      },
    });

    const action = createActionArgs("stop_lap", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "stop_lap",
          value: JSON.stringify({
            projectId: "vY8joe",
            projectName: "crispr-bench",
            org: "acme",
          }),
        },
      ],
    });

    await app.actionHandlers.get("stop_lap")?.(action as unknown as ActionHandlerArgs);

    expect(server.state.projects.vY8joe.status.cron.entries[0]?.enabled).toBe(false);
    const updated = action.client.chat.update.lastCall()?.args[0] as {
      blocks: Array<{ text?: { text: string } }>;
    };
    expect(JSON.stringify(updated.blocks)).toContain("Disabled");
  });

  it("re-arms heartbeat and refreshes the card with the new expiry", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const action = createActionArgs("rearm_hb", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "rearm_hb",
          value: JSON.stringify({
            projectId: "A2bYWi",
            projectName: "d4-analytics",
            org: "acme",
          }),
        },
      ],
    });

    await app.actionHandlers.get("rearm_hb")?.(action as unknown as ActionHandlerArgs);

    expect(server.state.projects.A2bYWi.status.heartbeat).toEqual({
      enabled: true,
      expires_at: "2026-06-26T00:00:00.000Z",
    });
    const updated = action.client.chat.update.lastCall()?.args[0] as {
      blocks: Array<{ text?: { text: string } }>;
    };
    expect(JSON.stringify(updated.blocks)).toContain("2026-06-26T00:00:00.000Z");
  });

  it("blocks disable-heartbeat on project-name mismatch and only mutates after an exact match", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_ADMIN", role: "admin" });

    const action = createActionArgs("disable_hb", {
      user: { id: "U_ADMIN" },
      actions: [
        {
          action_id: "disable_hb",
          value: JSON.stringify({
            projectId: "vY8joe",
            projectName: "crispr-bench",
            org: "acme",
          }),
        },
      ],
    });

    await app.actionHandlers.get("disable_hb")?.(action as unknown as ActionHandlerArgs);

    const opened = action.client.views.open.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };

    const mismatch = createViewSubmitArgs(
      "disable_hb_confirm",
      viewStateValue(
        DISABLE_HEARTBEAT_FIELDS.projectName.blockId,
        DISABLE_HEARTBEAT_FIELDS.projectName.actionId,
        "crispr bench",
      ),
      {
        user: { id: "U_ADMIN" },
        view: {
          callback_id: "disable_hb_confirm",
          private_metadata: opened.view.private_metadata,
          state: {
            values: viewStateValue(
              DISABLE_HEARTBEAT_FIELDS.projectName.blockId,
              DISABLE_HEARTBEAT_FIELDS.projectName.actionId,
              "crispr bench",
            ),
          },
        },
      },
    );

    await app.viewHandlers.get("disable_hb_confirm")?.(mismatch as unknown as ViewHandlerArgs);

    expect(mismatch.ack.lastCall()?.args[0]).toEqual({
      response_action: "errors",
      errors: {
        disable_hb_project_name: "Project name must match exactly.",
      },
    });
    expect(server.state.projects.vY8joe.status.heartbeat.enabled).toBe(true);
    expect(mismatch.client.chat.update.calls).toHaveLength(0);

    const confirm = createViewSubmitArgs(
      "disable_hb_confirm",
      viewStateValue(
        DISABLE_HEARTBEAT_FIELDS.projectName.blockId,
        DISABLE_HEARTBEAT_FIELDS.projectName.actionId,
        "crispr-bench",
      ),
      {
        user: { id: "U_ADMIN" },
        view: {
          callback_id: "disable_hb_confirm",
          private_metadata: opened.view.private_metadata,
          state: {
            values: viewStateValue(
              DISABLE_HEARTBEAT_FIELDS.projectName.blockId,
              DISABLE_HEARTBEAT_FIELDS.projectName.actionId,
              "crispr-bench",
            ),
          },
        },
      },
    );

    await app.viewHandlers.get("disable_hb_confirm")?.(confirm as unknown as ViewHandlerArgs);

    expect(server.state.projects.vY8joe.status.heartbeat).toEqual({
      enabled: false,
      expires_at: null,
    });
  });

  it("surfaces admin_required and does not mutate state for non-admin callers", async () => {
    const { app, runtime, server } = await boot();
    linkUser(runtime, server, { slackUserId: "U_MEMBER", role: "member" });

    const action = createActionArgs("rearm_hb", {
      user: { id: "U_MEMBER" },
      actions: [
        {
          action_id: "rearm_hb",
          value: JSON.stringify({
            projectId: "A2bYWi",
            projectName: "d4-analytics",
            org: "acme",
          }),
        },
      ],
    });

    await app.actionHandlers.get("rearm_hb")?.(action as unknown as ActionHandlerArgs);

    expect(action.client.chat.postEphemeral.lastCall()?.args[0]).toEqual({
      channel: "C_TEST",
      user: "U_MEMBER",
      text: "this requires a MindLap global admin",
    });
    expect(server.state.projects.A2bYWi.status.heartbeat).toEqual({
      enabled: false,
      expires_at: null,
    });
  });
});
