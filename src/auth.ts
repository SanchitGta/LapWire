export type SendOtpRequest = {
  email: string;
};

export type SendOtpResponse = {
  ok: true;
};

export type VerifyOtpRequest = {
  email: string;
  otp: string;
};

export type VerifyOtpResponse = {
  access_token: string;
};

export type AuthUser = {
  id: string;
  email: string;
  role: "admin" | "member";
};

type FetchLike = typeof fetch;

export type AuthClientOptions = {
  apiBase: string;
  fetch?: FetchLike;
};

export type AuthClient = {
  sendOtp(input: SendOtpRequest): Promise<SendOtpResponse>;
  verifyOtp(input: VerifyOtpRequest): Promise<VerifyOtpResponse>;
  getMe(accessToken: string): Promise<AuthUser>;
};

function withPath(baseUrl: string, path: string): URL {
  return new URL(path, ensureTrailingSlash(baseUrl));
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
    ) {
      throw new Error(payload.error.message);
    }

    throw new Error(`MindLap auth request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const fetchImpl = options.fetch ?? fetch;

  return {
    async sendOtp(input) {
      const response = await fetchImpl(withPath(options.apiBase, "api/auth/send-otp"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });

      return readJson<SendOtpResponse>(response);
    },

    async verifyOtp(input) {
      const response = await fetchImpl(withPath(options.apiBase, "api/auth/verify-otp"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });

      return readJson<VerifyOtpResponse>(response);
    },

    async getMe(accessToken) {
      const response = await fetchImpl(withPath(options.apiBase, "api/auth/me"), {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      return readJson<AuthUser>(response);
    },
  };
}
