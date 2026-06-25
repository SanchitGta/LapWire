export type GatewayErrorCode =
  | "unauthorized"
  | "invalid_token"
  | "admin_required"
  | "not_found"
  | (string & {});

export type GatewayErrorEnvelope = {
  ok: false;
  error: {
    code: GatewayErrorCode;
    message: string;
  };
};

type GatewayErrorInit = {
  code: GatewayErrorCode;
  message: string;
  status: number;
};

export class GatewayApiError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;

  constructor({ code, message, status }: GatewayErrorInit) {
    super(message);
    this.name = "GatewayApiError";
    this.code = code;
    this.status = status;
  }
}

export class UnauthorizedError extends GatewayApiError {
  constructor(init: Omit<GatewayErrorInit, "code">) {
    super({ ...init, code: "unauthorized" });
    this.name = "UnauthorizedError";
  }
}

export class InvalidTokenError extends GatewayApiError {
  constructor(init: Omit<GatewayErrorInit, "code">) {
    super({ ...init, code: "invalid_token" });
    this.name = "InvalidTokenError";
  }
}

export class AdminRequiredError extends GatewayApiError {
  constructor(init: Omit<GatewayErrorInit, "code">) {
    super({ ...init, code: "admin_required" });
    this.name = "AdminRequiredError";
  }
}

export class NotFoundError extends GatewayApiError {
  constructor(init: Omit<GatewayErrorInit, "code">) {
    super({ ...init, code: "not_found" });
    this.name = "NotFoundError";
  }
}

export function isGatewayErrorEnvelope(value: unknown): value is GatewayErrorEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const error = candidate.error;

  if (candidate.ok !== false || !error || typeof error !== "object") {
    return false;
  }

  const typedError = error as Record<string, unknown>;
  return typeof typedError.code === "string" && typeof typedError.message === "string";
}

export async function mapGatewayErrorResponse(response: Response): Promise<never> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!isGatewayErrorEnvelope(payload)) {
    throw new GatewayApiError({
      code: "unauthorized",
      message: `MindLap gateway request failed with ${response.status}`,
      status: response.status,
    });
  }

  const init = {
    message: payload.error.message,
    status: response.status,
  };

  switch (payload.error.code) {
    case "unauthorized":
      throw new UnauthorizedError(init);
    case "invalid_token":
      throw new InvalidTokenError(init);
    case "admin_required":
      throw new AdminRequiredError(init);
    case "not_found":
      throw new NotFoundError(init);
    default:
      throw new GatewayApiError({
        code: payload.error.code,
        message: payload.error.message,
        status: response.status,
      });
  }
}
