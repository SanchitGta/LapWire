import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MindlapRole = 'admin' | 'member';
export type QueueType = 'local' | 'cloud';
export type CredentialProvider = 'claude' | 'codex' | 'gemini' | 'opencode';

export type CronEntry = {
  name: string;
  schedule: string;
  instruction: string;
  agent?: string;
  tool?: string;
  model?: string;
  harness?: string;
  attached_files: string[];
  queue: QueueType;
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

export type ProjectSummary = {
  id: string;
  name: string;
  type: string | null;
  org_id: string;
  created_at: string;
};

export type RepoConfig = {
  url: string | null;
  token_set: boolean;
};

export type DefaultsConfig = {
  tool: string | null;
  model: string | null;
};

export type HeartbeatState = {
  enabled: boolean;
  expires_at: string | null;
};

export type HeartbeatResponse = {
  project_id: string;
  enabled: boolean;
  schedule: string | null;
  rule_name: string | null;
  expires_at: string | null;
};

export type EnvVarState = {
  key: string;
  value: string;
};

export type EnvVarView = {
  key: string;
  is_set: boolean;
};

export type CredentialRecord = {
  id: string;
  provider: CredentialProvider;
  owner?: string;
  token: string;
};

export type MemberRecord = {
  user_id: string;
  email: string;
  role: MindlapRole;
};

export type FactoryStatus = {
  project: { id: string; name: string };
  repo: RepoConfig;
  cloud_enabled: boolean;
  defaults: DefaultsConfig;
  heartbeat: HeartbeatState;
  harnesses: string[];
  cron: {
    file_id: string | null;
    entries: CronEntry[];
  };
  recent_activity: Activity[];
};

export type ProjectState = {
  summary: ProjectSummary;
  status: FactoryStatus;
  env: EnvVarState[];
  credentials: CredentialRecord[];
  members: MemberRecord[];
};

export type MockUser = {
  id: string;
  email: string;
  role: MindlapRole;
};

export type MockMindlapState = {
  org: string;
  projects: Record<string, ProjectState>;
  users: {
    admin: MockUser;
    member: MockUser;
  };
  otp: {
    valid: string;
  };
  tokens: {
    admin: string;
    member: string;
    expiredAdmin: string;
  };
  nextCredentialId: number;
};

export type MockMindlapServer = {
  baseUrl: string;
  apiBase: string;
  stop: () => Promise<void>;
  state: MockMindlapState;
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type RouteContext = {
  request: IncomingMessage;
  response: ServerResponse<IncomingMessage>;
  url: URL;
  state: MockMindlapState;
};

type StartPayload = {
  lap_no?: number;
  name?: string;
  schedule?: string;
  agent?: string;
  tool?: string;
  model?: string;
  harness?: string;
  queue?: QueueType;
  enable_heartbeat?: boolean;
};

type StopPayload = {
  lap_no?: number;
  name?: string;
  disable_heartbeat?: boolean;
};

const FIXED_NOW = '2026-06-25T00:00:00.000Z';
const DEFAULT_HEARTBEAT_EXPIRY = '2026-06-25T12:00:00.000Z';
const REARMED_HEARTBEAT_EXPIRY = '2026-06-26T00:00:00.000Z';
const CRISPR_CREATED_AT = '2026-06-20T10:00:00.000Z';
const D4_CREATED_AT = '2026-06-19T08:30:00.000Z';
const CRON_CREATED_AT = '2026-06-24T09:00:00.000Z';
const CRON_UPDATED_AT = '2026-06-24T09:15:00.000Z';

const ERROR_MESSAGES = {
  unauthorized: 'Authentication required. Run /meta link again.',
  invalidToken: 'Your MindLap session is invalid or expired. Run /meta link again.',
  adminRequired: 'this requires a MindLap global admin',
  notFound: 'Resource not found.',
  badOtp: 'Invalid OTP code.',
};

export function startMockMindlap(): Promise<MockMindlapServer> {
  const state = createInitialState();

  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const context: RouteContext = { request, response, url, state };

      try {
        await handleRequest(context);
      } catch (error) {
        if (!response.headersSent) {
          writeJson(response, 500, {
            ok: false,
            error: {
              code: 'internal_error',
              message: error instanceof Error ? error.message : 'Unexpected mock error.',
            },
          });
        } else {
          response.end();
        }
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      resolve({
        baseUrl,
        apiBase: baseUrl,
        state,
        stop: () =>
          new Promise<void>((stopResolve, stopReject) => {
            server.close((error) => {
              if (error) {
                stopReject(error);
                return;
              }

              stopResolve();
            });
          }),
      });
    });
  });
}

