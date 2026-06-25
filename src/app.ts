import { App } from "@slack/bolt";

export function createApp(): App {
  return new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
  });
}
