import type {
  ChannelAccountSnapshot,
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  buildChannelConfigSchema,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
  jsonResult,
  normalizeAccountId,
  readNumberParam,
  readReactionParams,
  readStringParam,
  DEFAULT_ACCOUNT_ID,
} from "openclaw/plugin-sdk";
import { BotlinkApiClient } from "./api-client.js";
import { BotlinkConfigSchema, resolveBotlinkAccount, type ResolvedBotlinkAccount } from "./config-schema.js";
import { monitorBotlinkProvider } from "./monitor.js";

type BotlinkProbe = {
  ok: boolean;
  bot?: {
    id: number;
    username?: string;
  };
  error?: string;
};

const meta = {
  id: "botlink",
  label: "Botlink",
  selectionLabel: "Botlink (Telegram-compatible)",
  docsPath: "/channels/botlink",
  docsLabel: "botlink",
  blurb: "Botlink gateway via Telegram-compatible HTTP API (long polling).",
  aliases: ["botlink-http"],
  order: 86,
};

function createBotlinkClient(account: ResolvedBotlinkAccount): BotlinkApiClient {
  return new BotlinkApiClient({
    botToken: account.botToken,
    apiBaseUrl: account.apiBaseUrl,
  });
}

function readChatId(params: Record<string, unknown>, required = true): string | number | undefined {
  const keys = ["chatId", "channelId", "to"] as const;
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  if (required) {
    throw new Error("botlink action requires chatId/channelId/to.");
  }
  return undefined;
}

function readMessageId(params: Record<string, unknown>): number {
  const explicit = readNumberParam(params, "messageId", { integer: true });
  if (typeof explicit === "number") {
    return explicit;
  }
  const snake = readNumberParam(params, "message_id", { integer: true });
  if (typeof snake === "number") {
    return snake;
  }
  throw new Error("botlink action requires messageId.");
}

function readThreadId(params: Record<string, unknown>): number | undefined {
  const value = readNumberParam(params, "threadId", { integer: true });
  if (typeof value === "number") {
    return value;
  }
  return undefined;
}

const botlinkMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) => {
    const account = resolveBotlinkAccount({ cfg });
    if (!account.enabled || !account.configured) {
      return [];
    }
    const actions = new Set<ChannelMessageActionName>(["send"]);
    if (account.actions.reactions) {
      actions.add("react");
    }
    if (account.actions.editMessage) {
      actions.add("edit");
    }
    if (account.actions.deleteMessage) {
      actions.add("delete");
    }
    return Array.from(actions);
  },
  supportsAction: ({ action }) => action === "send" || action === "react" || action === "edit" || action === "delete",
  handleAction: async ({ action, params, cfg, accountId, mediaLocalRoots, toolContext }) => {
    const account = resolveBotlinkAccount({ cfg, accountId });
    if (!account.enabled) {
      throw new Error("botlink account is disabled.");
    }
    if (!account.configured) {
      throw new Error("botlink account is not configured.");
    }
    const client = createBotlinkClient(account);

    if (action === "send") {
      const chatId = readChatId(params, true);
      const message = readStringParam(params, "message", { allowEmpty: true }) ?? "";
      const text = message || readStringParam(params, "text", { allowEmpty: true }) || "";
      const mediaUrl =
        readStringParam(params, "media", { trim: false }) ??
        readStringParam(params, "mediaUrl", { trim: false });
      if (mediaUrl) {
        const sent = await client.sendMedia({
          chatId: chatId!,
          mediaUrl,
          caption: text || undefined,
          replyToMessageId: readNumberParam(params, "replyTo", { integer: true }) ?? undefined,
          messageThreadId: readThreadId(params),
          disableNotification: typeof params.silent === "boolean" ? params.silent : undefined,
          mediaLocalRoots,
        });
        return jsonResult({
          ok: true,
          messageId: String(sent.message_id),
          chatId: sent.chat.id,
        });
      }
      if (!text.trim()) {
        throw new Error("botlink send requires message/text when media is not provided.");
      }
      const sent = await client.sendMessage({
        chatId: chatId!,
        text,
        replyToMessageId: readNumberParam(params, "replyTo", { integer: true }) ?? undefined,
        messageThreadId: readThreadId(params),
        disableNotification: typeof params.silent === "boolean" ? params.silent : undefined,
      });
      return jsonResult({
        ok: true,
        messageId: String(sent.message_id),
        chatId: sent.chat.id,
      });
    }

    if (action === "edit") {
      if (!account.actions.editMessage) {
        throw new Error("botlink edit is disabled by channels.botlink.actions.editMessage.");
      }
      const chatId = readChatId(params, true)!;
      const messageId = readMessageId(params);
      const text =
        readStringParam(params, "text", { allowEmpty: false }) ??
        readStringParam(params, "message", { allowEmpty: false });
      if (!text) {
        throw new Error("botlink edit requires text/message.");
      }
      await client.editMessageText({
        chatId,
        messageId,
        text,
      });
      return jsonResult({ ok: true, edited: messageId });
    }

    if (action === "delete") {
      if (!account.actions.deleteMessage) {
        throw new Error("botlink delete is disabled by channels.botlink.actions.deleteMessage.");
      }
      const chatId = readChatId(params, true)!;
      const messageId = readMessageId(params);
      await client.deleteMessage({
        chatId,
        messageId,
      });
      return jsonResult({ ok: true, deleted: messageId });
    }

    if (action === "react") {
      if (!account.actions.reactions) {
        throw new Error("botlink reactions are disabled by channels.botlink.actions.reactions.");
      }
      const chatId = readChatId(params, true)!;
      const messageId =
        readNumberParam(params, "messageId", { integer: true }) ??
        readNumberParam(params, "message_id", { integer: true }) ??
        (typeof toolContext?.currentMessageId === "number" ? toolContext.currentMessageId : undefined);
      if (typeof messageId !== "number") {
        throw new Error("botlink react requires messageId.");
      }
      const { emoji, remove } = readReactionParams(params, {
        removeErrorMessage: "Emoji is required to remove a botlink reaction.",
      });
      await client.setMessageReaction({
        chatId,
        messageId,
        emoji: emoji || undefined,
        remove,
      });
      return jsonResult({
        ok: true,
        messageId,
        reacted: remove ? null : emoji || null,
        removed: remove === true,
      });
    }

    throw new Error(`Action ${action} is not supported for botlink.`);
  },
};

