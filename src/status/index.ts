import { AdminRequiredError, InvalidTokenError, UnauthorizedError } from "../errors.js";
import { createMetaClient, type FactoryStatus, type MetaClient, type ProjectSummary } from "../metaClient.js";
import type { StoredLink, LinkStore } from "../store.js";
import type { CommandHandlerArgs, MetaAppLike } from "../link/index.js";
import { buildFleetStatusBlocks, buildProjectStatusBlocks } from "./cards.js";

export type StatusDependencies = {
  store: LinkStore;
  metaBaseUrl: string;
  metaOrg: string;
  now?: () => Date;
  commandHandlers: Record<string, (args: CommandHandlerArgs) => Promise<void>>;
  metaClientFactory?: (options: { accessToken: string }) => MetaClient;
};

export function registerStatusHandlers(_app: MetaAppLike, dependencies: StatusDependencies): void {
  dependencies.commandHandlers.fleet = async (args) => {
    await args.ack();

    const link = dependencies.store.getLink(args.command.user_id);
    const access = requireLiveLink(link, dependencies.now);
    if (!access.ok) {
      await args.respond({ text: access.message });
      return;
    }

    try {
      const client = createClient(dependencies, access.link.accessToken);
      const projects = await client.listProjects(dependencies.metaOrg);
      const statuses = await Promise.all(
        projects.map(async (project) => ({
          projectId: project.id,
          projectName: project.name,
          status: await client.getFactoryStatus(project.id, dependencies.metaOrg),
        })),
      );

      await args.respond({
        text: `Live fleet status for ${dependencies.metaOrg}`,
        blocks: buildFleetStatusBlocks(statuses, {
          org: dependencies.metaOrg,
          now: dependencies.now,
        }),
      });
    } catch (error) {
      await args.respond({
        text: mapStatusError(error),
      });
    }
  };

  dependencies.commandHandlers.status = async (args) => {
    await args.ack();

    const projectName = readProjectNameArg(args.command.text);
    if (!projectName) {
      await args.respond({
        text: "Usage: /meta status <project>",
      });
      return;
    }

    const link = dependencies.store.getLink(args.command.user_id);
    const access = requireLiveLink(link, dependencies.now);
    if (!access.ok) {
      await args.respond({ text: access.message });
      return;
    }

    try {
      const client = createClient(dependencies, access.link.accessToken);
      const projects = await client.listProjects(dependencies.metaOrg);
      const project = findProjectByName(projects, projectName);

      if (!project) {
        await args.respond({
          text: `Project "${projectName}" was not found in ${dependencies.metaOrg}.`,
        });
        return;
      }

      const status = await client.getFactoryStatus(project.id, dependencies.metaOrg);
      await args.respond({
        text: `Live status for ${project.name}`,
        blocks: buildProjectStatusBlocks(status, {
          org: dependencies.metaOrg,
          now: dependencies.now,
        }),
      });
    } catch (error) {
      await args.respond({
        text: mapStatusError(error),
      });
    }
  };
}

export function findProjectByName(
  projects: ProjectSummary[],
  requestedName: string,
): ProjectSummary | null {
  const normalized = requestedName.trim().toLowerCase();
  return projects.find((project) => project.name.toLowerCase() === normalized) ?? null;
}

export function readProjectNameArg(commandText: string): string {
  const [_, ...rest] = commandText.trim().split(/\s+/);
  return rest.join(" ").trim();
}

function requireLiveLink(
  link: StoredLink | null,
  now?: () => Date,
): { ok: true; link: StoredLink } | { ok: false; message: string } {
  if (!link) {
    return {
      ok: false,
      message: "Not linked — run /meta link",
    };
  }

  const nowSeconds = Math.floor((now ?? (() => new Date()))().getTime() / 1000);
  if (link.exp <= nowSeconds) {
    return {
      ok: false,
      message: "⚠ link expired — run /meta link",
    };
  }

  return {
    ok: true,
    link,
  };
}

function createClient(dependencies: StatusDependencies, accessToken: string): MetaClient {
  if (dependencies.metaClientFactory) {
    return dependencies.metaClientFactory({ accessToken });
  }

  return createMetaClient({
    baseUrl: dependencies.metaBaseUrl,
    getAccessToken: () => accessToken,
  });
}

function mapStatusError(error: unknown): string {
  if (
    error instanceof UnauthorizedError ||
    error instanceof InvalidTokenError ||
    error instanceof AdminRequiredError
  ) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load live status.";
}

export type ProjectStatusView = {
  project: ProjectSummary;
  status: FactoryStatus;
};
