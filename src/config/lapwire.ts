export type LapWireConfig = {
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  mindlapApiBase: string;
  mindlapOrg: string;
  encryptionKey: string;
  dbPath: string;
};

export function loadConfig(): LapWireConfig {
  const missing: string[] = [];

  const required = [
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "SLACK_SIGNING_SECRET",
    "MINDLAP_API_BASE",
    "MINDLAP_ORG",
    "ENCRYPTION_KEY",
  ] as const;

  for (const name of required) {
    if (!process.env[name]) {
      missing.push(name);
    }
  }

  const apiBase = process.env["MINDLAP_API_BASE"];
  if (apiBase) {
    try {
      new URL(apiBase);
    } catch {
      missing.push("MINDLAP_API_BASE");
    }
  }

  if (missing.length > 0) {
    console.error(
      `LapWire startup failed. Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join("\n")}`,
    );
    process.exit(1);
  }

  return {
    slackBotToken: process.env["SLACK_BOT_TOKEN"]!,
    slackAppToken: process.env["SLACK_APP_TOKEN"]!,
    slackSigningSecret: process.env["SLACK_SIGNING_SECRET"]!,
    mindlapApiBase: process.env["MINDLAP_API_BASE"]!,
    mindlapOrg: process.env["MINDLAP_ORG"]!,
    encryptionKey: process.env["ENCRYPTION_KEY"]!,
    dbPath: process.env["DB_PATH"] ?? "data/links.json",
  };
}