export const botlinkPlugin: ChannelPlugin<ResolvedBotlinkAccount, BotlinkProbe> = {
  id: "botlink",
  meta,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: true,
    edit: true,
    unsend: true,
    reply: true,
  },
  reload: { configPrefixes: ["channels.botlink"] },
  configSchema: buildChannelConfigSchema(BotlinkConfigSchema),
  config: {
    listAccountIds: (cfg) => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveBotlinkAccount({ cfg, accountId }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => account.configured,
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      baseUrl: account.apiBaseUrl || undefined,
    }),
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, name }) => {
      if (!name?.trim()) {
        return cfg;
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          botlink: {
            ...(cfg.channels?.botlink ?? {}),
            name: name.trim(),
          },
        },
      } as OpenClawConfig;
    },
    validateInput: ({ cfg, accountId, input }) => {
      if (accountId !== DEFAULT_ACCOUNT_ID) {
        return "Botlink currently supports only the default account.";
      }
      const account = resolveBotlinkAccount({ cfg, accountId });
      const token = input.token?.trim() || account.botToken;
      if (!token) {
        return "Botlink requires --token <botToken>.";
      }
      const apiBaseUrl = input.httpUrl?.trim() || account.apiBaseUrl;
      if (!apiBaseUrl) {
        return "Botlink requires --http-url <apiBaseUrl>.";
      }
      try {
        const parsed = new URL(apiBaseUrl);
        if (!parsed.protocol || !parsed.hostname) {
          return "Botlink --http-url must be a valid absolute URL.";
        }
      } catch {
        return "Botlink --http-url must be a valid absolute URL.";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, input }) => {
      const account = resolveBotlinkAccount({ cfg });
      const nextBotToken = input.token?.trim() || account.botToken;
      const nextApiBaseUrl = input.httpUrl?.trim() || account.apiBaseUrl;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          botlink: {
            ...(cfg.channels?.botlink ?? {}),
            enabled: true,
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            botToken: nextBotToken,
            apiBaseUrl: nextApiBaseUrl,
          },
        },
      } as OpenClawConfig;
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 3500,
    sendText: async ({ cfg, accountId, to, text, replyToId, threadId, silent }) => {
      try {
        const account = resolveBotlinkAccount({ cfg, accountId });
        const client = createBotlinkClient(account);
        const sent = await client.sendMessage({
          chatId: to,
          text,
          replyToMessageId:
            typeof replyToId === "string" && /^-?\d+$/.test(replyToId.trim())
              ? Number(replyToId)
              : undefined,
          messageThreadId: typeof threadId === "number" ? threadId : undefined,
          disableNotification: silent,
        });
        return {
          channel: "botlink",
          ok: true,
          messageId: String(sent.message_id),
        };
      } catch (error) {
        return {
          channel: "botlink",
          ok: false,
          messageId: "",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
    sendMedia: async ({ cfg, accountId, to, text, mediaUrl, mediaLocalRoots, replyToId, threadId, silent }) => {
      try {
        const account = resolveBotlinkAccount({ cfg, accountId });
        const client = createBotlinkClient(account);
        if (!mediaUrl) {
          throw new Error("botlink media send requires mediaUrl.");
        }
        const sent = await client.sendMedia({
          chatId: to,
          mediaUrl,
          caption: text || undefined,
          replyToMessageId:
            typeof replyToId === "string" && /^-?\d+$/.test(replyToId.trim())
              ? Number(replyToId)
              : undefined,
          messageThreadId: typeof threadId === "number" ? threadId : undefined,
          disableNotification: silent,
          mediaLocalRoots,
        });
        return {
          channel: "botlink",
          ok: true,
          messageId: String(sent.message_id),
        };
      } catch (error) {
        return {
          channel: "botlink",
          ok: false,
          messageId: "",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
    sendPayload: async (ctx) => {
      const text = ctx.payload.text ?? "";
      const mediaUrls = ctx.payload.mediaUrls?.length
        ? ctx.payload.mediaUrls
        : ctx.payload.mediaUrl
          ? [ctx.payload.mediaUrl]
          : [];
      if (mediaUrls.length === 0) {
        return await botlinkPlugin.outbound!.sendText!(ctx);
      }

      let last:
        | Awaited<ReturnType<NonNullable<typeof botlinkPlugin.outbound>["sendMedia"]>>
        | undefined;
      for (let i = 0; i < mediaUrls.length; i += 1) {
        last = await botlinkPlugin.outbound!.sendMedia!({
          ...ctx,
          mediaUrl: mediaUrls[i],
          text: i === 0 ? text : "",
        });
      }
      return (
        last ?? {
          channel: "botlink",
          ok: true,
          messageId: "",
        }
      );
    },
  },
  actions: botlinkMessageActions,
  messaging: {
    normalizeTarget: (raw) => {
      const trimmed = raw?.trim();
      if (!trimmed) {
        return undefined;
      }
      return trimmed.replace(/^botlink:/i, "");
    },
    targetResolver: {
      looksLikeId: (raw) => /^-?\d+$/.test(raw.trim()),
      hint: "<chatId>",
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    buildChannelSummary: ({ snapshot }) =>
      buildProbeChannelStatusSummary(snapshot, {
        baseUrl: snapshot.baseUrl ?? null,
      }),
    probeAccount: async ({ account, timeoutMs }) => {
      if (!account.configured) {
        return { ok: false, error: "botToken/apiBaseUrl not configured" };
      }
      try {
        const client = createBotlinkClient(account);
        const me = await client.getMe(timeoutMs);
        return {
          ok: true,
          bot: {
            id: me.id,
            username: me.username,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const probeResult = probe as BotlinkProbe | undefined;
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        connected: probeResult?.ok,
        running: runtime?.running ?? false,
        baseUrl: account.apiBaseUrl || undefined,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? (probeResult?.ok === false ? probeResult.error : null),
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        probe,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
        baseUrl: account.apiBaseUrl || undefined,
      });

      if (!account.configured) {
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          lastError: "botToken/apiBaseUrl not configured",
        });
        return;
      }

      ctx.log?.info(`[${account.accountId}] starting botlink long polling`);
      return await monitorBotlinkProvider({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
    stopAccount: async (ctx) => {
      ctx.setStatus({
        accountId: ctx.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};
