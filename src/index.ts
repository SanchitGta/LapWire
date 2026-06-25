import { createAuthClient, type AuthClient } from "./auth.js";
import { registerLifecycleHandlers, type LifecycleDependencies } from "./lifecycle/index.js";
import { registerLinkHandlers, type LinkDependencies, type MetaAppLike } from "./link/index.js";
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

export type RuntimeDependencies = LinkDependencies;

export function registerMetaHandlers(app: MetaAppLike, dependencies: RuntimeDependencies): void {
  app.command("/meta", async (args: MetaCommandArgs) => {
    const subcommand = args.command.text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    const handler = dependencies.commandHandlers[subcommand];

    if (!handler) {
      await args.ack();
      await args.respond({
        text: "Available subcommands: link, whoami, unlink",
      });
      return;
    }

    await handler(args);
  });

  registerLinkHandlers(app, dependencies);
  if (
    "metaBaseUrl" in dependencies &&
    typeof dependencies.metaBaseUrl === "string" &&
    dependencies.metaBaseUrl.length > 0 &&
    "metaOrg" in dependencies &&
    typeof dependencies.metaOrg === "string" &&
    dependencies.metaOrg.length > 0
  ) {
    registerLifecycleHandlers(app, dependencies as RuntimeDependencies & LifecycleDependencies);
  }
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
    now: options.now,
    ...(options.metaBaseUrl ? { metaBaseUrl: options.metaBaseUrl } : {}),
    ...(options.metaOrg ? { metaOrg: options.metaOrg } : {}),
    commandHandlers: {},
  };
}
