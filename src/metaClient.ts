import { mapGatewayErrorResponse } from "./errors.js";

type FetchLike = typeof fetch;

export type ProjectSummary = {
  id: string;
  name: string;
  type: string | null;
  org_id: string;
  created_at: string;
};

export type FactoryProject = {
  id: string;
  name: string;
};

export type RepoConfig = {
  url: string | null;
  token_set: boolean;
};

export type DefaultsConfig = {
  tool: string | null;
  model: string | null;
};

export type HeartbeatSummary = {
  enabled: boolean;
  expires_at: string | null;
};

export type CronEntry = {
  name: string;
  schedule: string;
  instruction: string;
  agent?: string;
  tool?: string;
  model?: string;
  harness?: string;
  attached_files: string[];
  queue: "local" | "cloud";
  enabled: boolean;
  last_run: string | null;
  last_result: string | null;
  created_at: string;
  updated_at: string;
};

export type Activity = {
  action: string;
  entity: string;
  entity_id: string;
  user_id: string;
  created_at: string;
};

export type FactoryStatus = {
  project: FactoryProject;
  repo: RepoConfig;
  cloud_enabled: boolean;
  defaults: DefaultsConfig;
  heartbeat: HeartbeatSummary;
  harnesses: string[];
  cron: {
    file_id: string | null;
    entries: CronEntry[];
  };
  recent_activity: Activity[];
};

export type StartFactoryRequest = {
  lap_no?: number;
  name?: string;
  schedule?: string;
  agent?: string;
  tool?: string;
  model?: string;
  harness?: string;
  queue?: "local" | "cloud";
  enable_heartbeat?: boolean;
};

export type StartFactoryResponse = {
  entry: CronEntry;
  heartbeat: HeartbeatSummary;
};

export type StopFactoryRequest = {
  lap_no?: number;
  name?: string;
  disable_heartbeat?: boolean;
};

export type StopFactoryResponse = {
  entry: CronEntry | null;
  heartbeat: HeartbeatSummary;
};

export type HeartbeatConfig = {
  project_id: string;
  enabled: boolean;
  schedule: string | null;
  rule_name: string | null;
  expires_at: string | null;
};

export type UpdateHeartbeatRequest = {
  enabled: boolean;
};

export type UpdateRepoRequest = {
  url: string;
  token?: string;
};

export type UpdateRepoResponse = {
  url: string;
  token_set: boolean;
};

export type UpdateCloudRequest = {
  enabled: boolean;
};

export type UpdateCloudResponse = {
  enabled: boolean;
};

export type UpdateDefaultsRequest = {
  tool?: string;
  model?: string;
};

export type EnvVarSummary = {
  key: string;
  is_set: boolean;
};

export type SetEnvVarRequest = {
  value: string;
};

export type SetEnvVarResponse = {
  key: string;
  is_set: true;
};

export type DeleteEnvVarResponse = {
  deleted: true;
};

export type CredentialProvider = "claude" | "codex" | "gemini" | "opencode";

export type CredentialSummary = {
  id: string;
  provider: CredentialProvider;
  owner?: string;
};

export type CreateCredentialRequest = {
  provider: string;
  token: string;
  owner?: string;
};

export type CreateCredentialResponse = {
  id: string;
  provider: string;
};

export type DeleteCredentialResponse = {
  deleted: true;
};

export type MemberSummary = {
  user_id: string;
  email: string;
  role: "admin" | "member";
};

export type MetaClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | Promise<string>;
  fetch?: FetchLike;
};

export type MetaClient = {
  listProjects(org: string): Promise<ProjectSummary[]>;
  getFactoryStatus(projectId: string, org: string): Promise<FactoryStatus>;
  startFactory(projectId: string, input: StartFactoryRequest): Promise<StartFactoryResponse>;
  stopFactory(projectId: string, input: StopFactoryRequest): Promise<StopFactoryResponse>;
  getHeartbeat(projectId: string): Promise<HeartbeatConfig>;
  updateHeartbeat(projectId: string, input: UpdateHeartbeatRequest): Promise<HeartbeatConfig>;
  getRepo(projectId: string): Promise<RepoConfig>;
  updateRepo(projectId: string, input: UpdateRepoRequest): Promise<UpdateRepoResponse>;
  updateCloud(projectId: string, input: UpdateCloudRequest): Promise<UpdateCloudResponse>;
  getDefaults(projectId: string): Promise<DefaultsConfig>;
  updateDefaults(projectId: string, input: UpdateDefaultsRequest): Promise<DefaultsConfig>;
  listEnv(projectId: string): Promise<EnvVarSummary[]>;
  setEnv(projectId: string, key: string, input: SetEnvVarRequest): Promise<SetEnvVarResponse>;
  deleteEnv(projectId: string, key: string): Promise<DeleteEnvVarResponse>;
  listCredentials(projectId: string): Promise<CredentialSummary[]>;
  createCredential(
    projectId: string,
    input: CreateCredentialRequest,
  ): Promise<CreateCredentialResponse>;
  deleteCredential(projectId: string, credentialId: string): Promise<DeleteCredentialResponse>;
  listMembers(projectId: string): Promise<MemberSummary[]>;
};

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function withPath(baseUrl: string, path: string): URL {
  return new URL(path, ensureTrailingSlash(baseUrl));
}

