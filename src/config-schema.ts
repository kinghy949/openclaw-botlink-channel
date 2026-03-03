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

export const BotlinkConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).optional(),
    botToken: z.string().trim().min(1),
    apiBaseUrl: z.string().trim().url(),
    pollingTimeoutSec: z.number().int().min(1).max(60).optional(),
    pollingRetryMs: z.number().int().min(500).max(30_000).optional(),
    actions: BotlinkActionSchema.optional(),
  })
  .strict();

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
  actions: BotlinkActionConfig;
};

const DEFAULT_POLLING_TIMEOUT_SEC = 25;
const DEFAULT_POLLING_RETRY_MS = 2_000;

function readChannelRecord(cfg: OpenClawConfig): Record<string, unknown> {
  const channel = (cfg.channels?.botlink as Record<string, unknown> | undefined) ?? {};
  return channel;
}

export function listBotlinkAccountIds(_cfg: OpenClawConfig): string[] {
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultBotlinkAccountId(_cfg: OpenClawConfig): string {
  return DEFAULT_ACCOUNT_ID;
}

export function resolveBotlinkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedBotlinkAccount {
  const channel = readChannelRecord(params.cfg);
  const actionsRaw =
    typeof channel.actions === "object" && channel.actions ? (channel.actions as Record<string, unknown>) : {};
  const botToken = typeof channel.botToken === "string" ? channel.botToken.trim() : "";
  const apiBaseUrlRaw = typeof channel.apiBaseUrl === "string" ? channel.apiBaseUrl.trim() : "";
  const apiBaseUrl = normalizeApiBaseUrl(apiBaseUrlRaw);
  const configured = botToken.length > 0 && apiBaseUrl.length > 0;
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled: channel.enabled !== false,
    configured,
    name: typeof channel.name === "string" ? channel.name.trim() : undefined,
    botToken,
    apiBaseUrl,
    pollingTimeoutSec:
      typeof channel.pollingTimeoutSec === "number" && Number.isFinite(channel.pollingTimeoutSec)
        ? Math.max(1, Math.min(60, Math.trunc(channel.pollingTimeoutSec)))
        : DEFAULT_POLLING_TIMEOUT_SEC,
    pollingRetryMs:
      typeof channel.pollingRetryMs === "number" && Number.isFinite(channel.pollingRetryMs)
        ? Math.max(500, Math.min(30_000, Math.trunc(channel.pollingRetryMs)))
        : DEFAULT_POLLING_RETRY_MS,
    actions: {
      reactions: actionsRaw.reactions !== false,
      editMessage: actionsRaw.editMessage !== false,
      deleteMessage: actionsRaw.deleteMessage !== false,
    },
  };
}
