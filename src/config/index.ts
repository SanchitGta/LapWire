import { ACTION_IDS, button, section } from "../blocks/common.js";
import { createMetaClient } from "../metaClient.js";
import type {
  CredentialSummary,
  DefaultsConfig,
  EnvVarSummary,
  FactoryStatus,
  MemberSummary,
  MetaClient,
} from "../metaClient.js";
import type {
  ActionHandlerArgs,
  LinkDependencies,
  MetaAppLike,
  ViewHandlerArgs,
} from "../link/index.js";
import {
  buildCredentialsModal,
  buildDefaultsModal,
  buildEnvModal,
  buildRepoModal,
  CONFIG_BLOCK_IDS,
  CONFIG_CALLBACK_IDS,
  parseConfigHubContext,
  parseCredentialsSubmission,
  parseDefaultsSubmission,
  parseEnvSubmission,
  parseRepoSubmission,
  type ConfigHubContext,
} from "./modals.js";

export type ConfigDependencies = LinkDependencies & {
  metaBaseUrl: string;
  metaOrg: string;
};

type HubActionValue = {
  org: string;
  projectId: string;
  projectName: string;
};

export function registerConfigHandlers(app: MetaAppLike, dependencies: ConfigDependencies): void {
  dependencies.commandHandlers.config = async (args) => {
    await args.ack();

    const parts = args.command.text.trim().split(/\s+/).filter(Boolean);
    const projectName = parts[1] ?? "";

    if (!projectName) {
      await args.respond({ text: "Usage: /meta config <project>" });
      return;
    }

    const linked = dependencies.store.getLink(args.command.user_id);
    if (!linked || isExpired(linked.exp, dependencies.now)) {
      await args.respond({ text: "Not linked — run /meta link" });
      return;
    }

    try {
      const metaClient = createClient(dependencies, linked.accessToken);
      const project = await resolveProjectByName(metaClient, dependencies.metaOrg, projectName);

      const [status, defaults, env, credentials, members] = await Promise.all([
        metaClient.getFactoryStatus(project.id, dependencies.metaOrg),
        metaClient.getDefaults(project.id),
        metaClient.listEnv(project.id),
        metaClient.listCredentials(project.id),
        metaClient.listMembers(project.id),
      ]);

      const ctx: ConfigHubContext = {
        channelId: args.command.channel_id,
        org: dependencies.metaOrg,
        projectId: project.id,
        projectName: project.name,
      };

      await args.respond({
        text: `${project.name} config hub`,
        blocks: buildConfigHubCard(status, defaults, env, credentials, members, ctx),
      });
    } catch (error) {
      await args.respond({ text: toUserMessage(error) });
    }
  };

  app.action?.(ACTION_IDS.editRepo, async (args) => {
    await args.ack();

    try {
      const value = readActionValue(args.action.value);
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);
      const status = await metaClient.getFactoryStatus(value.projectId, value.org);
      const ctx = buildCtxFromAction(args, value);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildRepoModal(status, ctx),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.toggleCloud, async (args) => {
    await args.ack();

    try {
      const value = readActionValue(args.action.value);
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);
      const status = await metaClient.getFactoryStatus(value.projectId, value.org);

      await metaClient.updateCloud(value.projectId, { enabled: !status.cloud_enabled });
      await refreshHub(args, metaClient, value);
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.editDefaults, async (args) => {
    await args.ack();

    try {
      const value = readActionValue(args.action.value);
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);
      const status = await metaClient.getFactoryStatus(value.projectId, value.org);
      const ctx = buildCtxFromAction(args, value);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildDefaultsModal(status, ctx),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.manageEnv, async (args) => {
    await args.ack();

    try {
      const value = readActionValue(args.action.value);
      requireLinkedUser(dependencies, args.body.user.id);
      const ctx = buildCtxFromAction(args, value);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildEnvModal(ctx),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.manageCredentials, async (args) => {
    await args.ack();

    try {
      const value = readActionValue(args.action.value);
      requireLinkedUser(dependencies, args.body.user.id);
      const ctx = buildCtxFromAction(args, value);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildCredentialsModal(ctx),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.view(CONFIG_CALLBACK_IDS.repo, async (args) => {
    const ctx = parseConfigHubContext(args.body.view.private_metadata);
    const submission = parseRepoSubmission(args.body.view.state.values);

    if (!submission.url) {
      await args.ack({
        response_action: "errors",
        errors: { [CONFIG_BLOCK_IDS.repoUrl]: "Repo URL is required." },
      });
      return;
    }

    try {
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);

      await metaClient.updateRepo(ctx.projectId, submission);
      await args.ack();
      await refreshHubFromModal(args, metaClient, ctx);
    } catch (error) {
      await args.ack({
        response_action: "errors",
        errors: { [CONFIG_BLOCK_IDS.repoUrl]: toUserMessage(error) },
      });
    }
  });

  app.view(CONFIG_CALLBACK_IDS.defaults, async (args) => {
    const ctx = parseConfigHubContext(args.body.view.private_metadata);
    const submission = parseDefaultsSubmission(args.body.view.state.values);

    try {
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);

      await metaClient.updateDefaults(ctx.projectId, submission);
      await args.ack();
      await refreshHubFromModal(args, metaClient, ctx);
    } catch (error) {
      await args.ack({
        response_action: "errors",
        errors: { [CONFIG_BLOCK_IDS.defaultsTool]: toUserMessage(error) },
      });
    }
  });

  app.view(CONFIG_CALLBACK_IDS.env, async (args) => {
    const ctx = parseConfigHubContext(args.body.view.private_metadata);
    const submission = parseEnvSubmission(args.body.view.state.values);

    if (!submission.key) {
      await args.ack({
        response_action: "errors",
        errors: { [CONFIG_BLOCK_IDS.envKey]: "Key is required." },
      });
      return;
    }

    try {
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);

      if (submission.delete) {
        await metaClient.deleteEnv(ctx.projectId, submission.key);
      } else {
        await metaClient.setEnv(ctx.projectId, submission.key, { value: submission.value });
      }

      await args.ack();
      await refreshHubFromModal(args, metaClient, ctx);
    } catch (error) {
      await args.ack({
        response_action: "errors",
        errors: { [CONFIG_BLOCK_IDS.envKey]: toUserMessage(error) },
      });
    }
  });

  app.view(CONFIG_CALLBACK_IDS.credentials, async (args) => {
    const ctx = parseConfigHubContext(args.body.view.private_metadata);
    const submission = parseCredentialsSubmission(args.body.view.state.values);

    try {
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);

      if (submission.deleteId) {
        await metaClient.deleteCredential(ctx.projectId, submission.deleteId);
      } else {
        await metaClient.createCredential(ctx.projectId, {
          provider: submission.provider,
          token: submission.token,
        });
      }

      await args.ack();
      await refreshHubFromModal(args, metaClient, ctx);
    } catch (error) {
      await args.ack({
        response_action: "errors",
        errors: { [CONFIG_BLOCK_IDS.credProvider]: toUserMessage(error) },
      });
    }
  });
}

function buildConfigHubCard(
  status: FactoryStatus,
  defaults: DefaultsConfig,
  env: EnvVarSummary[],
  credentials: CredentialSummary[],
  members: MemberSummary[],
  ctx: ConfigHubContext,
): unknown[] {
  const actionValue = JSON.stringify({
    org: ctx.org,
    projectId: ctx.projectId,
    projectName: ctx.projectName,
  } satisfies HubActionValue);

  const credSet = new Set(credentials.map((c) => c.provider));
  const credStatus = (["claude", "codex", "gemini", "opencode"] as const)
    .map((p) => `${p} ${credSet.has(p) ? "✓" : "–"}`)
    .join(" ");

  const adminCount = members.filter((m) => m.role === "admin").length;
  const memberCount = members.filter((m) => m.role === "member").length;
  const envCount = env.length;

  return [
    section(`*${ctx.projectName}* config hub`),
    section(
      `*Repo:* ${status.repo.url ?? "—"} (token ${status.repo.token_set ? "set" : "not set"})`,
      { accessory: button({ actionId: ACTION_IDS.editRepo, text: "Edit Repo", value: actionValue }) },
    ),
    section(
      `*Cloud:* ${status.cloud_enabled ? "🟢 enabled" : "⚪ disabled"}`,
      { accessory: button({ actionId: ACTION_IDS.toggleCloud, text: "Toggle Cloud", value: actionValue }) },
    ),
    section(
      `*Defaults:* ${defaults.tool ?? "—"} · ${defaults.model ?? "—"}`,
      { accessory: button({ actionId: ACTION_IDS.editDefaults, text: "Edit Defaults", value: actionValue }) },
    ),
    section(
      `*Env:* ${envCount} var${envCount === 1 ? "" : "s"} set`,
      { accessory: button({ actionId: ACTION_IDS.manageEnv, text: "Manage Env", value: actionValue }) },
    ),
    section(
      `*Credentials:* ${credStatus}`,
      { accessory: button({ actionId: ACTION_IDS.manageCredentials, text: "Manage Creds", value: actionValue }) },
    ),
    section(
      `*Members:* ${members.length} total · ${adminCount} admin · ${memberCount} member`,
    ),
  ];
}

async function refreshHub(
  args: ActionHandlerArgs,
  metaClient: MetaClient,
  value: HubActionValue,
): Promise<void> {
  const ctx: ConfigHubContext = {
    channelId: args.body.channel?.id ?? "",
    messageTs: args.body.message?.ts,
    org: value.org,
    projectId: value.projectId,
    projectName: value.projectName,
  };

  const [status, defaults, env, credentials, members] = await Promise.all([
    metaClient.getFactoryStatus(value.projectId, value.org),
    metaClient.getDefaults(value.projectId),
    metaClient.listEnv(value.projectId),
    metaClient.listCredentials(value.projectId),
    metaClient.listMembers(value.projectId),
  ]);

  await args.client.chat.update?.({
    channel: ctx.channelId,
    ts: ctx.messageTs,
    text: `${value.projectName} config hub`,
    blocks: buildConfigHubCard(status, defaults, env, credentials, members, ctx),
  });
}

async function refreshHubFromModal(
  args: ViewHandlerArgs,
  metaClient: MetaClient,
  ctx: ConfigHubContext,
): Promise<void> {
  if (!ctx.channelId || !ctx.messageTs) {
    return;
  }

  const [status, defaults, env, credentials, members] = await Promise.all([
    metaClient.getFactoryStatus(ctx.projectId, ctx.org),
    metaClient.getDefaults(ctx.projectId),
    metaClient.listEnv(ctx.projectId),
    metaClient.listCredentials(ctx.projectId),
    metaClient.listMembers(ctx.projectId),
  ]);

  await args.client.chat.update?.({
    channel: ctx.channelId,
    ts: ctx.messageTs,
    text: `${ctx.projectName} config hub`,
    blocks: buildConfigHubCard(status, defaults, env, credentials, members, ctx),
  });
}

function createClient(dependencies: ConfigDependencies, accessToken: string): MetaClient {
  return createMetaClient({
    baseUrl: dependencies.metaBaseUrl,
    getAccessToken: () => accessToken,
  });
}

async function resolveProjectByName(metaClient: MetaClient, org: string, projectName: string) {
  const projects = await metaClient.listProjects(org);
  const match = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());

  if (!match) {
    throw new Error(`Project "${projectName}" not found.`);
  }

  return match;
}

function requireLinkedUser(dependencies: ConfigDependencies, slackUserId: string) {
  const linked = dependencies.store.getLink(slackUserId);
  if (!linked || isExpired(linked.exp, dependencies.now)) {
    throw new Error("Not linked — run /meta link");
  }

  return linked;
}

function isExpired(exp: number, nowProvider?: () => Date): boolean {
  const nowSeconds = Math.floor((nowProvider ?? (() => new Date()))().getTime() / 1000);
  return exp <= nowSeconds;
}

function buildCtxFromAction(args: ActionHandlerArgs, value: HubActionValue): ConfigHubContext {
  return {
    channelId: args.body.channel?.id ?? "",
    messageTs: args.body.message?.ts,
    org: value.org,
    projectId: value.projectId,
    projectName: value.projectName,
  };
}

function readActionValue(value: string | undefined): HubActionValue {
  if (!value) {
    throw new Error("Missing config action payload.");
  }

  return JSON.parse(value) as HubActionValue;
}

async function postEphemeralError(args: ActionHandlerArgs, error: unknown): Promise<void> {
  await args.client.chat.postEphemeral({
    channel: args.body.channel?.id,
    user: args.body.user.id,
    text: toUserMessage(error),
  });
}

function toUserMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete config action.";
}
