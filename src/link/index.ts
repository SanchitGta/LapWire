import type { AuthClient } from "../auth.js";
import type { LinkStore, StoredLink } from "../store.js";

type SlackRespond = (message: unknown) => Promise<void> | void;

type SlackLogger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type SlackViewsClient = {
  open: (payload: unknown) => Promise<unknown> | unknown;
};

type SlackModalViewsClient = SlackViewsClient & {
  push: (payload: unknown) => Promise<unknown> | unknown;
};

type SlackChatClient = {
  postEphemeral: (payload: unknown) => Promise<unknown> | unknown;
};

export type MetaAppLike = {
  command: (name: string, handler: (args: CommandHandlerArgs) => Promise<void>) => void;
  view: (callbackId: string, handler: (args: ViewHandlerArgs) => Promise<void>) => void;
};

export type CommandHandlerArgs = {
  ack: () => Promise<void> | void;
  respond: SlackRespond;
  command: {
    text: string;
    user_id: string;
    channel_id: string;
    trigger_id: string;
  };
  client: {
    views: SlackViewsClient;
  };
  logger?: SlackLogger;
};

export type ViewHandlerArgs = {
  ack: (response?: unknown) => Promise<void> | void;
  body: {
    user: { id: string };
    trigger_id: string;
    view: {
      callback_id: string;
      private_metadata?: string;
      state: {
        values: Record<
          string,
          Record<
            string,
            {
              value?: string;
            }
          >
        >;
      };
    };
  };
  client: {
    views: SlackModalViewsClient;
    chat: SlackChatClient;
  };
  logger?: SlackLogger;
};

export type LinkDependencies = {
  authClient: AuthClient;
  store: LinkStore;
  now?: () => Date;
  commandHandlers: Record<string, (args: CommandHandlerArgs) => Promise<void>>;
};

type LinkModalMetadata = {
  channelId: string;
  email: string;
};

const EMAIL_BLOCK_ID = "email_input";
const EMAIL_ACTION_ID = "email_value";
const OTP_BLOCK_ID = "otp_input";
const OTP_ACTION_ID = "otp_value";

export function registerLinkHandlers(app: MetaAppLike, dependencies: LinkDependencies): void {
  dependencies.commandHandlers.link = async (args) => {
    await args.ack();
    await args.client.views.open({
      trigger_id: args.command.trigger_id,
      view: buildEmailModal(args.command.channel_id),
    });
  };

  dependencies.commandHandlers.whoami = async (args) => {
    await args.ack();
    await args.respond({
      text: formatWhoAmI(dependencies.store.getLink(args.command.user_id), dependencies.now),
    });
  };

  dependencies.commandHandlers.unlink = async (args) => {
    await args.ack();
    dependencies.store.deleteLink(args.command.user_id);
    await args.respond({
      text: "Unlinked your MindLap account.",
    });
  };

  app.view("link_email", async (args) => {
    const email = readPlainInput(args.body.view.state.values, EMAIL_BLOCK_ID, EMAIL_ACTION_ID).trim();

    await dependencies.authClient.sendOtp({ email });
    await args.ack();
    await args.client.views.push({
      trigger_id: args.body.trigger_id,
      view: buildOtpModal({
        channelId: readLinkMetadata(args.body.view.private_metadata).channelId,
        email,
      }),
    });
  });

  app.view("link_otp", async (args) => {
    const otp = readPlainInput(args.body.view.state.values, OTP_BLOCK_ID, OTP_ACTION_ID).trim();
    const metadata = readLinkMetadata(args.body.view.private_metadata);

    try {
      const verified = await dependencies.authClient.verifyOtp({
        email: metadata.email,
        otp,
      });
      const me = await dependencies.authClient.getMe(verified.access_token);
      const exp = readJwtExp(verified.access_token);

      dependencies.store.putLink({
        slackUserId: args.body.user.id,
        mindlapUserId: me.id,
        email: me.email,
        accessToken: verified.access_token,
        role: me.role,
        exp,
        createdAt: currentUnixSeconds(dependencies.now),
      });

      await args.ack();
      await args.client.chat.postEphemeral({
        channel: metadata.channelId,
        user: args.body.user.id,
        text: `✅ Linked as ${me.email} (${me.role})`,
      });
    } catch (error) {
      await args.ack({
        response_action: "errors",
        errors: {
          [OTP_BLOCK_ID]: error instanceof Error ? error.message : "Unable to verify OTP.",
        },
      });
    }
  });
}

export function formatWhoAmI(link: StoredLink | null, nowProvider?: () => Date): string {
  if (!link) {
    return "Not linked — run /meta link";
  }

  const nowSeconds = currentUnixSeconds(nowProvider);
  if (link.exp <= nowSeconds) {
    return "⚠ link expired — run /meta link";
  }

  return `Linked as ${link.email} (${link.role}) — valid ${formatRemaining(link.exp - nowSeconds)}`;
}

function buildEmailModal(channelId: string) {
  return {
    type: "modal",
    callback_id: "link_email",
    private_metadata: JSON.stringify({ channelId, email: "" } satisfies LinkModalMetadata),
    title: { type: "plain_text", text: "Link MindLap" },
    submit: { type: "plain_text", text: "Send OTP" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: EMAIL_BLOCK_ID,
        label: { type: "plain_text", text: "Email" },
        element: {
          type: "plain_text_input",
          action_id: EMAIL_ACTION_ID,
        },
      },
    ],
  };
}

function buildOtpModal(metadata: LinkModalMetadata) {
  return {
    type: "modal",
    callback_id: "link_otp",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Enter OTP" },
    submit: { type: "plain_text", text: "Verify" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Enter the OTP sent to ${metadata.email}.`,
        },
      },
      {
        type: "input",
        block_id: OTP_BLOCK_ID,
        label: { type: "plain_text", text: "OTP" },
        element: {
          type: "plain_text_input",
          action_id: OTP_ACTION_ID,
        },
      },
    ],
  };
}

function readPlainInput(
  values: ViewHandlerArgs["body"]["view"]["state"]["values"],
  blockId: string,
  actionId: string,
): string {
  return values[blockId]?.[actionId]?.value ?? "";
}

function readLinkMetadata(value: string | undefined): LinkModalMetadata {
  if (!value) {
    throw new Error("Missing modal metadata.");
  }

  const parsed = JSON.parse(value) as Partial<LinkModalMetadata>;
  return {
    channelId: parsed.channelId ?? "",
    email: parsed.email ?? "",
  };
}

function currentUnixSeconds(nowProvider?: () => Date): number {
  return Math.floor((nowProvider ?? (() => new Date()))().getTime() / 1000);
}

function readJwtExp(token: string): number {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("MindLap token is missing an exp claim.");
  }

  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
    exp?: number;
  };
  if (typeof payload.exp !== "number") {
    throw new Error("MindLap token is missing an exp claim.");
  }

  return payload.exp;
}

function formatRemaining(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${Math.max(minutes, 0)}m`;
}
