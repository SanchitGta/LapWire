import { plainText } from "../blocks/common.js";
import type { CronEntry, FactoryStatus } from "../metaClient.js";

export const START_MODAL_CALLBACK_ID = "start_form";
export const DISABLE_HEARTBEAT_CALLBACK_ID = "disable_hb_confirm";

export const START_MODAL_FIELDS = {
  lapNumber: { blockId: "start_lap_number", actionId: "value" },
  schedule: { blockId: "start_schedule", actionId: "value" },
  agent: { blockId: "start_agent", actionId: "value" },
  tool: { blockId: "start_tool", actionId: "value" },
  model: { blockId: "start_model", actionId: "value" },
  queue: { blockId: "start_queue", actionId: "value" },
  heartbeat: { blockId: "start_enable_heartbeat", actionId: "value" },
} as const;

export const DISABLE_HEARTBEAT_FIELDS = {
  projectName: { blockId: "disable_hb_project_name", actionId: "value" },
} as const;

export type LifecycleModalMetadata = {
  channelId: string;
  messageTs?: string;
  org: string;
  projectId: string;
  projectName: string;
};

export function buildStartModal(status: FactoryStatus, metadata: LifecycleModalMetadata) {
  const activeEntry = status.cron.entries.find((entry) => entry.enabled) ?? status.cron.entries[0] ?? null;
  const lapNumber = readLapNumber(activeEntry?.name) ?? "";
  const schedule = activeEntry?.schedule ?? "0 * * * *";
  const agent = activeEntry?.agent ?? "meta-engineer";
  const tool = status.defaults.tool ?? activeEntry?.tool ?? "";
  const model = status.defaults.model ?? activeEntry?.model ?? "";
  const queue = (activeEntry?.queue ?? (status.cloud_enabled ? "cloud" : "local")) satisfies CronEntry["queue"];

  return {
    type: "modal",
    callback_id: START_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: plainText("Start lap"),
    submit: plainText("Start"),
    close: plainText("Cancel"),
    blocks: [
      plainInputBlock({
        blockId: START_MODAL_FIELDS.lapNumber.blockId,
        actionId: START_MODAL_FIELDS.lapNumber.actionId,
        label: "Lap #",
        initialValue: lapNumber,
      }),
      plainInputBlock({
        blockId: START_MODAL_FIELDS.schedule.blockId,
        actionId: START_MODAL_FIELDS.schedule.actionId,
        label: "Schedule",
        initialValue: schedule,
      }),
      plainInputBlock({
        blockId: START_MODAL_FIELDS.agent.blockId,
        actionId: START_MODAL_FIELDS.agent.actionId,
        label: "Agent",
        initialValue: agent,
      }),
      plainInputBlock({
        blockId: START_MODAL_FIELDS.tool.blockId,
        actionId: START_MODAL_FIELDS.tool.actionId,
        label: "Tool",
        initialValue: tool,
      }),
      plainInputBlock({
        blockId: START_MODAL_FIELDS.model.blockId,
        actionId: START_MODAL_FIELDS.model.actionId,
        label: "Model",
        initialValue: model,
      }),
      {
        type: "input",
        block_id: START_MODAL_FIELDS.queue.blockId,
        label: plainText("Queue"),
        element: {
          type: "static_select",
          action_id: START_MODAL_FIELDS.queue.actionId,
          initial_option: queueOption(queue),
          options: [queueOption("local"), queueOption("cloud")],
        },
      },
      {
        type: "input",
        block_id: START_MODAL_FIELDS.heartbeat.blockId,
        optional: true,
        label: plainText("Heartbeat"),
        element: {
          type: "checkboxes",
          action_id: START_MODAL_FIELDS.heartbeat.actionId,
          initial_options: [{ text: plainText("Enable heartbeat"), value: "enabled" }],
          options: [{ text: plainText("Enable heartbeat"), value: "enabled" }],
        },
      },
    ],
  };
}

export function buildDisableHeartbeatModal(
  projectName: string,
  metadata: LifecycleModalMetadata,
) {
  return {
    type: "modal",
    callback_id: DISABLE_HEARTBEAT_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: plainText("Disable hb"),
    submit: plainText("Disable"),
    close: plainText("Cancel"),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Type *${projectName}* to disable heartbeat for this project.`,
        },
      },
      plainInputBlock({
        blockId: DISABLE_HEARTBEAT_FIELDS.projectName.blockId,
        actionId: DISABLE_HEARTBEAT_FIELDS.projectName.actionId,
        label: "Project name",
      }),
    ],
  };
}

function plainInputBlock(options: {
  blockId: string;
  actionId: string;
  label: string;
  initialValue?: string;
}) {
  return {
    type: "input",
    block_id: options.blockId,
    label: plainText(options.label),
    element: {
      type: "plain_text_input",
      action_id: options.actionId,
      ...(options.initialValue ? { initial_value: options.initialValue } : {}),
    },
  };
}

function queueOption(value: CronEntry["queue"]) {
  return {
    text: plainText(value === "cloud" ? "Cloud" : "Local"),
    value,
  };
}

function readLapNumber(name: string | undefined): string {
  const match = name?.match(/^factory-lap-(\d+)$/);
  return match?.[1] ?? "";
}