export function createInitialState(): MockMindlapState {
  const admin: MockUser = {
    id: 'usr-admin-1',
    email: 'testuser@mindlap.dev',
    role: 'admin',
  };
  const member: MockUser = {
    id: 'usr-member-1',
    email: 'member@acme.dev',
    role: 'member',
  };

  return {
    org: 'acme',
    otp: {
      valid: '414141',
    },
    tokens: {
      admin: createMockJwt({ sub: admin.id, email: admin.email, role: admin.role, exp: 1783036800 }),
      member: createMockJwt({ sub: member.id, email: member.email, role: member.role, exp: 1783036800 }),
      expiredAdmin: createMockJwt({ sub: admin.id, email: admin.email, role: admin.role, exp: 1719187200 }),
    },
    users: {
      admin,
      member,
    },
    nextCredentialId: 4,
    projects: {
      vY8joe: {
        summary: {
          id: 'vY8joe',
          name: 'crispr-bench',
          type: 'factory',
          org_id: 'acme',
          created_at: CRISPR_CREATED_AT,
        },
        status: {
          project: {
            id: 'vY8joe',
            name: 'crispr-bench',
          },
          repo: {
            url: 'https://github.com/acme/crispr-bench',
            token_set: true,
          },
          cloud_enabled: true,
          defaults: {
            tool: 'claude',
            model: 'sonnet',
          },
          heartbeat: {
            enabled: true,
            expires_at: DEFAULT_HEARTBEAT_EXPIRY,
          },
          harnesses: ['code', 'deploy'],
          cron: {
            file_id: 'file-cron-crispr',
            entries: [
              {
                name: 'factory-lap-3',
                schedule: '0 * * * *',
                instruction: 'Run lap 3 factory tasks',
                agent: 'meta-engineer',
                tool: 'claude',
                model: 'sonnet',
                harness: 'code',
                attached_files: ['vlscYF'],
                queue: 'cloud',
                enabled: true,
                last_run: '2026-06-24T23:00:00.000Z',
                last_result: 'success',
                created_at: CRON_CREATED_AT,
                updated_at: CRON_UPDATED_AT,
              },
            ],
          },
          recent_activity: [
            {
              action: 'factory.started',
              entity: 'cron',
              entity_id: 'factory-lap-3',
              user_id: admin.id,
              created_at: '2026-06-24T23:00:00.000Z',
            },
          ],
        },
        env: [
          { key: 'ENV_API_KEY', value: 'set-in-fixture' },
          { key: 'ENV_REGION', value: 'us-east-1' },
        ],
        credentials: [
          { id: 'cred-1', provider: 'claude', owner: 'ops', token: 'claude-secret' },
          { id: 'cred-2', provider: 'codex', owner: 'ops', token: 'codex-secret' },
        ],
        members: [
          { user_id: admin.id, email: admin.email, role: 'admin' },
          { user_id: member.id, email: member.email, role: 'member' },
        ],
      },
      A2bYWi: {
        summary: {
          id: 'A2bYWi',
          name: 'd4-analytics',
          type: 'factory',
          org_id: 'acme',
          created_at: D4_CREATED_AT,
        },
        status: {
          project: {
            id: 'A2bYWi',
            name: 'd4-analytics',
          },
          repo: {
            url: null,
            token_set: false,
          },
          cloud_enabled: false,
          defaults: {
            tool: 'codex',
            model: 'gpt-5',
          },
          heartbeat: {
            enabled: false,
            expires_at: null,
          },
          harnesses: ['code'],
          cron: {
            file_id: null,
            entries: [
              {
                name: 'factory-lap-1',
                schedule: '30 2 * * *',
                instruction: 'Run lap 1 analytics factory tasks',
                agent: 'meta-engineer',
                tool: 'codex',
                model: 'gpt-5',
                harness: 'code',
                attached_files: [],
                queue: 'local',
                enabled: false,
                last_run: null,
                last_result: null,
                created_at: CRON_CREATED_AT,
                updated_at: CRON_CREATED_AT,
              },
            ],
          },
          recent_activity: [
            {
              action: 'factory.stopped',
              entity: 'cron',
              entity_id: 'factory-lap-1',
              user_id: admin.id,
              created_at: '2026-06-24T08:00:00.000Z',
            },
          ],
        },
        env: [{ key: 'ENV_SAMPLE', value: 'present' }],
        credentials: [{ id: 'cred-3', provider: 'gemini', owner: 'ops', token: 'gemini-secret' }],
        members: [
          { user_id: admin.id, email: admin.email, role: 'admin' },
          { user_id: member.id, email: member.email, role: 'member' },
        ],
      },
    },
  };
}

function createMockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

async function handleRequest(context: RouteContext): Promise<void> {
  const { request, response, url, state } = context;
  const path = url.pathname;
  const method = request.method ?? 'GET';

  if (method === 'POST' && path === '/api/auth/send-otp') {
    await readJsonBody<{ email: string }>(request);
    writeJson(response, 200, { ok: true });
    return;
  }

  if (method === 'POST' && path === '/api/auth/verify-otp') {
    const body = await readJsonBody<{ email: string; otp: string }>(request);
    const token = resolveOtpToken(state, body.email, body.otp);

    if (!token) {
      writeGatewayError(response, 401, 'invalid_otp', ERROR_MESSAGES.badOtp);
      return;
    }

    writeJson(response, 200, { access_token: token });
    return;
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const auth = requireAuthHeaderWithState(state, request);

    if (!auth.ok) {
      writeGatewayError(response, auth.status, auth.code, auth.message);
      return;
    }

    writeJson(response, 200, auth.user);
    return;
  }

  const auth = requireMetaAdmin(context);
  if (!auth.ok) {
    writeGatewayError(response, auth.status, auth.code, auth.message);
    return;
  }

  const orgProjectsMatch = path.match(/^\/api\/meta\/orgs\/([^/]+)\/projects$/);
  if (method === 'GET' && orgProjectsMatch) {
    const org = decodeURIComponent(orgProjectsMatch[1]);
    if (org !== state.org) {
      writeGatewayError(response, 404, 'not_found', ERROR_MESSAGES.notFound);
      return;
    }

    writeJson(
      response,
      200,
      Object.values(state.projects).map((project) => clone(project.summary)),
    );
    return;
  }

  const statusMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/factory\/status$/);
  if (method === 'GET' && statusMatch) {
    const project = getProjectOr404(response, state, statusMatch[1], url.searchParams.get('org'));
    if (!project) {
      return;
    }

    writeJson(response, 200, clone(project.status));
    return;
  }

  const startMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/factory\/start$/);
  if (method === 'POST' && startMatch) {
    const project = getProjectOr404(response, state, startMatch[1]);
    if (!project) {
      return;
    }

    const payload = await readJsonBody<StartPayload>(request);
    const entry = applyStartMutation(project, payload);

    if (payload.enable_heartbeat !== false) {
      project.status.heartbeat.enabled = true;
      project.status.heartbeat.expires_at = REARMED_HEARTBEAT_EXPIRY;
    }

    writeJson(response, 200, {
      entry: clone(entry),
      heartbeat: clone(project.status.heartbeat),
    });
    return;
  }

  const stopMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/factory\/stop$/);
  if (method === 'POST' && stopMatch) {
    const project = getProjectOr404(response, state, stopMatch[1]);
    if (!project) {
      return;
    }

    const payload = await readJsonBody<StopPayload>(request);
    const entry = applyStopMutation(project, payload);

    if (payload.disable_heartbeat) {
      project.status.heartbeat.enabled = false;
      project.status.heartbeat.expires_at = null;
    }

    writeJson(response, 200, {
      entry: entry ? clone(entry) : null,
      heartbeat: clone(project.status.heartbeat),
    });
    return;
  }

  const heartbeatMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/heartbeat$/);
  if (heartbeatMatch) {
    const project = getProjectOr404(response, state, heartbeatMatch[1]);
    if (!project) {
      return;
    }

    if (method === 'GET') {
      writeJson(response, 200, buildHeartbeatResponse(project));
      return;
    }

    if (method === 'POST') {
      const body = await readJsonBody<{ enabled: boolean }>(request);
      project.status.heartbeat.enabled = body.enabled;
      project.status.heartbeat.expires_at = body.enabled ? REARMED_HEARTBEAT_EXPIRY : null;
      writeJson(response, 200, buildHeartbeatResponse(project));
      return;
    }
  }

  const repoMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/repo$/);
  if (repoMatch) {
    const project = getProjectOr404(response, state, repoMatch[1]);
    if (!project) {
      return;
    }

    if (method === 'GET') {
      writeJson(response, 200, clone(project.status.repo));
      return;
    }

    if (method === 'PUT') {
      const body = await readJsonBody<{ url: string; token?: string }>(request);
      project.status.repo.url = body.url;
      project.status.repo.token_set = typeof body.token === 'string' ? body.token.length > 0 : project.status.repo.token_set;
      writeJson(response, 200, clone(project.status.repo));
      return;
    }
  }

  const cloudMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/cloud$/);
  if (method === 'PUT' && cloudMatch) {
    const project = getProjectOr404(response, state, cloudMatch[1]);
    if (!project) {
      return;
    }

    const body = await readJsonBody<{ enabled: boolean }>(request);
    project.status.cloud_enabled = body.enabled;
    writeJson(response, 200, { enabled: project.status.cloud_enabled });
    return;
  }

  const defaultsMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/defaults$/);
  if (defaultsMatch) {
    const project = getProjectOr404(response, state, defaultsMatch[1]);
    if (!project) {
      return;
    }

    if (method === 'GET') {
      writeJson(response, 200, clone(project.status.defaults));
      return;
    }

    if (method === 'PUT') {
      const body = await readJsonBody<{ tool?: string; model?: string }>(request);
      project.status.defaults = {
        tool: body.tool ?? project.status.defaults.tool,
        model: body.model ?? project.status.defaults.model,
      };
      writeJson(response, 200, clone(project.status.defaults));
      return;
    }
  }

  const envMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/env$/);
  if (method === 'GET' && envMatch) {
    const project = getProjectOr404(response, state, envMatch[1]);
    if (!project) {
      return;
    }

    writeJson(response, 200, project.env.map(({ key }) => ({ key, is_set: true } satisfies EnvVarView)));
    return;
  }

  const envKeyMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/env\/([^/]+)$/);
  if (envKeyMatch) {
    const project = getProjectOr404(response, state, envKeyMatch[1]);
    if (!project) {
      return;
    }

    const key = decodeURIComponent(envKeyMatch[2]);

    if (method === 'PUT') {
      const body = await readJsonBody<{ value: string }>(request);
      const existing = project.env.find((entry) => entry.key === key);
      if (existing) {
        existing.value = body.value;
      } else {
        project.env.push({ key, value: body.value });
      }
      writeJson(response, 200, { key, is_set: true });
      return;
    }

    if (method === 'DELETE') {
      project.env = project.env.filter((entry) => entry.key !== key);
      writeJson(response, 200, { deleted: true });
      return;
    }
  }

  const credentialsMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/credentials$/);
  if (credentialsMatch) {
    const project = getProjectOr404(response, state, credentialsMatch[1]);
    if (!project) {
      return;
    }

    if (method === 'GET') {
      writeJson(
        response,
        200,
        project.credentials.map(({ id, provider, owner }) => ({
          id,
          provider,
          ...(owner ? { owner } : {}),
        })),
      );
      return;
    }

    if (method === 'POST') {
      const body = await readJsonBody<{ provider: CredentialProvider; token: string; owner?: string }>(request);
      const credential = {
        id: `cred-${state.nextCredentialId++}`,
        provider: body.provider,
        token: body.token,
        ...(body.owner ? { owner: body.owner } : {}),
      } satisfies CredentialRecord;
      project.credentials.push(credential);
      writeJson(response, 200, { id: credential.id, provider: credential.provider });
      return;
    }
  }

  const credentialDeleteMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/credentials\/([^/]+)$/);
  if (method === 'DELETE' && credentialDeleteMatch) {
    const project = getProjectOr404(response, state, credentialDeleteMatch[1]);
    if (!project) {
      return;
    }

    const credentialId = decodeURIComponent(credentialDeleteMatch[2]);
    project.credentials = project.credentials.filter((credential) => credential.id !== credentialId);
    writeJson(response, 200, { deleted: true });
    return;
  }

  const membersMatch = path.match(/^\/api\/meta\/projects\/([^/]+)\/members$/);
  if (method === 'GET' && membersMatch) {
    const project = getProjectOr404(response, state, membersMatch[1]);
    if (!project) {
      return;
    }

    writeJson(response, 200, clone(project.members));
    return;
  }

  writeGatewayError(response, 404, 'not_found', ERROR_MESSAGES.notFound);
}

