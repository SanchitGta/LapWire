import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createAuthClient, type AuthClient } from "./auth.js";
import { createApp } from "./app.js";
import { registerLinkHandlers, type LinkDependencies, type MetaAppLike } from "./link/index.js";
import type { MetaClient } from "./metaClient.js";
import { registerStatusHandlers } from "./status/index.js";
import { createLinkStore, type LinkStore } from "./store.js";

export { loadConfig, type LapWireConfig } from "./config/lapwire.js";

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
  }

  app.command("/meta", async (args: MetaCommandArgs) => {
    const subcommand = args.command.text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    const handler = dependencies.commandHandlers[subcommand];

    if (!handler) {
      await args.ack();
      await args.respond({
        text: "Available subcommands: link, whoami, unlink, fleet, status",
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
    commandHandlers: {},
  };
}

async function main(): Promise<void> {
  loadEnv();

  const app = createApp();

  const runtime = createRuntimeDependencies({
    apiBase: process.env.MINDLAP_API_BASE ?? "",
    dbPath: process.env.LAPWIRE_DB_PATH ?? "data/lapwire.db",
    encryptionKey: process.env.LAPWIRE_ENCRYPTION_KEY ?? "",
    metaBaseUrl: process.env.META_BASE_URL,
    metaOrg: process.env.META_ORG,
  });

  // Bolt's App satisfies MetaAppLike structurally at runtime
  registerMetaHandlers(app as unknown as MetaAppLike, runtime);

  const shutdown = (): void => {
    runtime.store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.start();
  console.log("⚡ LapWire running in Socket Mode");
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
