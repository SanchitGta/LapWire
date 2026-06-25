import { mapGatewayErrorResponse } from "./errors.js";

type FetchLike = typeof fetch;

export type StorySummary = {
  id: string;
  task_no: number;
  title: string;
  status: string;
  priority: string;
};

export type Lap = {
  id: string;
  task_no: number;
  title: string;
  status: string;
  priority: string;
  description: string;
  stories?: StorySummary[];
};

export type Story = {
  id: string;
  task_no: number;
  title: string;
  status: string;
  priority: string;
  description: string;
  assignee?: string;
  comments?: StoryComment[];
};

export type StoryComment = {
  id: string;
  content: string;
  created_at: string;
};

export type LapClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | Promise<string>;
  fetch?: FetchLike;
};

export type LapClient = {
  getLap(lapNo: number): Promise<Lap>;
  getStory(storyNo: number): Promise<Story>;
  listStories(lapNo: number): Promise<StorySummary[]>;
};

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function withPath(baseUrl: string, path: string): URL {
  return new URL(path, ensureTrailingSlash(baseUrl));
}

export function createLapClient(options: LapClientOptions): LapClient {
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(path: string): Promise<T> {
    const token = await options.getAccessToken();
    const headers = new Headers();

    headers.set("authorization", `Bearer ${token}`);

    const url = withPath(options.baseUrl, path);
    const response = await fetchImpl(url, { headers });

    if (!response.ok) {
      await mapGatewayErrorResponse(response);
    }

    return (await response.json()) as T;
  }

  return {
    getLap(lapNo) {
      return request<Lap>(`api/laps/${lapNo}`);
    },

    getStory(storyNo) {
      return request<Story>(`api/stories/${storyNo}`);
    },

    listStories(lapNo) {
      return request<StorySummary[]>(`api/laps/${lapNo}/stories`);
    },
  };
}