function resolveOtpToken(state: MockMindlapState, email: string, otp: string): string | null {
  if (otp !== state.otp.valid) {
    return null;
  }

  if (email === state.users.admin.email) {
    return state.tokens.admin;
  }

  if (email === state.users.member.email) {
    return state.tokens.member;
  }

  return state.tokens.admin;
}

function requireMetaAdmin(context: RouteContext):
  | { ok: true; user: MockUser }
  | { ok: false; status: number; code: string; message: string } {
  const auth = requireAuthHeaderWithState(context.state, context.request);
  if (!auth.ok) {
    return auth;
  }

  if (auth.user.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      code: 'admin_required',
      message: ERROR_MESSAGES.adminRequired,
    };
  }

  return auth;
}

function requireAuthHeaderWithState(
  state: MockMindlapState,
  request: IncomingMessage,
):
  | { ok: true; user: MockUser }
  | { ok: false; status: number; code: string; message: string } {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: ERROR_MESSAGES.unauthorized,
    };
  }

  const token = header.slice('Bearer '.length);
  return resolveToken(state, token);
}

function resolveToken(state: MockMindlapState, token: string):
  | { ok: true; user: MockUser }
  | { ok: false; status: number; code: string; message: string } {
  if (token === state.tokens.admin) {
    return {
      ok: true,
      user: clone(state.users.admin),
    };
  }

  if (token === state.tokens.member) {
    return {
      ok: true,
      user: clone(state.users.member),
    };
  }

  if (token === state.tokens.expiredAdmin) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_token',
      message: ERROR_MESSAGES.invalidToken,
    };
  }

  return {
    ok: false,
    status: 401,
    code: 'unauthorized',
    message: ERROR_MESSAGES.unauthorized,
  };
}

