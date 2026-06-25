import { ACTION_IDS, buttonRow, confirmDialog, section } from "../blocks/common.js";
import { AdminRequiredError, InvalidTokenError, UnauthorizedError } from "../errors.js";
import { createMetaClient, type FactoryStatus, type MetaClient } from "../metaClient.js";
import type { ActionHandlerArgs, CommandHandlerArgs, LinkDependencies, MetaAppLike, ViewHandlerArgs } from "../link/index.js";
import {
  buildDisableHeartbeatModal,
  buildStartModal,
  DISABLE_HEARTBEAT_CALLBACK_ID,
  DISABLE_HEARTBEAT_FIELDS,
  START_MODAL_CALLBACK_ID,
  START_MODAL_FIELDS,
  type LifecycleModalMetadata,
} from "./modals.js";

export type LifecycleDependencies = LinkDependencies & {
  metaBaseUrl: string;
  metaOrg: string;
};

type ActionValue = {
  org: string;
  projectId: string;
  projectName: string;
};

export function registerLifecycleHandlers(
  app: MetaAppLike,
  dependencies: LifecycleDependencies,
): void {
  dependencies.commandHandlers.start = async (args) => {
    await args.ack();

    const target = parseProjectAndLap(args.command.text, "start");
    if (!target.projectName) {
      await args.respond({ text: "Usage: /meta start <project> [lap]" });
      return;
    }

    const linked = dependencies.store.getLink(args.command.user_id);
    if (!linked || isExpired(linked.exp, dependencies.now)) {
      await args.respond({ text: "Not linked — run /meta link" });
      return;
    }

    try {
      const metaClient = createClient(dependencies, linked.accessToken);
      const project = await resolveProjectByName(metaClient, dependencies.metaOrg, target.projectName);
      const status = await metaClient.getFactoryStatus(project.id, dependencies.metaOrg);

      await args.client.views.open({
        trigger_id: args.command.trigger_id,
        view: buildStartModal(status, {
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

  dependencies.commandHandlers.stop = async (args) => {
    await args.ack();
    await performDirectMutation(args, dependencies, "stop");
  };

  dependencies.commandHandlers.rearm = async (args) => {
    await args.ack();
    await performDirectMutation(args, dependencies, "rearm");
  };

  app.action?.(ACTION_IDS.startLap, async (args) => {
    await args.ack();

    try {
      const metadata = readActionValue(args.action.value);
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const status = await createClient(dependencies, linked.accessToken).getFactoryStatus(
        metadata.projectId,
        metadata.org,
      );

      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildStartModal(status, {
          channelId: args.body.channel?.id ?? "",
          messageTs: args.body.message?.ts,
          org: metadata.org,
          projectId: metadata.projectId,
          projectName: metadata.projectName,
        }),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.stopLap, async (args) => {
    await args.ack();

    try {
      const metadata = readActionValue(args.action.value);
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);
      const status = await metaClient.getFactoryStatus(metadata.projectId, metadata.org);
      const lapNumber = readActiveLapNumber(status);

      await metaClient.stopFactory(metadata.projectId, lapNumber ? { lap_no: lapNumber } : {});
      const refreshed = await metaClient.getFactoryStatus(metadata.projectId, metadata.org);
      await refreshStatusCard(args, refreshed, metadata);
      await postAttribution(args, `↳ <@${args.body.user.id}> stopped ${metadata.projectName}/${status.cron.entries.find((entry) => !entry.enabled)?.name ?? `factory-lap-${lapNumber ?? "?"}`}`);
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.rearmHeartbeat, async (args) => {
    await args.ack();

    try {
      const metadata = readActionValue(args.action.value);
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);

      await metaClient.updateHeartbeat(metadata.projectId, { enabled: true });
      const refreshed = await metaClient.getFactoryStatus(metadata.projectId, metadata.org);
      await refreshStatusCard(args, refreshed, metadata);
      await postAttribution(args, `↳ <@${args.body.user.id}> re-armed ${metadata.projectName} heartbeat`);
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.action?.(ACTION_IDS.disableHeartbeat, async (args) => {
    await args.ack();

    try {
      const metadata = readActionValue(args.action.value);
      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildDisableHeartbeatModal(metadata.projectName, {
          channelId: args.body.channel?.id ?? "",
          messageTs: args.body.message?.ts,
          org: metadata.org,
          projectId: metadata.projectId,
          projectName: metadata.projectName,
        }),
      });
    } catch (error) {
      await postEphemeralError(args, error);
    }
  });

  app.view(START_MODAL_CALLBACK_ID, async (args) => {
    try {
      const metadata = readModalMetadata(args.body.view.private_metadata);
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);
      const startRequest = readStartRequest(args.body.view.state.values);

      await metaClient.startFactory(metadata.projectId, startRequest);
      const refreshed = await metaClient.getFactoryStatus(metadata.projectId, metadata.org);

      await args.ack();
      await updateCardFromModal(args, refreshed, metadata);
      await postModalAttribution(
        args,
        metadata,
        `↳ <@${args.body.user.id}> started ${metadata.projectName}/factory-lap-${startRequest.lap_no ?? "?"}`,
      );
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof InvalidTokenError || error instanceof AdminRequiredError) {
        await args.ack({
          response_action: "errors",
          errors: {
            [START_MODAL_FIELDS.lapNumber.blockId]: error.message,
          },
        });
        return;
      }

      throw error;
    }
  });

  app.view(DISABLE_HEARTBEAT_CALLBACK_ID, async (args) => {
    const metadata = readModalMetadata(args.body.view.private_metadata);
    const typedProjectName = readPlainValue(
      args.body.view.state.values,
      DISABLE_HEARTBEAT_FIELDS.projectName.blockId,
      DISABLE_HEARTBEAT_FIELDS.projectName.actionId,
    ).trim();

    if (typedProjectName !== metadata.projectName) {
      await args.ack({
        response_action: "errors",
        errors: {
          [DISABLE_HEARTBEAT_FIELDS.projectName.blockId]: "Project name must match exactly.",
        },
      });
      return;
    }

    try {
      const linked = requireLinkedUser(dependencies, args.body.user.id);
      const metaClient = createClient(dependencies, linked.accessToken);

      await metaClient.updateHeartbeat(metadata.projectId, { enabled: false });
      const refreshed = await metaClient.getFactoryStatus(metadata.projectId, metadata.org);

      await args.ack();
      await updateCardFromModal(args, refreshed, metadata);
      await postModalAttribution(
        args,
        metadata,
        `↳ <@${args.body.user.id}> disabled ${metadata.projectName} heartbeat`,
      );
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof InvalidTokenError || error instanceof AdminRequiredError) {
        await args.ack({
          response_action: "errors",
          errors: {
            [DISABLE_HEARTBEAT_FIELDS.projectName.blockId]: error.message,
          },
        });
        return;
      }

      throw error;
    }
  });
}

export function buildLifecycleStatusCard(status: FactoryStatus, org: string) {
  const metadata: ActionValue = {
    org,
    projectId: status.project.id,
    projectName: status.project.name,
  };
  const activeEntry = status.cron.entries.find((entry) => entry.enabled) ?? status.cron.entries[0] ?? null;
  const heartbeatText = status.heartbeat.enabled
    ? `enabled until ${status.heartbeat.expires_at ?? "—"}`
    : "disabled";
  const entryLines =
    status.cron.entries.length > 0
      ? status.cron.entries.map(
          (entry) =>
            `• ${entry.name} | ${entry.schedule} | ${entry.tool ?? "—"} | ${entry.queue} | ${entry.enabled ? "Enabled" : "Disabled"}`,
        )
      : ["• No cron entries"];

  return [
    section(`*${status.project.name}*`),
    section(`*Heartbeat:* ${heartbeatText}\n*Repo:* ${status.repo.url ?? "—"}\n*Cloud:* ${status.cloud_enabled ? "on" : "off"}\n*Default tool:* ${status.defaults.tool ?? "—"}`),
    section(entryLines.join("\n")),
    buttonRow([
      {
        actionId: ACTION_IDS.startLap,
        text: "Start",
        value: JSON.stringify(metadata),
        style: "primary",
      },
      {
        actionId: ACTION_IDS.stopLap,
        text: "Stop",
        value: JSON.stringify(metadata),
        confirm: confirmDialog({
          title: "Stop this lap?",
          text: "This will stop the current factory lap.",
          confirm: "Stop",
          style: "danger",
        }),
        style: "danger",
      },
      {
        actionId: ACTION_IDS.rearmHeartbeat,
        text: "Re-arm hb",
        value: JSON.stringify(metadata),
      },
      {
        actionId: ACTION_IDS.disableHeartbeat,
        text: "Disable hb",
        value: JSON.stringify(metadata),
        style: "danger",
      },
    ]),
    ...(activeEntry ? [section(`*Active lap:* ${activeEntry.name}`)] : []),
  ];
}

function createClient(dependencies: LifecycleDependencies, accessToken: string): MetaClient {
  return createMetaClient({
    baseUrl: dependencies.metaBaseUrl,
    getAccessToken: () => accessToken,
  });
}

async function performDirectMutation(
  args: CommandHandlerArgs,
  dependencies: LifecycleDependencies,
  mode: "stop" | "rearm",
): Promise<void> {
  const target = parseProjectAndLap(args.command.text, mode);
  if (!target.projectName) {
    await args.respond({
      text: mode === "stop" ? "Usage: /meta stop <project> [lap]" : "Usage: /meta rearm <project>",
    });
    return;
  }

  const linked = dependencies.store.getLink(args.command.user_id);
  if (!linked || isExpired(linked.exp, dependencies.now)) {
    await args.respond({ text: "Not linked — run /meta link" });
    return;
  }

  try {
    const metaClient = createClient(dependencies, linked.accessToken);
    const project = await resolveProjectByName(metaClient, dependencies.metaOrg, target.projectName);

    if (mode === "stop") {
      await metaClient.stopFactory(project.id, target.lapNumber ? { lap_no: target.lapNumber } : {});
      await args.respond({ text: `↳ <@${args.command.user_id}> stopped ${project.name}/factory-lap-${target.lapNumber ?? "current"}` });
    } else {
      await metaClient.updateHeartbeat(project.id, { enabled: true });
      await args.respond({ text: `↳ <@${args.command.user_id}> re-armed ${project.name} heartbeat` });
    }
  } catch (error) {
    await args.respond({ text: toUserMessage(error) });
  }
}

async function resolveProjectByName(
  metaClient: MetaClient,
  org: string,
  projectName: string,
) {
  const projects = await metaClient.listProjects(org);
  const match = projects.find((project) => project.name.toLowerCase() === projectName.toLowerCase());

  if (!match) {
    throw new Error(`Project "${projectName}" not found.`);
  }

  return match;
}

function requireLinkedUser(dependencies: LifecycleDependencies, slackUserId: string) {
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

function parseProjectAndLap(text: string, subcommand: "start" | "stop" | "rearm") {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const [, projectName = "", lapValue] = parts;
  const lapNumber = lapValue ? Number.parseInt(lapValue, 10) : undefined;

  return {
    projectName,
    lapNumber: Number.isFinite(lapNumber) ? lapNumber : undefined,
    subcommand,
  };
}

function readActionValue(value: string | undefined): ActionValue {
  if (!value) {
    throw new Error("Missing lifecycle action payload.");
  }

  return JSON.parse(value) as ActionValue;
}

function readModalMetadata(value: string | undefined): LifecycleModalMetadata {
  if (!value) {
    throw new Error("Missing lifecycle modal metadata.");
  }

  return JSON.parse(value) as LifecycleModalMetadata;
}

function readStartRequest(values: ViewHandlerArgs["body"]["view"]["state"]["values"]) {
  const lapNumber = readPlainValue(
    values,
    START_MODAL_FIELDS.lapNumber.blockId,
    START_MODAL_FIELDS.lapNumber.actionId,
  ).trim();
  const selectedQueue =
    values[START_MODAL_FIELDS.queue.blockId]?.[START_MODAL_FIELDS.queue.actionId]?.selected_option?.value;
  const heartbeatEnabled =
    (values[START_MODAL_FIELDS.heartbeat.blockId]?.[START_MODAL_FIELDS.heartbeat.actionId]?.selected_options ?? [])
      .some((option) => option.value === "enabled");

  return {
    lap_no: lapNumber ? Number.parseInt(lapNumber, 10) : undefined,
    schedule: readPlainValue(values, START_MODAL_FIELDS.schedule.blockId, START_MODAL_FIELDS.schedule.actionId).trim() || undefined,
    agent: readPlainValue(values, START_MODAL_FIELDS.agent.blockId, START_MODAL_FIELDS.agent.actionId).trim() || undefined,
    tool: readPlainValue(values, START_MODAL_FIELDS.tool.blockId, START_MODAL_FIELDS.tool.actionId).trim() || undefined,
    model: readPlainValue(values, START_MODAL_FIELDS.model.blockId, START_MODAL_FIELDS.model.actionId).trim() || undefined,
    queue: selectedQueue === "cloud" ? "cloud" : "local",
    enable_heartbeat: heartbeatEnabled,
  } as const;
}

function readPlainValue(
  values: ViewHandlerArgs["body"]["view"]["state"]["values"],
  blockId: string,
  actionId: string,
): string {
  return values[blockId]?.[actionId]?.value ?? "";
}

function readActiveLapNumber(status: FactoryStatus): number | undefined {
  const activeEntry = status.cron.entries.find((entry) => entry.enabled);
  const match = activeEntry?.name.match(/^factory-lap-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

async function refreshStatusCard(
  args: ActionHandlerArgs,
  status: FactoryStatus,
  metadata: ActionValue,
) {
  await args.client.chat.update?.({
    channel: args.body.channel?.id,
    ts: args.body.message?.ts,
    text: `${status.project.name} factory status`,
    blocks: buildLifecycleStatusCard(status, metadata.org),
  });
}

async function updateCardFromModal(
  args: ViewHandlerArgs,
  status: FactoryStatus,
  metadata: LifecycleModalMetadata,
) {
  if (!metadata.channelId || !metadata.messageTs) {
    return;
  }

  await args.client.chat.update?.({
    channel: metadata.channelId,
    ts: metadata.messageTs,
    text: `${status.project.name} factory status`,
    blocks: buildLifecycleStatusCard(status, metadata.org),
  });
}

async function postAttribution(args: ActionHandlerArgs, text: string) {
  await args.client.chat.postMessage?.({
    channel: args.body.channel?.id,
    thread_ts: args.body.message?.ts,
    text,
  });
}

async function postModalAttribution(
  args: ViewHandlerArgs,
  metadata: LifecycleModalMetadata,
  text: string,
) {
  if (!metadata.channelId) {
    return;
  }

  await args.client.chat.postMessage?.({
    channel: metadata.channelId,
    ...(metadata.messageTs ? { thread_ts: metadata.messageTs } : {}),
    text,
  });
}

async function postEphemeralError(args: ActionHandlerArgs, error: unknown) {
  await args.client.chat.postEphemeral({
    channel: args.body.channel?.id,
    user: args.body.user.id,
    text: toUserMessage(error),
  });
}

function toUserMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete lifecycle action.";
}
