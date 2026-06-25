import { ACTION_IDS, button, buttonRow, confirmDialog, section } from "../blocks/common.js";
import type { FactoryStatus } from "../metaClient.js";

export type FleetStatusCard = {
  projectId: string;
  projectName: string;
  status: FactoryStatus;
};

export type StatusCardOptions = {
  org: string;
  now?: () => Date;
};

type StatusActionValue = {
  projectId: string;
  projectName: string;
  org: string;
};

export function buildFleetStatusBlocks(
  projects: FleetStatusCard[],
  options: StatusCardOptions,
): Array<ReturnType<typeof section> | ReturnType<typeof buttonRow>> {
  const blocks: Array<ReturnType<typeof section> | ReturnType<typeof buttonRow>> = [
    section(`*Live fleet status* for \`${options.org}\``),
  ];

  for (const project of projects) {
    const enabledEntries = project.status.cron.entries.filter((entry) => entry.enabled);
    const entrySummary =
      enabledEntries.length > 0
        ? enabledEntries.map((entry) => `\`${entry.name}\``).join(", ")
        : "No enabled entries";

    blocks.push(
      section(`${getHealthGlyph(project.status, options.now)} *${project.projectName}*`, {
        fields: [
          `*Heartbeat*\n${formatHeartbeat(project.status, options.now)}`,
          `*Enabled entries*\n${entrySummary}`,
        ],
        accessory: button({
          actionId: ACTION_IDS.viewStatus,
          text: "View status",
          value: encodeActionValue({
            projectId: project.projectId,
            projectName: project.projectName,
            org: options.org,
          }),
          accessibilityLabel: `View live status for ${project.projectName}`,
        }),
      }),
    );
  }

  return blocks;
}

export function buildProjectStatusBlocks(
  status: FactoryStatus,
  options: StatusCardOptions,
): Array<ReturnType<typeof section> | ReturnType<typeof buttonRow>> {
  const blocks: Array<ReturnType<typeof section> | ReturnType<typeof buttonRow>> = [
    section(`${getHealthGlyph(status, options.now)} *${status.project.name}*`, {
      fields: [
        `*Heartbeat*\n${formatHeartbeat(status, options.now)}`,
        `*Repo*\n${status.repo.url ? `<${status.repo.url}|${status.repo.url}>` : "Not configured"}`,
        `*Cloud*\n${status.cloud_enabled ? "🟢 enabled" : "⚪ off"}`,
        `*Defaults*\n${formatDefaults(status)}`,
      ],
    }),
  ];

  for (const entry of status.cron.entries) {
    blocks.push(
      section(`*${entry.name}* ${entry.enabled ? "✅ enabled" : "⏸ disabled"}`, {
        fields: [
          `*Schedule*\n\`${entry.schedule}\``,
          `*Tool*\n${entry.tool ?? "—"}${entry.model ? ` / ${entry.model}` : ""}`,
          `*Queue*\n${entry.queue}`,
          `*Last run*\n${entry.last_run ?? "—"}`,
        ],
      }),
    );
  }

  blocks.push(
    buttonRow(
      [
        {
          actionId: ACTION_IDS.stopLap,
          text: "Stop",
          value: encodeActionValue({
            projectId: status.project.id,
            projectName: status.project.name,
            org: options.org,
          }),
          style: "danger",
          confirm: confirmDialog({
            title: "Stop lap",
            text: `Stop the active factory lap for *${status.project.name}*?`,
            confirm: "Stop",
            style: "danger",
          }),
        },
        {
          actionId: ACTION_IDS.rearmHeartbeat,
          text: "Re-arm hb",
          value: encodeActionValue({
            projectId: status.project.id,
            projectName: status.project.name,
            org: options.org,
          }),
        },
        {
          actionId: ACTION_IDS.editRepo,
          text: "Config",
          value: encodeActionValue({
            projectId: status.project.id,
            projectName: status.project.name,
            org: options.org,
          }),
        },
        {
          actionId: ACTION_IDS.disableHeartbeat,
          text: "Disable hb",
          value: encodeActionValue({
            projectId: status.project.id,
            projectName: status.project.name,
            org: options.org,
          }),
          style: "danger",
        },
      ],
      { blockId: `status-actions-${status.project.id}` },
    ),
  );

  return blocks;
}

export function getHealthGlyph(status: FactoryStatus, now?: () => Date): string {
  const hasEnabledEntry = status.cron.entries.some((entry) => entry.enabled);
  if (!status.heartbeat.enabled || !hasEnabledEntry) {
    return "🔴";
  }

  if (expiresWithin24Hours(status.heartbeat.expires_at, now)) {
    return "⚠";
  }

  return "🟢";
}

export function formatHeartbeat(status: FactoryStatus, now?: () => Date): string {
  if (!status.heartbeat.enabled) {
    return "off";
  }

  const expiresIn = formatRelativeExpiry(status.heartbeat.expires_at, now);
  return expiresIn ? `enabled (${expiresIn})` : "enabled";
}

export function encodeActionValue(value: StatusActionValue): string {
  return JSON.stringify(value);
}

function formatDefaults(status: FactoryStatus): string {
  if (!status.defaults.tool && !status.defaults.model) {
    return "—";
  }

  if (status.defaults.tool && status.defaults.model) {
    return `${status.defaults.tool} / ${status.defaults.model}`;
  }

  return status.defaults.tool ?? status.defaults.model ?? "—";
}

function expiresWithin24Hours(expiresAt: string | null, now?: () => Date): boolean {
  if (!expiresAt) {
    return false;
  }

  const diffMs = new Date(expiresAt).getTime() - getNow(now).getTime();
  return diffMs > 0 && diffMs < 24 * 60 * 60 * 1000;
}

function formatRelativeExpiry(expiresAt: string | null, now?: () => Date): string | null {
  if (!expiresAt) {
    return null;
  }

  const diffMs = new Date(expiresAt).getTime() - getNow(now).getTime();
  if (diffMs <= 0) {
    return "expired";
  }

  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 1) {
    return `expires in ${hours}h`;
  }

  const minutes = Math.max(Math.floor(diffMs / (60 * 1000)), 0);
  return `expires in ${minutes}m`;
}

function getNow(now?: () => Date): Date {
  return (now ?? (() => new Date()))();
}
