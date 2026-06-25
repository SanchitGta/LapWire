import { createAuthClient, type AuthClient } from "./auth.js";
import { registerConfigHandlers } from "./config/index.js";
import { registerLifecycleHandlers } from "./lifecycle/index.js";
import { registerLinkHandlers, type LinkDependencies, type MetaAppLike } from "./link/index.js";
import type { MetaClient } from "./metaClient.js";
import { registerStatusHandlers } from "./status/index.js";
import { createLinkStore, type LinkStore } from "./store.js";

export type MetaCommandArgs = {
  ack: () => Promise<void> | void;
  respond: (message: unknown) => Promise<void> | void;
  command: {
    text: string;
    user_id: string;
    channel_id: string;
    trigger_id: string;
  };
  client: {
    views: {
      open: (payload: unknown) => Promise<unknown> | unknown;
    };
  };
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
};

export type RuntimeDependencies = LinkDependencies & {
  metaBaseUrl?: string;
  metaOrg?: string;
  metaClientFactory?: (options: { accessToken: string }) => MetaClient;
};

export function registerMetaHandlers(app: MetaAppLike, dependencies: RuntimeDependencies): void {
  registerLinkHandlers(app, dependencies);

  if (dependencies.metaBaseUrl && dependencies.metaOrg) {
    registerStatusHandlers(app, {
      ...dependencies,
      metaBaseUrl: dependencies.metaBaseUrl,
      metaOrg: dependencies.metaOrg,
    });

    registerLifecycleHandlers(app, {
      ...dependencies,
      metaBaseUrl: dependencies.metaBaseUrl,
      metaOrg: dependencies.metaOrg,
    });

    registerConfigHandlers(app, {
      ...dependencies,
      metaBaseUrl: dependencies.metaBaseUrl,
      metaOrg: dependencies.metaOrg,
    });
  }

  app.command("/meta", async (args: MetaCommandArgs) => {
    const subcommand = args.command.text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    const handler = dependencies.commandHandlers[subcommand];

    if (!handler) {
      await args.ack();
      await args.respond({
        text: "Available subcommands: link, whoami, unlink, fleet, status, start, stop, rearm, config",
      });
      return;
    }

    await handler(args);
  });
}

export type CreateRuntimeOptions = {
  apiBase: string;
  dbPath: string;
  encryptionKey: string;
  metaBaseUrl?: string;
  metaOrg?: string;
  now?: () => Date;
};

export function createRuntimeDependencies(options: CreateRuntimeOptions): RuntimeDependencies & {
  authClient: AuthClient;
  store: LinkStore;
} {
  const authClient = createAuthClient({ apiBase: options.apiBase });
  const store = createLinkStore({
    dbPath: options.dbPath,
    encryptionKey: options.encryptionKey,
  });

  return {
    authClient,
    store,
    metaBaseUrl: options.metaBaseUrl,
    metaOrg: options.metaOrg,
    now: options.now,
    ...(options.metaBaseUrl ? { metaBaseUrl: options.metaBaseUrl } : {}),
    ...(options.metaOrg ? { metaOrg: options.metaOrg } : {}),
    commandHandlers: {},
  };
}
