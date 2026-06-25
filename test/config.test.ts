import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/lapwire.js";

const VALID_ENV: Record<string, string> = {
  SLACK_BOT_TOKEN: "xoxb-test-token",
  SLACK_APP_TOKEN: "xapp-test-token",
  SLACK_SIGNING_SECRET: "test-signing-secret",
  MINDLAP_API_BASE: "https://app.mindlap.ai",
  MINDLAP_ORG: "test-org",
  ENCRYPTION_KEY: "test-encryption-key",
};

describe("loadConfig", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const key of [...Object.keys(VALID_ENV), "DB_PATH"]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of [...Object.keys(VALID_ENV), "DB_PATH"]) {
      delete process.env[key];
    }
  });

  it("returns fully-typed config when all required vars are present", () => {
    Object.assign(process.env, VALID_ENV);

    const config = loadConfig();

    expect(config).toEqual({
      slackBotToken: "xoxb-test-token",
      slackAppToken: "xapp-test-token",
      slackSigningSecret: "test-signing-secret",
      mindlapApiBase: "https://app.mindlap.ai",
      mindlapOrg: "test-org",
      encryptionKey: "test-encryption-key",
      dbPath: "data/links.json",
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("uses DB_PATH override when provided", () => {
    Object.assign(process.env, VALID_ENV);
    process.env["DB_PATH"] = "custom/store.json";

    const config = loadConfig();

    expect(config.dbPath).toBe("custom/store.json");
  });

  it("calls process.exit(1) and logs the missing var when one required var is absent", () => {
    Object.assign(process.env, VALID_ENV);
    delete process.env["SLACK_BOT_TOKEN"];

    expect(() => loadConfig()).toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const message: string = (errorSpy.mock.calls[0] as [string])[0];
    expect(message).toContain("LapWire startup failed");
    expect(message).toContain("SLACK_BOT_TOKEN");
  });

  it("lists all missing vars in a single message when multiple are absent", () => {
    Object.assign(process.env, VALID_ENV);
    delete process.env["SLACK_BOT_TOKEN"];
    delete process.env["MINDLAP_API_BASE"];
    delete process.env["ENCRYPTION_KEY"];

    expect(() => loadConfig()).toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message: string = (errorSpy.mock.calls[0] as [string])[0];
    expect(message).toContain("SLACK_BOT_TOKEN");
    expect(message).toContain("MINDLAP_API_BASE");
    expect(message).toContain("ENCRYPTION_KEY");
  });

  it("calls process.exit(1) when MINDLAP_API_BASE is not a valid URL", () => {
    Object.assign(process.env, VALID_ENV);
    process.env["MINDLAP_API_BASE"] = "not-a-url";

    expect(() => loadConfig()).toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const message: string = (errorSpy.mock.calls[0] as [string])[0];
    expect(message).toContain("MINDLAP_API_BASE");
  });
});
