import { ACTION_IDS, button, section } from "../blocks/common.js";
import { AdminRequiredError, InvalidTokenError, UnauthorizedError } from "../errors.js";
import {
  createMetaClient,
  type CredentialSummary,
  type EnvVarSummary,
  type FactoryStatus,
  type MemberSummary,
  type MetaClient,
} from "../metaClient.js";
import type { ActionHandlerArgs, LinkDependencies, MetaAppLike, ViewHandlerArgs } from "../link/index.js";
import type { LinkStore, StoredLink } from "../store.js";
import {
  buildCredsModal,
  buildDefaultsModal,
  buildEnvModal,
  buildRepoModal,
  CFG_CREDS_CALLBACK_ID,
  CFG_CREDS_FIELDS,
  CFG_DEFAULTS_CALLBACK_ID,
  CFG_DEFAULTS_FIELDS,
  CFG_ENV_CALLBACK_ID,
  CFG_ENV_FIELDS,
  CFG_REPO_CALLBACK_ID,
  CFG_REPO_FIELDS,
  type ConfigModalMetadata,
} from "./modals.js";

export type ConfigDependencies = LinkDependencies & {
  metaBaseUrl: string;
  metaOrg: string;
  metaClientFactory?: (options: { accessToken: string }) => MetaClient;
};

type HubData = {
  status: FactoryStatus;
  env: EnvVarSummary[];
  credentials: CredentialSummary[];
  members: MemberSummary[];
};

