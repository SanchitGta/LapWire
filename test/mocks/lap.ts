import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Lap, Story, StorySummary } from '../../src/lapClient.js';

export type MockLapState = {
  laps: Record<number, Lap>;
  stories: Record<number, Story>;
  lapStories: Record<number, StorySummary[]>;
  token: string;
};

export type MockLapServer = {
  baseUrl: string;
  stop: () => Promise<void>;
  state: MockLapState;
};

type ErrorEnvelope = {
  ok: false;
  error: { code: string; message: string };
};

export function createInitialLapState(): MockLapState {
  return {
    token: 'test-lap-token',
    laps: {
      10: {
        id: 'lap-10',
        task_no: 10,
        title: 'Sprint Alpha',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        description: 'Foundation sprint for LapWire.',
      },
    },
    stories: {
      42: {
        id: 'story-42',
        task_no: 42,
        title: 'Build lap client',
        status: 'TODO',
        priority: 'HIGHEST',
        description: 'Create a typed HTTP client for laps and stories.',
        assignee: 'usr-admin-1',
      },
    },
    lapStories: {
      10: [
        { id: 'story-42', task_no: 42, title: 'Build lap client', status: 'TODO', priority: 'HIGHEST' },
      ],
    },
  };
}

function writeJson(response: ServerResponse<IncomingMessage>, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse<IncomingMessage>, statusCode: number, code: string, message: string): void {
  const envelope: ErrorEnvelope = { ok: false, error: { code, message } };
  writeJson(response, statusCode, envelope);
}

function checkAuth(state: MockLapState, request: IncomingMessage): boolean {
  const header = request.headers.authorization;
  return header === `Bearer ${state.token}`;
}

function handleRequest(state: MockLapState, request: IncomingMessage, response: ServerResponse<IncomingMessage>): void {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  if (!checkAuth(state, request)) {
    writeError(response, 401, 'unauthorized', 'Authentication required.');
    return;
  }

  const lapStoriesMatch = path.match(/^\/api\/laps\/(\d+)\/stories$/);
  if (lapStoriesMatch) {
    const lapNo = parseInt(lapStoriesMatch[1], 10);
    const stories = state.lapStories[lapNo];
    if (!stories) {
      writeError(response, 404, 'not_found', 'Lap not found.');
      return;
    }
    writeJson(response, 200, stories);
    return;
  }

  const lapMatch = path.match(/^\/api\/laps\/(\d+)$/);
  if (lapMatch) {
    const lapNo = parseInt(lapMatch[1], 10);
    const lap = state.laps[lapNo];
    if (!lap) {
      writeError(response, 404, 'not_found', 'Lap not found.');
      return;
    }
    writeJson(response, 200, lap);
    return;
  }

  const storyMatch = path.match(/^\/api\/stories\/(\d+)$/);
  if (storyMatch) {
    const storyNo = parseInt(storyMatch[1], 10);
    const story = state.stories[storyNo];
    if (!story) {
      writeError(response, 404, 'not_found', 'Story not found.');
      return;
    }
    writeJson(response, 200, story);
    return;
  }

  writeError(response, 404, 'not_found', 'Resource not found.');
}

export function startMockLap(): Promise<MockLapServer> {
  const state = createInitialLapState();

  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        handleRequest(state, request, response);
      } catch (error) {
        if (!response.headersSent) {
          writeError(response, 500, 'internal_error', error instanceof Error ? error.message : 'Unexpected mock error.');
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
