import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decrypt, deriveEncryptionKey, encrypt } from "./crypto.js";

export type StoredLink = {
  slackUserId: string;
  mindlapUserId: string;
  email: string;
  accessToken: string;
  role: "admin" | "member";
  exp: number;
  createdAt: number;
};

export type PersistedLink = Omit<StoredLink, "accessToken"> & {
  accessToken: string;
};

export type LinkStore = {
  putLink(link: PersistedLink): void;
  getLink(slackUserId: string): StoredLink | null;
  deleteLink(slackUserId: string): boolean;
  close(): void;
};

export type LinkStoreOptions = {
  dbPath: string;
  encryptionKey: string;
};

type LinkRow = {
  slack_user_id: string;
  mindlap_user_id: string;
  email: string;
  jwt_enc: string;
  role: "admin" | "member";
  exp: number;
  created_at: number;
};

export function createLinkStore(options: LinkStoreOptions): LinkStore {
  const key = deriveEncryptionKey(options.encryptionKey);
  ensureBackingFile(options.dbPath);

  return {
    putLink(link) {
      const state = readState(options.dbPath);
      state[link.slackUserId] = {
        slack_user_id: link.slackUserId,
        mindlap_user_id: link.mindlapUserId,
        email: link.email,
        jwt_enc: encrypt(link.accessToken, key).toString("base64"),
        role: link.role,
        exp: link.exp,
        created_at: link.createdAt,
      };
      writeState(options.dbPath, state);
    },

    getLink(slackUserId) {
      const row = readState(options.dbPath)[slackUserId];
      if (!row) {
        return null;
      }

      return {
        slackUserId: row.slack_user_id,
        mindlapUserId: row.mindlap_user_id,
        email: row.email,
        accessToken: decrypt(Buffer.from(row.jwt_enc, "base64"), key),
        role: row.role,
        exp: row.exp,
        createdAt: row.created_at,
      };
    },

    deleteLink(slackUserId) {
      const state = readState(options.dbPath);
      if (!(slackUserId in state)) {
        return false;
      }

      delete state[slackUserId];
      writeState(options.dbPath, state);
      return true;
    },

    close() {
      // No open handles to release for the file-backed store.
    },
  };
}

type LinkState = Record<string, LinkRow>;

function ensureBackingFile(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });

  if (!existsSync(dbPath)) {
    writeFileSync(dbPath, "{}\n", "utf8");
  }
}

function readState(dbPath: string): LinkState {
  const contents = readFileSync(dbPath, "utf8");
  return JSON.parse(contents) as LinkState;
}

function writeState(dbPath: string, state: LinkState): void {
  writeFileSync(dbPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
