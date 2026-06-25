import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeDependencies, registerMetaHandlers } from "../src/index.js";
import type { CommandHandlerArgs, MetaAppLike, ViewHandlerArgs } from "../src/link/index.js";
import { createCommandArgs, createViewSubmitArgs, viewStateValue } from "./mocks/slack.js";
import { startMockMindlap, type MockMindlapServer } from "./mocks/mindlap.js";

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

async function boot() {
  const server = await startMockMindlap();
  servers.push(server);

  const app = new FakeApp();
  const workspace = mkdtempSync(join(tmpdir(), "lapwire-link-"));
  const dbPath = join(workspace, "lapwire.db");
  const runtime = createRuntimeDependencies({
    apiBase: server.apiBase,
    dbPath,
    encryptionKey: "test-encryption-key",
    now: () => new Date("2026-06-25T00:00:00.000Z"),
  });
  stores.push(runtime.store);

  registerMetaHandlers(app, runtime);

  return {
    server,
    app,
    runtime,
    dbPath,
  };
}

describe("link flow", () => {
  it("stores an encrypted link and reports whoami after a successful OTP flow", async () => {
    const { app, runtime, dbPath, server } = await boot();
    const command = createCommandArgs({
      text: "link",
      user_id: "U_LINK",
      channel_id: "C_LINK",
      trigger_id: "trigger-link",
    });

    await app.commandHandlers.get("/meta")?.(command as unknown as CommandHandlerArgs);

    expect(command.ack.calls).toHaveLength(1);
    const emailOpen = command.client.views.open.lastCall()?.args[0] as {
      trigger_id: string;
      view: { callback_id: string; private_metadata: string };
    };
    expect(emailOpen.trigger_id).toBe("trigger-link");
    expect(emailOpen.view.callback_id).toBe("link_email");

    const emailSubmit = createViewSubmitArgs(
      "link_email",
      viewStateValue("email_input", "email_value", server.state.users.admin.email),
      {
        trigger_id: "trigger-email",
        view: {
          callback_id: "link_email",
          private_metadata: emailOpen.view.private_metadata,
          state: {
            values: viewStateValue("email_input", "email_value", server.state.users.admin.email),
          },
        },
      },
    );

    await app.viewHandlers.get("link_email")?.(emailSubmit as unknown as ViewHandlerArgs);

    const otpPush = emailSubmit.client.views.push.lastCall()?.args[0] as {
      trigger_id: string;
      view: { callback_id: string; private_metadata: string };
    };
    expect(otpPush.trigger_id).toBe("trigger-email");
    expect(otpPush.view.callback_id).toBe("link_otp");

    const otpSubmit = createViewSubmitArgs(
      "link_otp",
      viewStateValue("otp_input", "otp_value", server.state.otp.valid),
      {
        trigger_id: "trigger-otp",
        user: { id: "U_LINK" },
        view: {
          callback_id: "link_otp",
          private_metadata: otpPush.view.private_metadata,
          state: {
            values: viewStateValue("otp_input", "otp_value", server.state.otp.valid),
          },
        },
      } as never,
    );

    await app.viewHandlers.get("link_otp")?.(otpSubmit as unknown as ViewHandlerArgs);

    expect(otpSubmit.client.chat.postEphemeral.lastCall()?.args[0]).toEqual({
      channel: "C_LINK",
      user: "U_LINK",
      text: "✅ Linked as testuser@mindlap.dev (admin)",
    });

    const stored = runtime.store.getLink("U_LINK");
    expect(stored).toMatchObject({
      slackUserId: "U_LINK",
      mindlapUserId: server.state.users.admin.id,
      email: server.state.users.admin.email,
      role: "admin",
      exp: 1783036800,
    });

    const dbBytes = readFileSync(dbPath);
    expect(dbBytes.includes(Buffer.from(server.state.tokens.admin))).toBe(false);

    const whoami = createCommandArgs({
      text: "whoami",
      user_id: "U_LINK",
    });
    await app.commandHandlers.get("/meta")?.(whoami as unknown as CommandHandlerArgs);
    expect(whoami.respond.lastCall()?.args[0]).toEqual({
      text: "Linked as testuser@mindlap.dev (admin) — valid 8d 0h",
    });
  });

  it("surfaces bad OTP errors and does not persist a link", async () => {
    const { app, runtime, server } = await boot();
    const emailSubmit = createViewSubmitArgs(
      "link_email",
      viewStateValue("email_input", "email_value", server.state.users.admin.email),
      {
        trigger_id: "trigger-email",
        view: {
          callback_id: "link_email",
          private_metadata: JSON.stringify({ channelId: "C_TEST", email: "" }),
          state: {
            values: viewStateValue("email_input", "email_value", server.state.users.admin.email),
          },
        },
      },
    );
    await app.viewHandlers.get("link_email")?.(emailSubmit as unknown as ViewHandlerArgs);

    const otpPush = emailSubmit.client.views.push.lastCall()?.args[0] as {
      view: { private_metadata: string };
    };
    const otpSubmit = createViewSubmitArgs(
      "link_otp",
      viewStateValue("otp_input", "otp_value", "000000"),
      {
        user: { id: "U_LINK" },
        view: {
          callback_id: "link_otp",
          private_metadata: otpPush.view.private_metadata,
          state: {
            values: viewStateValue("otp_input", "otp_value", "000000"),
          },
        },
      },
    );

    await app.viewHandlers.get("link_otp")?.(otpSubmit as unknown as ViewHandlerArgs);

    expect(otpSubmit.ack.lastCall()?.args[0]).toEqual({
      response_action: "errors",
      errors: {
        otp_input: "Invalid OTP code.",
      },
    });
    expect(runtime.store.getLink("U_LINK")).toBeNull();
  });

  it("unlinks a stored identity and reports not linked afterwards", async () => {
    const { app, runtime, server } = await boot();
    runtime.store.putLink({
      slackUserId: "U_LINK",
      mindlapUserId: server.state.users.admin.id,
      email: server.state.users.admin.email,
      accessToken: server.state.tokens.admin,
      role: "admin",
      exp: 1783036800,
      createdAt: 1719273600,
    });

    const unlink = createCommandArgs({
      text: "unlink",
      user_id: "U_LINK",
    });
    await app.commandHandlers.get("/meta")?.(unlink as unknown as CommandHandlerArgs);
    expect(unlink.respond.lastCall()?.args[0]).toEqual({
      text: "Unlinked your MindLap account.",
    });

    const whoami = createCommandArgs({
      text: "whoami",
      user_id: "U_LINK",
    });
    await app.commandHandlers.get("/meta")?.(whoami as unknown as CommandHandlerArgs);
    expect(whoami.respond.lastCall()?.args[0]).toEqual({
      text: "Not linked — run /meta link",
    });
  });

  it("treats expired links as expired in whoami output", async () => {
    const { app, runtime, server } = await boot();
    runtime.store.putLink({
      slackUserId: "U_LINK",
      mindlapUserId: server.state.users.admin.id,
      email: server.state.users.admin.email,
      accessToken: server.state.tokens.expiredAdmin,
      role: "admin",
      exp: 1719187200,
      createdAt: 1719180000,
    });

    const whoami = createCommandArgs({
      text: "whoami",
      user_id: "U_LINK",
    });
    await app.commandHandlers.get("/meta")?.(whoami as unknown as CommandHandlerArgs);
    expect(whoami.respond.lastCall()?.args[0]).toEqual({
      text: "⚠ link expired — run /meta link",
    });
  });
});
