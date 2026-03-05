import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { z } from "zod";
import { normalizeApiBaseUrl } from "./api-client.js";

const BotlinkActionSchema = z
  .object({
    reactions: z.boolean().optional(),
    editMessage: z.boolean().optional(),
    deleteMessage: z.boolean().optional(),
  })
  .strict();

const BotlinkAccountSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).optional(),
    botToken: z.string().trim().min(1).optional(),
    apiBaseUrl: z.string().trim().url().optional(),
    pollingTimeoutSec: z.number().int().min(1).max(60).optional(),
    pollingRetryMs: z.number().int().min(500).max(30_000).optional(),
    // In group chats, only process messages that @mention this bot account.
    groupRequireMention: z.boolean().optional(),
    actions: BotlinkActionSchema.optional(),
  })
  .strict();

export const BotlinkConfigSchema = BotlinkAccountSchema.extend({
  accounts: z.record(z.string(), BotlinkAccountSchema.optional()).optional(),
  defaultAccount: z.string().trim().min(1).optional(),
});

export type BotlinkActionConfig = {
  reactions: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
};

export type ResolvedBotlinkAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  botToken: string;
  apiBaseUrl: string;
  pollingTimeoutSec: number;
  pollingRetryMs: number;
  groupRequireMention: boolean;
  actions: BotlinkActionConfig;
};

const DEFAULT_POLLING_TIMEOUT_SEC = 25;
const DEFAULT_POLLING_RETRY_MS = 2_000;

function normalizeBotlinkAccountId(raw?: string | null): string {
  const normalized = String(raw ?? "").trim().toLowerCase();
  return normalized || DEFAULT_ACCOUNT_ID;
}

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readChannelRecord(cfg: OpenClawConfig): Record<string, unknown> {
  const channel = (cfg.channels?.botlink as Record<string, unknown> | undefined) ?? {};
  return channel;
}

function readAccountsRecord(channel: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const accounts = asObjectRecord(channel.accounts);
  if (!accounts) {
    return {};
  }
  const output: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(accounts)) {
    const entry = asObjectRecord(value);
    if (entry) {
      output[key] = entry;
    }
  }
  return output;
}

function resolveAccountEntry(
  accounts: Record<string, Record<string, unknown>>,
  accountId: string,
): Record<string, unknown> | undefined {
  if (accounts[accountId]) {
    return accounts[accountId];
  }
  const matchKey = Object.keys(accounts).find((key) => normalizeBotlinkAccountId(key) === accountId);
  return matchKey ? accounts[matchKey] : undefined;
}

function hasBaseAccountConfig(channel: Record<string, unknown>): boolean {
  const keys: Array<keyof typeof channel> = [
    "enabled",
    "name",
    "botToken",
    "apiBaseUrl",
    "pollingTimeoutSec",
    "pollingRetryMs",
    "groupRequireMention",
    "actions",
  ];
  return keys.some((key) => typeof channel[key] !== "undefined");
}

export function listBotlinkAccountIds(cfg: OpenClawConfig): string[] {
  const channel = readChannelRecord(cfg);
  const accounts = readAccountsRecord(channel);

  const ids = new Set<string>();
  for (const key of Object.keys(accounts)) {
    ids.add(normalizeBotlinkAccountId(key));
  }

  if (hasBaseAccountConfig(channel) || ids.size === 0) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  const rest = [...ids].filter((id) => id !== DEFAULT_ACCOUNT_ID).sort();
  return ids.has(DEFAULT_ACCOUNT_ID) ? [DEFAULT_ACCOUNT_ID, ...rest] : rest;
}

export function resolveDefaultBotlinkAccountId(cfg: OpenClawConfig): string {
  const ids = listBotlinkAccountIds(cfg);
  const channel = readChannelRecord(cfg);
  const configured =
    typeof channel.defaultAccount === "string" ? normalizeBotlinkAccountId(channel.defaultAccount) : undefined;

  if (configured && ids.includes(configured)) {
    return configured;
  }
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveBotlinkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedBotlinkAccount {
  const channel = readChannelRecord(params.cfg);
  const accounts = readAccountsRecord(channel);

  const requested = normalizeBotlinkAccountId(params.accountId ?? resolveDefaultBotlinkAccountId(params.cfg));
  const entry = resolveAccountEntry(accounts, requested) ?? {};

  const baseActions = asObjectRecord(channel.actions) ?? {};
  const entryActions = asObjectRecord(entry.actions) ?? {};

  const botToken =
    typeof entry.botToken === "string" && entry.botToken.trim().length > 0
      ? entry.botToken.trim()
      : typeof channel.botToken === "string"
        ? channel.botToken.trim()
        : "";
  const apiBaseUrlRaw =
    typeof entry.apiBaseUrl === "string" && entry.apiBaseUrl.trim().length > 0
      ? entry.apiBaseUrl.trim()
      : typeof channel.apiBaseUrl === "string"
        ? channel.apiBaseUrl.trim()
        : "";
  const apiBaseUrl = normalizeApiBaseUrl(apiBaseUrlRaw);

  const accountCount = listBotlinkAccountIds(params.cfg).length;
  const groupRequireMentionRaw =
    typeof entry.groupRequireMention === "boolean"
      ? entry.groupRequireMention
      : typeof channel.groupRequireMention === "boolean"
        ? channel.groupRequireMention
        : undefined;

  return {
    accountId: requested,
    enabled:
      typeof entry.enabled === "boolean"
        ? entry.enabled
        : typeof channel.enabled === "boolean"
          ? channel.enabled
          : true,
    configured: botToken.length > 0 && apiBaseUrl.length > 0,
    name:
      typeof entry.name === "string" && entry.name.trim().length > 0
        ? entry.name.trim()
        : typeof channel.name === "string"
          ? channel.name.trim()
          : undefined,
    botToken,
    apiBaseUrl,
    pollingTimeoutSec:
      typeof entry.pollingTimeoutSec === "number" && Number.isFinite(entry.pollingTimeoutSec)
        ? Math.max(1, Math.min(60, Math.trunc(entry.pollingTimeoutSec)))
        : typeof channel.pollingTimeoutSec === "number" && Number.isFinite(channel.pollingTimeoutSec)
          ? Math.max(1, Math.min(60, Math.trunc(channel.pollingTimeoutSec)))
          : DEFAULT_POLLING_TIMEOUT_SEC,
    pollingRetryMs:
      typeof entry.pollingRetryMs === "number" && Number.isFinite(entry.pollingRetryMs)
        ? Math.max(500, Math.min(30_000, Math.trunc(entry.pollingRetryMs)))
        : typeof channel.pollingRetryMs === "number" && Number.isFinite(channel.pollingRetryMs)
          ? Math.max(500, Math.min(30_000, Math.trunc(channel.pollingRetryMs)))
          : DEFAULT_POLLING_RETRY_MS,
    groupRequireMention:
      typeof groupRequireMentionRaw === "boolean" ? groupRequireMentionRaw : accountCount > 1,
    actions: {
      reactions:
        typeof entryActions.reactions === "boolean"
          ? entryActions.reactions
          : baseActions.reactions !== false,
      editMessage:
        typeof entryActions.editMessage === "boolean"
          ? entryActions.editMessage
          : baseActions.editMessage !== false,
      deleteMessage:
        typeof entryActions.deleteMessage === "boolean"
          ? entryActions.deleteMessage
          : baseActions.deleteMessage !== false,
    },
  };
}
