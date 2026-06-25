import { plainText } from "../blocks/common.js";

export const CFG_REPO_CALLBACK_ID = "cfg_repo";
export const CFG_DEFAULTS_CALLBACK_ID = "cfg_defaults";
export const CFG_ENV_CALLBACK_ID = "cfg_env";
export const CFG_CREDS_CALLBACK_ID = "cfg_creds";

export const CFG_REPO_FIELDS = {
  url: { blockId: "cfg_repo_url", actionId: "value" },
  token: { blockId: "cfg_repo_token", actionId: "value" },
} as const;

export const CFG_DEFAULTS_FIELDS = {
  tool: { blockId: "cfg_defaults_tool", actionId: "value" },
  model: { blockId: "cfg_defaults_model", actionId: "value" },
} as const;

export const CFG_ENV_FIELDS = {
  key: { blockId: "cfg_env_key", actionId: "value" },
  value: { blockId: "cfg_env_value", actionId: "value" },
} as const;

export const CFG_CREDS_FIELDS = {
  provider: { blockId: "cfg_creds_provider", actionId: "value" },
  token: { blockId: "cfg_creds_token", actionId: "value" },
  owner: { blockId: "cfg_creds_owner", actionId: "value" },
} as const;

export type ConfigModalMetadata = {
  channelId: string;
  messageTs?: string;
  org: string;
  projectId: string;
  projectName: string;
};

export function buildRepoModal(
  currentUrl: string | null,
  metadata: ConfigModalMetadata,
) {
  return {
    type: "modal",
    callback_id: CFG_REPO_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: plainText("Edit Repo"),
    submit: plainText("Save"),
    close: plainText("Cancel"),
    blocks: [
      plainInputBlock({
        blockId: CFG_REPO_FIELDS.url.blockId,
        actionId: CFG_REPO_FIELDS.url.actionId,
        label: "Repository URL",
        initialValue: currentUrl ?? "",
      }),
      {
        type: "input",
        block_id: CFG_REPO_FIELDS.token.blockId,
        optional: true,
        label: plainText("Access token (leave blank to keep existing)"),
        element: {
          type: "plain_text_input",
          action_id: CFG_REPO_FIELDS.token.actionId,
          placeholder: plainText("token"),
        },
      },
    ],
  };
}

export function buildDefaultsModal(
  currentTool: string | null,
  currentModel: string | null,
  metadata: ConfigModalMetadata,
) {
  return {
    type: "modal",
    callback_id: CFG_DEFAULTS_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: plainText("Edit Defaults"),
    submit: plainText("Save"),
    close: plainText("Cancel"),
    blocks: [
      plainInputBlock({
        blockId: CFG_DEFAULTS_FIELDS.tool.blockId,
        actionId: CFG_DEFAULTS_FIELDS.tool.actionId,
        label: "Tool",
        initialValue: currentTool ?? "",
        optional: true,
      }),
      plainInputBlock({
        blockId: CFG_DEFAULTS_FIELDS.model.blockId,
        actionId: CFG_DEFAULTS_FIELDS.model.actionId,
        label: "Model",
        initialValue: currentModel ?? "",
        optional: true,
      }),
    ],
  };
}

export function buildEnvModal(metadata: ConfigModalMetadata) {
  return {
    type: "modal",
    callback_id: CFG_ENV_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: plainText("Manage Env"),
    submit: plainText("Set"),
    close: plainText("Cancel"),
    blocks: [
      plainInputBlock({
        blockId: CFG_ENV_FIELDS.key.blockId,
        actionId: CFG_ENV_FIELDS.key.actionId,
        label: "Key",
      }),
      {
        type: "input",
        block_id: CFG_ENV_FIELDS.value.blockId,
        label: plainText("Value"),
        element: {
          type: "plain_text_input",
          action_id: CFG_ENV_FIELDS.value.actionId,
          placeholder: plainText("secret value — never shown after save"),
        },
      },
    ],
  };
}

export function buildCredsModal(metadata: ConfigModalMetadata) {
  return {
    type: "modal",
    callback_id: CFG_CREDS_CALLBACK_ID,
    private_metadata: JSON.stringify(metadata),
    title: plainText("Manage Credentials"),
    submit: plainText("Add"),
    close: plainText("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: CFG_CREDS_FIELDS.provider.blockId,
        label: plainText("Provider"),
        element: {
          type: "static_select",
          action_id: CFG_CREDS_FIELDS.provider.actionId,
          options: [
            { text: plainText("claude"), value: "claude" },
            { text: plainText("codex"), value: "codex" },
            { text: plainText("gemini"), value: "gemini" },
            { text: plainText("opencode"), value: "opencode" },
          ],
        },
      },
      {
        type: "input",
        block_id: CFG_CREDS_FIELDS.token.blockId,
        label: plainText("Token"),
        element: {
          type: "plain_text_input",
          action_id: CFG_CREDS_FIELDS.token.actionId,
          placeholder: plainText("token — never shown after save"),
        },
      },
      plainInputBlock({
        blockId: CFG_CREDS_FIELDS.owner.blockId,
        actionId: CFG_CREDS_FIELDS.owner.actionId,
        label: "Owner (optional)",
        optional: true,
      }),
    ],
  };
}

function plainInputBlock(options: {
  blockId: string;
  actionId: string;
  label: string;
  initialValue?: string;
  optional?: boolean;
}) {
  return {
    type: "input",
    block_id: options.blockId,
    ...(options.optional ? { optional: true } : {}),
    label: plainText(options.label),
    element: {
      type: "plain_text_input",
      action_id: options.actionId,
      ...(options.initialValue ? { initial_value: options.initialValue } : {}),
    },
  };
}
