import { plainText } from "../blocks/common.js";
import type { FactoryStatus } from "../metaClient.js";

export const CONFIG_CALLBACK_IDS = {
  repo: "cfg_repo",
  defaults: "cfg_defaults",
  env: "cfg_env",
  credentials: "cfg_creds",
} as const;

export const CONFIG_BLOCK_IDS = {
  repoUrl: "cfg_repo_url",
  repoToken: "cfg_repo_token",
  defaultsTool: "cfg_defaults_tool",
  defaultsModel: "cfg_defaults_model",
  envKey: "cfg_env_key",
  envValue: "cfg_env_value",
  envDelete: "cfg_env_delete",
  credProvider: "cfg_cred_provider",
  credToken: "cfg_cred_token",
  credDelete: "cfg_cred_delete",
} as const;

export type ConfigHubContext = {
  channelId: string;
  messageTs?: string;
  ts?: string;
  org: string;
  projectId: string;
  projectName: string;
};

type ViewStateValues = Record<
  string,
  Record<
    string,
    {
      type?: string;
      value?: string;
      selected_option?: { value: string };
      selected_options?: Array<{ value: string }>;
    }
  >
>;

export function parseConfigHubContext(privateMetadata: string | undefined): ConfigHubContext {
  if (!privateMetadata) {
    throw new Error("Missing config hub context.");
  }

  return JSON.parse(privateMetadata) as ConfigHubContext;
}

export function buildRepoModal(status: FactoryStatus, ctx: ConfigHubContext) {
  return {
    type: "modal",
    callback_id: CONFIG_CALLBACK_IDS.repo,
    private_metadata: JSON.stringify(ctx),
    title: plainText("Edit Repo"),
    submit: plainText("Save"),
    close: plainText("Cancel"),
    blocks: [
      plainInputBlock(CONFIG_BLOCK_IDS.repoUrl, "value", "Repo URL", status.repo.url ?? undefined),
      {
        type: "input",
        block_id: CONFIG_BLOCK_IDS.repoToken,
        optional: true,
        label: plainText("Access Token (leave blank to keep current)"),
        element: {
          type: "plain_text_input",
          action_id: "value",
        },
      },
    ],
  };
}

export function buildDefaultsModal(status: FactoryStatus, ctx: ConfigHubContext) {
  return {
    type: "modal",
    callback_id: CONFIG_CALLBACK_IDS.defaults,
    private_metadata: JSON.stringify(ctx),
    title: plainText("Edit Defaults"),
    submit: plainText("Save"),
    close: plainText("Cancel"),
    blocks: [
      plainInputBlock(CONFIG_BLOCK_IDS.defaultsTool, "value", "Tool", status.defaults.tool ?? undefined),
      plainInputBlock(CONFIG_BLOCK_IDS.defaultsModel, "value", "Model", status.defaults.model ?? undefined),
    ],
  };
}

export function buildEnvModal(ctx: ConfigHubContext) {
  return {
    type: "modal",
    callback_id: CONFIG_CALLBACK_IDS.env,
    private_metadata: JSON.stringify(ctx),
    title: plainText("Manage Env"),
    submit: plainText("Save"),
    close: plainText("Cancel"),
    blocks: [
      plainInputBlock(CONFIG_BLOCK_IDS.envKey, "value", "Key"),
      {
        type: "input",
        block_id: CONFIG_BLOCK_IDS.envValue,
        optional: true,
        label: plainText("Value"),
        element: {
          type: "plain_text_input",
          action_id: "value",
        },
      },
      {
        type: "input",
        block_id: CONFIG_BLOCK_IDS.envDelete,
        optional: true,
        label: plainText("Delete?"),
        element: {
          type: "checkboxes",
          action_id: "value",
          options: [{ text: plainText("Delete this key"), value: "delete" }],
        },
      },
    ],
  };
}

export function buildCredentialsModal(ctx: ConfigHubContext) {
  return {
    type: "modal",
    callback_id: CONFIG_CALLBACK_IDS.credentials,
    private_metadata: JSON.stringify(ctx),
    title: plainText("Manage Credentials"),
    submit: plainText("Save"),
    close: plainText("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: CONFIG_BLOCK_IDS.credProvider,
        label: plainText("Provider"),
        element: {
          type: "static_select",
          action_id: "value",
          options: ["claude", "codex", "gemini", "opencode"].map((p) => ({
            text: plainText(p),
            value: p,
          })),
        },
      },
      {
        type: "input",
        block_id: CONFIG_BLOCK_IDS.credToken,
        optional: true,
        label: plainText("API Token (required when adding)"),
        element: {
          type: "plain_text_input",
          action_id: "value",
        },
      },
      {
        type: "input",
        block_id: CONFIG_BLOCK_IDS.credDelete,
        optional: true,
        label: plainText("Delete credential ID (leave blank to add)"),
        element: {
          type: "plain_text_input",
          action_id: "value",
        },
      },
    ],
  };
}

export function parseRepoSubmission(values: ViewStateValues) {
  return {
    url: readPlainValue(values, CONFIG_BLOCK_IDS.repoUrl, "value").trim(),
    token: readPlainValue(values, CONFIG_BLOCK_IDS.repoToken, "value").trim() || undefined,
  };
}

export function parseDefaultsSubmission(values: ViewStateValues) {
  return {
    tool: readPlainValue(values, CONFIG_BLOCK_IDS.defaultsTool, "value").trim() || undefined,
    model: readPlainValue(values, CONFIG_BLOCK_IDS.defaultsModel, "value").trim() || undefined,
  };
}

export function parseEnvSubmission(values: ViewStateValues) {
  const key = readPlainValue(values, CONFIG_BLOCK_IDS.envKey, "value").trim();
  const value = readPlainValue(values, CONFIG_BLOCK_IDS.envValue, "value").trim();
  const shouldDelete = (
    values[CONFIG_BLOCK_IDS.envDelete]?.["value"]?.selected_options ?? []
  ).some((opt) => opt.value === "delete");

  return { key, value, delete: shouldDelete };
}

export function parseCredentialsSubmission(values: ViewStateValues) {
  const provider = values[CONFIG_BLOCK_IDS.credProvider]?.["value"]?.selected_option?.value ?? "";
  const token = readPlainValue(values, CONFIG_BLOCK_IDS.credToken, "value").trim();
  const deleteId = readPlainValue(values, CONFIG_BLOCK_IDS.credDelete, "value").trim() || undefined;

  return { provider, token, deleteId };
}

function plainInputBlock(
  blockId: string,
  actionId: string,
  label: string,
  initialValue?: string,
) {
  return {
    type: "input",
    block_id: blockId,
    label: plainText(label),
    element: {
      type: "plain_text_input",
      action_id: actionId,
      ...(initialValue ? { initial_value: initialValue } : {}),
    },
  };
}

function readPlainValue(values: ViewStateValues, blockId: string, actionId: string): string {
  return values[blockId]?.[actionId]?.value ?? "";
}