function withQuery(baseUrl: string, path: string, params: Record<string, string>): URL {
  const url = withPath(baseUrl, path);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
}

export function createMetaClient(options: MetaClientOptions): MetaClient {
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(
    path: string | URL,
    init?: Omit<RequestInit, "headers"> & { headers?: HeadersInit },
  ): Promise<T> {
    const token = await options.getAccessToken();
    const headers = new Headers(init?.headers);

    headers.set("authorization", `Bearer ${token}`);

    if (init?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const url = typeof path === "string" ? withPath(options.baseUrl, path) : path;
    const response = await fetchImpl(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      await mapGatewayErrorResponse(response);
    }

    return (await response.json()) as T;
  }

  function postJson<TRequest, TResponse>(
    path: string,
    body: TRequest,
    method: "POST" | "PUT" = "POST",
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      method,
      body: JSON.stringify(body),
    });
  }

  return {
    listProjects(org) {
      return request<ProjectSummary[]>(`api/meta/orgs/${encodeURIComponent(org)}/projects`);
    },

    getFactoryStatus(projectId, org) {
      return request<FactoryStatus>(
        withQuery(
          options.baseUrl,
          `api/meta/projects/${encodeURIComponent(projectId)}/factory/status`,
          { org },
        ),
      );
    },

    startFactory(projectId, input) {
      return postJson<StartFactoryRequest, StartFactoryResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/factory/start`,
        input,
      );
    },

    stopFactory(projectId, input) {
      return postJson<StopFactoryRequest, StopFactoryResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/factory/stop`,
        input,
      );
    },

    getHeartbeat(projectId) {
      return request<HeartbeatConfig>(`api/meta/projects/${encodeURIComponent(projectId)}/heartbeat`);
    },

    updateHeartbeat(projectId, input) {
      return postJson<UpdateHeartbeatRequest, HeartbeatConfig>(
        `api/meta/projects/${encodeURIComponent(projectId)}/heartbeat`,
        input,
      );
    },

    getRepo(projectId) {
      return request<RepoConfig>(`api/meta/projects/${encodeURIComponent(projectId)}/repo`);
    },

    updateRepo(projectId, input) {
      return postJson<UpdateRepoRequest, UpdateRepoResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/repo`,
        input,
        "PUT",
      );
    },

    updateCloud(projectId, input) {
      return postJson<UpdateCloudRequest, UpdateCloudResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/cloud`,
        input,
        "PUT",
      );
    },

    getDefaults(projectId) {
      return request<DefaultsConfig>(`api/meta/projects/${encodeURIComponent(projectId)}/defaults`);
    },

    updateDefaults(projectId, input) {
      return postJson<UpdateDefaultsRequest, DefaultsConfig>(
        `api/meta/projects/${encodeURIComponent(projectId)}/defaults`,
        input,
        "PUT",
      );
    },

    listEnv(projectId) {
      return request<EnvVarSummary[]>(`api/meta/projects/${encodeURIComponent(projectId)}/env`);
    },

    setEnv(projectId, key, input) {
      return postJson<SetEnvVarRequest, SetEnvVarResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(key)}`,
        input,
        "PUT",
      );
    },

    deleteEnv(projectId, key) {
      return request<DeleteEnvVarResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        },
      );
    },

    listCredentials(projectId) {
      return request<CredentialSummary[]>(
        `api/meta/projects/${encodeURIComponent(projectId)}/credentials`,
      );
    },

    createCredential(projectId, input) {
      return postJson<CreateCredentialRequest, CreateCredentialResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/credentials`,
        input,
      );
    },

    deleteCredential(projectId, credentialId) {
      return request<DeleteCredentialResponse>(
        `api/meta/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(credentialId)}`,
        {
          method: "DELETE",
        },
      );
    },

    listMembers(projectId) {
      return request<MemberSummary[]>(`api/meta/projects/${encodeURIComponent(projectId)}/members`);
    },
  };
}