function getProjectOr404(
  response: ServerResponse<IncomingMessage>,
  state: MockMindlapState,
  projectId: string,
  org?: string | null,
): ProjectState | null {
  const project = state.projects[decodeURIComponent(projectId)];
  if (!project) {
    writeGatewayError(response, 404, 'not_found', ERROR_MESSAGES.notFound);
    return null;
  }

  if (org && org !== state.org) {
    writeGatewayError(response, 404, 'not_found', ERROR_MESSAGES.notFound);
    return null;
  }

  return project;
}

function buildHeartbeatResponse(project: ProjectState): HeartbeatResponse {
  const activeEntry = project.status.cron.entries.find((entry) => entry.enabled) ?? null;

  return {
    project_id: project.summary.id,
    enabled: project.status.heartbeat.enabled,
    schedule: activeEntry?.schedule ?? null,
    rule_name: activeEntry?.name ?? null,
    expires_at: project.status.heartbeat.expires_at,
  };
}

function applyStartMutation(project: ProjectState, payload: StartPayload): CronEntry {
  const entryName =
    payload.name ??
    (typeof payload.lap_no === 'number' ? `factory-lap-${payload.lap_no}` : project.status.cron.entries[0]?.name ?? 'factory-lap');
  const existing = project.status.cron.entries.find((entry) => entry.name === entryName);

  const entry: CronEntry = {
    name: entryName,
    schedule: payload.schedule ?? existing?.schedule ?? '0 * * * *',
    instruction:
      existing?.instruction ??
      (typeof payload.lap_no === 'number' ? `Run lap ${payload.lap_no} factory tasks` : 'Run factory tasks'),
    agent: payload.agent ?? existing?.agent,
    tool: payload.tool ?? existing?.tool ?? project.status.defaults.tool ?? undefined,
    model: payload.model ?? existing?.model ?? project.status.defaults.model ?? undefined,
    harness: payload.harness ?? existing?.harness ?? 'code',
    attached_files: existing?.attached_files ? [...existing.attached_files] : [],
    queue: payload.queue ?? existing?.queue ?? (project.status.cloud_enabled ? 'cloud' : 'local'),
    enabled: true,
    last_run: existing?.last_run ?? null,
    last_result: existing?.last_result ?? null,
    created_at: existing?.created_at ?? FIXED_NOW,
    updated_at: FIXED_NOW,
  };

  if (existing) {
    Object.assign(existing, entry);
    project.status.cron.entries = project.status.cron.entries.map((current) =>
      current.name === existing.name ? existing : current,
    );
    return existing;
  }

  project.status.cron.entries.push(entry);
  return entry;
}

function applyStopMutation(project: ProjectState, payload: StopPayload): CronEntry | null {
  const target =
    project.status.cron.entries.find((entry) => {
      if (typeof payload.lap_no === 'number') {
        return entry.name === `factory-lap-${payload.lap_no}`;
      }

      if (payload.name) {
        return entry.name === payload.name;
      }

      return entry.enabled;
    }) ?? null;

  if (!target) {
    return null;
  }

  target.enabled = false;
  target.updated_at = FIXED_NOW;
  return target;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return (raw ? JSON.parse(raw) : {}) as T;
}

function writeJson(response: ServerResponse<IncomingMessage>, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function writeGatewayError(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  code: string,
  message: string,
): void {
  const envelope: ErrorEnvelope = {
    ok: false,
    error: {
      code,
      message,
    },
  };

  writeJson(response, statusCode, envelope);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
