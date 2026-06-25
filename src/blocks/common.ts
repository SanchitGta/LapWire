export const ACTION_IDS = {
  startLap: "start_lap",
  stopLap: "stop_lap",
  rearmHeartbeat: "rearm_hb",
  disableHeartbeat: "disable_hb",
  editRepo: "cfg_edit_repo",
  toggleCloud: "cfg_toggle_cloud",
  editDefaults: "cfg_edit_defaults",
  manageEnv: "cfg_manage_env",
  manageCredentials: "cfg_manage_creds",
  viewStatus: "view_status",
} as const;

export type BlockActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];

export type ButtonStyle = "primary" | "danger";

export type PlainTextObject = {
  type: "plain_text";
  text: string;
  emoji?: boolean;
};

export type MrkdwnTextObject = {
  type: "mrkdwn";
  text: string;
  verbatim?: boolean;
};

export type ConfirmDialog = {
  title: PlainTextObject;
  text: MrkdwnTextObject;
  confirm: PlainTextObject;
  deny: PlainTextObject;
  style?: ButtonStyle;
};

export type ButtonElement = {
  type: "button";
  action_id: BlockActionId;
  text: PlainTextObject;
  value?: string;
  style?: ButtonStyle;
  confirm?: ConfirmDialog;
  url?: string;
  accessibility_label?: string;
};

export type SectionBlock = {
  type: "section";
  text?: MrkdwnTextObject;
  fields?: MrkdwnTextObject[];
  accessory?: ButtonElement;
};

export type ActionsBlock = {
  type: "actions";
  block_id?: string;
  elements: ButtonElement[];
};

export type ButtonSpec = {
  actionId: BlockActionId;
  text: string;
  value?: string;
  style?: ButtonStyle;
  confirm?: ConfirmDialog;
  url?: string;
  accessibilityLabel?: string;
};

export type SectionOptions = {
  fields?: Array<string | MrkdwnTextObject>;
  accessory?: ButtonElement;
};

export type ConfirmDialogOptions = {
  title: string;
  text: string;
  confirm?: string;
  deny?: string;
  style?: ButtonStyle;
};

export type ButtonRowOptions = {
  blockId?: string;
};

// Stable Slack action IDs live here so phase-2 feature modules share one source of truth.
export function plainText(text: string, emoji = true): PlainTextObject {
  return {
    type: "plain_text",
    text,
    emoji,
  };
}

export function mrkdwn(text: string, verbatim = false): MrkdwnTextObject {
  return {
    type: "mrkdwn",
    text,
    verbatim,
  };
}

export function confirmDialog(options: ConfirmDialogOptions): ConfirmDialog {
  return {
    title: plainText(options.title),
    text: mrkdwn(options.text),
    confirm: plainText(options.confirm ?? "Confirm"),
    deny: plainText(options.deny ?? "Cancel"),
    style: options.style,
  };
}

export function button(spec: ButtonSpec): ButtonElement {
  return {
    type: "button",
    action_id: spec.actionId,
    text: plainText(spec.text),
    value: spec.value,
    style: spec.style,
    confirm: spec.confirm,
    url: spec.url,
    accessibility_label: spec.accessibilityLabel,
  };
}

export function buttonRow(
  specs: readonly ButtonSpec[],
  options: ButtonRowOptions = {},
): ActionsBlock {
  return {
    type: "actions",
    block_id: options.blockId,
    elements: specs.map((spec) => button(spec)),
  };
}

export function section(
  text: string | MrkdwnTextObject,
  options: SectionOptions = {},
): SectionBlock {
  return {
    type: "section",
    text: typeof text === "string" ? mrkdwn(text) : text,
    fields: options.fields?.map((field) => (typeof field === "string" ? mrkdwn(field) : field)),
    accessory: options.accessory,
  };
}
