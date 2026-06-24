# LapWire

MindLap Slack ops app for **meta engineers** — monitor, run, and configure client *factories* from Slack.

> **Status:** empty scaffold. No logic yet. See the build spec for what goes where:
> `mindlap/FDE-DOCS/platform/slack-ops-app/slack-ops-app-v0.1-spec.md`.

## Stack (intended)
- TypeScript / Node 20+
- `@slack/bolt` (Socket Mode)
- Talks to the MindLap gateway `/api/meta/*` with each linked admin's JWT
- SQLite for the Slack↔MindLap identity map (JWTs encrypted at rest)

## Layout
```
src/
  index.ts        # Bolt app bootstrap (Socket Mode) — entry point
  metaClient.ts   # wrapper over the generated /api/meta client (injects caller JWT)
  store.ts        # SQLite: identity/link store
  meta/           # generated typed meta client (codegen from meta-openapi.json)
  link/           # F1: /meta link, whoami, unlink
  status/         # F2: /meta fleet, /meta status
  lifecycle/      # F3: start / stop / re-arm / disable-heartbeat
  config/         # F4: /meta config view + edit
  blocks/         # shared Block Kit builders
```

## Getting started
```
cp .env.example .env   # fill in tokens
npm install            # add deps (see spec)
npm run dev
```