export function registerConfigHandlers(app: MetaAppLike, dependencies: ConfigDependencies): void {
  dependencies.commandHandlers.config = async (args) => {
    await args.ack();

    const projectName = readProjectArg(args.command.text);
    if (!projectName) {
      await args.respond({ text: "Usage: /meta config <project>" });
      return;
    }

    const linked = getLinkedUser(dependencies.store, args.command.user_id, dependencies.now);
    if (!linked.ok) {
      await args.respond({ text: linked.message });
      return;
    }

    try {
      const client = createClient(dependencies, linked.link.accessToken);
      const projects = await client.listProjects(dependencies.metaOrg);
      const project = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());

      if (!project) {
        await args.respond({
          text: `Project "${projectName}" was not found in ${dependencies.metaOrg}.`,
        });
        return;
      }

      const hub = await fetchHubData(client, project.id, dependencies.metaOrg);

      await (args.client.chat as { postEphemeral: (payload: unknown) => Promise<unknown> }).postEphemeral({
        channel: args.command.channel_id,
        user: args.command.user_id,
        text: `Config hub for ${project.name}`,
        blocks: buildConfigHubBlocks(hub, {
          channelId: args.command.channel_id,
          org: dependencies.metaOrg,
          projectId: project.id,
          projectName: project.name,
        }),
      });
    } catch (error) {
      await args.respond({ text: toUserMessage(error) });
    }
  };

  app.action?.(ACTION_IDS.editRepo, async (args) => {
    await args.ack();

    try {
      const metadata = readActionMetadata(args);
      const linked = requireLinked(dependencies, args.body.user.id);
      const client = createClient(dependencies, linked.accessToken);
      const repo = await client.getRepo(metadata.projectId);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildRepoModal(repo.url, metadata),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.toggleCloud, async (args) => {
    await args.ack();

    try {
      const metadata = readActionMetadata(args);
      const linked = requireLinked(dependencies, args.body.user.id);
      const client = createClient(dependencies, linked.accessToken);
      const hub = await fetchHubData(client, metadata.projectId, metadata.org);

      await client.updateCloud(metadata.projectId, { enabled: !hub.status.cloud_enabled });
      const refreshed = await fetchHubData(client, metadata.projectId, metadata.org);

      await args.client.chat.update?.({
        channel: args.body.channel?.id,
        ts: args.body.message?.ts,
        text: `Config hub for ${metadata.projectName}`,
        blocks: buildConfigHubBlocks(refreshed, metadata),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.editDefaults, async (args) => {
    await args.ack();

    try {
      const metadata = readActionMetadata(args);
      const linked = requireLinked(dependencies, args.body.user.id);
      const client = createClient(dependencies, linked.accessToken);
      const defaults = await client.getDefaults(metadata.projectId);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildDefaultsModal(defaults.tool, defaults.model, metadata),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.manageEnv, async (args) => {
    await args.ack();

    try {
      const metadata = readActionMetadata(args);
      requireLinked(dependencies, args.body.user.id);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildEnvModal(metadata),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.manageCredentials, async (args) => {
    await args.ack();

    try {
      const metadata = readActionMetadata(args);
      requireLinked(dependencies, args.body.user.id);

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildCredsModal(metadata),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.view(CFG_REPO_CALLBACK_ID, async (args) => {
    try {
      const metadata = readViewMetadata(args);
      const linked = requireLinked(dependencies, args.body.user.id);
      const client = createClient(dependencies, linked.accessToken);

      const url = readPlain(args, CFG_REPO_FIELDS.url.blockId, CFG_REPO_FIELDS.url.actionId).trim();
      const token = readPlain(args, CFG_REPO_FIELDS.token.blockId, CFG_REPO_FIELDS.token.actionId).trim() || undefined;

      await client.updateRepo(metadata.projectId, { url, ...(token ? { token } : {}) });
      const refreshed = await fetchHubData(client, metadata.projectId, metadata.org);

      await args.ack();
      await updateHubFromModal(args, refreshed, metadata);
    } catch (error) {
      await ackWithError(args, CFG_REPO_FIELDS.url.blockId, error);
    }
  });

  app.view(CFG_DEFAULTS_CALLBACK_ID, async (args) => {
    try {
      const metadata = readViewMetadata(args);
      const linked = requireLinked(dependencies, args.body.user.id);
      const client = createClient(dependencies, linked.accessToken);

      const tool = readPlain(args, CFG_DEFAULTS_FIELDS.tool.blockId, CFG_DEFAULTS_FIELDS.tool.actionId).trim() || undefined;
      const model = readPlain(args, CFG_DEFAULTS_FIELDS.model.blockId, CFG_DEFAULTS_FIELDS.model.actionId).trim() || undefined;

      await client.updateDefaults(metadata.projectId, { tool, model });
      const refreshed = await fetchHubData(client, metadata.projectId, metadata.org);

      await args.ack();
      await updateHubFromModal(args, refreshed, metadata);
    } catch (error) {
      await ackWithError(args, CFG_DEFAULTS_FIELDS.tool.blockId, error);
    }
  });

  app.view(CFG_ENV_CALLBACK_ID, async (args) => {
    try {
      const metadata = readViewMetadata(args);
      const linked = requireLinked(dependencies, args.body.user.id);
      const client = createClient(dependencies, linked.accessToken);

      const key = readPlain(args, CFG_ENV_FIELDS.key.blockId, CFG_ENV_FIELDS.key.actionId).trim();
      const value = readPlain(args, CFG_ENV_FIELDS.value.blockId, CFG_ENV_FIELDS.value.actionId);

      await client.setEnv(metadata.projectId, key, { value });
      const refreshed = await fetchHubData(client, metadata.projectId, metadata.org);

      await args.ack();
      await updateHubFromModal(args, refreshed, metadata);
    } catch (error) {
      await ackWithError(args, CFG_ENV_FIELDS.key.blockId, error);
    }
  });

  app.view(CFG_CREDS_CALLBACK_ID, async (args) => {
    try {
      const metadata = readViewMetadata(args);
      const linked = requireLinked(dependencies, args.body.user.id);
      const client = createClient(dependencies, linked.accessToken);

      const provider =
        args.body.view.state.values[CFG_CREDS_FIELDS.provider.blockId]?.[CFG_CREDS_FIELDS.provider.actionId]
          ?.selected_option?.value ?? "";
      const token = readPlain(args, CFG_CREDS_FIELDS.token.blockId, CFG_CREDS_FIELDS.token.actionId);
      const owner = readPlain(args, CFG_CREDS_FIELDS.owner.blockId, CFG_CREDS_FIELDS.owner.actionId).trim() || undefined;

      await client.createCredential(metadata.projectId, { provider, token, ...(owner ? { owner } : {}) });
      const refreshed = await fetchHubData(client, metadata.projectId, metadata.org);

      await args.ack();
      await updateHubFromModal(args, refreshed, metadata);
    } catch (error) {
      await ackWithError(args, CFG_CREDS_FIELDS.provider.blockId, error);
    }
  });
}

export function buildConfigHubBlocks(
  hub: HubData,
  metadata: ConfigModalMetadata,
) {
  const actionValue = JSON.stringify({
    projectId: metadata.projectId,
    projectName: metadata.projectName,
    org: metadata.org,
    channelId: metadata.channelId ?? "",
    messageTs: metadata.messageTs,
  });

  const credsSummary =
    hub.credentials.length > 0
      ? hub.credentials.map((c) => `${c.provider}✓`).join(" ")
      : "none";

  return [
    section(`*Config hub* — \`${metadata.projectName}\``),
    section("*Repo*", {
      fields: [
        hub.status.repo.url ? `<${hub.status.repo.url}|${hub.status.repo.url}>` : "not set",
        `token: ${hub.status.repo.token_set ? "set" : "not set"}`,
      ],
      accessory: button({ actionId: ACTION_IDS.editRepo, text: "Edit", value: actionValue }),
    }),
    section(`*Cloud*  ${hub.status.cloud_enabled ? "🟢 enabled" : "⚪ off"}`, {
      accessory: button({ actionId: ACTION_IDS.toggleCloud, text: "Toggle", value: actionValue }),
    }),
    section("*Defaults*", {
      fields: [
        `tool: ${hub.status.defaults.tool ?? "—"}`,
        `model: ${hub.status.defaults.model ?? "—"}`,
      ],
      accessory: button({ actionId: ACTION_IDS.editDefaults, text: "Edit", value: actionValue }),
    }),
    section(`*Env*  ${hub.env.length} key(s)`, {
      accessory: button({ actionId: ACTION_IDS.manageEnv, text: "Manage", value: actionValue }),
    }),
    section(`*Credentials*  ${credsSummary}`, {
      accessory: button({ actionId: ACTION_IDS.manageCredentials, text: "Manage", value: actionValue }),
    }),
    section(`*Members* (view only)  ${hub.members.length} member(s)`, {
      fields: hub.members.map((m) => `${m.email} — ${m.role}`),
    }),
  ];
}

async function fetchHubData(client: MetaClient, projectId: string, org: string): Promise<HubData> {
  const [status, env, credentials, members] = await Promise.all([
    client.getFactoryStatus(projectId, org),
    client.listEnv(projectId),
    client.listCredentials(projectId),
    client.listMembers(projectId),
  ]);

  return { status, env, credentials, members };
}

function createClient(dependencies: ConfigDependencies, accessToken: string): MetaClient {
  if (dependencies.metaClientFactory) {
    return dependencies.metaClientFactory({ accessToken });
  }

  return createMetaClient({
    baseUrl: dependencies.metaBaseUrl,
    getAccessToken: () => accessToken,
  });
}

function getLinkedUser(
  store: LinkStore,
  slackUserId: string,
  now?: () => Date,
): { ok: true; link: StoredLink } | { ok: false; message: string } {
  const link = store.getLink(slackUserId);

  if (!link) {
    return { ok: false, message: "Not linked — run /meta link" };
  }

  const nowSeconds = Math.floor((now ?? (() => new Date()))().getTime() / 1000);
  if (link.exp <= nowSeconds) {
    return { ok: false, message: "⚠ link expired — run /meta link" };
  }

  return { ok: true, link };
}

function requireLinked(dependencies: ConfigDependencies, slackUserId: string): StoredLink {
  const result = getLinkedUser(dependencies.store, slackUserId, dependencies.now);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.link;
}

function readProjectArg(commandText: string): string {
  const [, ...rest] = commandText.trim().split(/\s+/);
  return rest.join(" ").trim();
}

function readActionMetadata(args: ActionHandlerArgs): ConfigModalMetadata {
  const raw = args.action.value ?? "{}";
  const parsed = JSON.parse(raw) as Partial<ConfigModalMetadata & { channelId: string; messageTs: string }>;

  return {
    channelId: args.body.channel?.id ?? parsed.channelId ?? "",
    messageTs: args.body.message?.ts ?? parsed.messageTs,
    org: parsed.org ?? "",
    projectId: parsed.projectId ?? "",
    projectName: parsed.projectName ?? "",
  };
}

function readViewMetadata(args: ViewHandlerArgs): ConfigModalMetadata {
  const raw = args.body.view.private_metadata ?? "{}";
  return JSON.parse(raw) as ConfigModalMetadata;
}

function readPlain(args: ViewHandlerArgs, blockId: string, actionId: string): string {
  return args.body.view.state.values[blockId]?.[actionId]?.value ?? "";
}

async function updateHubFromModal(
  args: ViewHandlerArgs,
  hub: HubData,
  metadata: ConfigModalMetadata,
): Promise<void> {
  if (!metadata.channelId || !metadata.messageTs) {
    return;
  }

  await args.client.chat.update?.({
    channel: metadata.channelId,
    ts: metadata.messageTs,
    text: `Config hub for ${metadata.projectName}`,
    blocks: buildConfigHubBlocks(hub, metadata),
  });
}

async function postEphemeralError(args: ActionHandlerArgs, error: unknown): Promise<void> {
  await args.client.chat.postEphemeral({
    channel: args.body.channel?.id,
    user: args.body.user.id,
    text: toUserMessage(error),
  });
}

async function ackWithError(args: ViewHandlerArgs, blockId: string, error: unknown): Promise<void> {
  await args.ack({
    response_action: "errors",
    errors: {
      [blockId]: toUserMessage(error),
    },
  });
}

function toUserMessage(error: unknown): string {
  if (
    error instanceof UnauthorizedError ||
    error instanceof InvalidTokenError ||
    error instanceof AdminRequiredError
  ) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Unable to complete config action.";
}
