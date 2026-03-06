import type { OpenClawConfig, ReplyPayload } from "openclaw/plugin-sdk";
import {
  buildAgentMediaPayload,
  createReplyPrefixOptions,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  resolveOutboundMediaUrls,
  sendMediaWithLeadingCaption,
} from "openclaw/plugin-sdk";
import type { ResolvedBotlinkAccount } from "./config-schema.js";
import type { TelegramMessage, TelegramUpdate } from "./api-client.js";
import { BotlinkApiClient } from "./api-client.js";
import { isMessageTargetingBot } from "./mentions.js";
import { getBotlinkRuntime } from "./runtime.js";

export type BotlinkRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type BotlinkMonitorOptions = {
  account: ResolvedBotlinkAccount;
  config: OpenClawConfig;
  runtime: BotlinkRuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type BotlinkMonitorResult = {
  stop: () => void;
};

const BOTLINK_TEXT_LIMIT = 3500;
const BOTLINK_MAX_INBOUND_MEDIA_BYTES = 25 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickInboundMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post ?? null;
}

function resolveSenderName(message: TelegramMessage): string {
  const first = message.from?.first_name?.trim();
  const last = message.from?.last_name?.trim();
  const username = message.from?.username?.trim();
  const name = [first, last].filter(Boolean).join(" ").trim();
  if (name) {
    return name;
  }
  if (username) {
    return `@${username}`;
  }
  return `user:${String(message.from?.id ?? message.chat.id)}`;
}

function extractInboundMediaRefs(message: TelegramMessage): Array<{ fileId: string; label: string }> {
  const refs: Array<{ fileId: string; label: string }> = [];
  const photos = Array.isArray(message.photo) ? message.photo : [];
  const largestPhoto = photos.length > 0 ? photos[photos.length - 1] : undefined;
  if (largestPhoto?.file_id) {
    refs.push({ fileId: largestPhoto.file_id, label: "photo" });
  }
  if (message.document?.file_id) {
    refs.push({ fileId: message.document.file_id, label: "document" });
  }
  if (message.video?.file_id) {
    refs.push({ fileId: message.video.file_id, label: "video" });
  }
  if (message.audio?.file_id) {
    refs.push({ fileId: message.audio.file_id, label: "audio" });
  }
  if (message.voice?.file_id) {
    refs.push({ fileId: message.voice.file_id, label: "voice" });
  }
  if (message.animation?.file_id) {
    refs.push({ fileId: message.animation.file_id, label: "animation" });
  }
  if (message.sticker?.file_id) {
    refs.push({ fileId: message.sticker.file_id, label: "sticker" });
  }
  return refs;
}

async function stageInboundMedia(params: {
  message: TelegramMessage;
  client: BotlinkApiClient;
  runtime: BotlinkRuntimeEnv;
  accountId: string;
}) {
  const core = getBotlinkRuntime();
  const mediaRefs = extractInboundMediaRefs(params.message);
  if (mediaRefs.length === 0) {
    return [];
  }

  const staged: Array<{ path: string; contentType?: string | null }> = [];
  for (const mediaRef of mediaRefs) {
    try {
      const file = await params.client.getFile(mediaRef.fileId, 10_000);
      if (!file.file_path) {
        continue;
      }
      const fileUrl = params.client.buildFileUrl(file.file_path);
      const fetched = await core.channel.media.fetchRemoteMedia({
        url: fileUrl,
        maxBytes: BOTLINK_MAX_INBOUND_MEDIA_BYTES,
      });
      const saved = await core.channel.media.saveMediaBuffer(
        fetched.buffer,
        fetched.contentType,
        "inbound",
        BOTLINK_MAX_INBOUND_MEDIA_BYTES,
      );
      staged.push({ path: saved.path, contentType: saved.contentType });
    } catch (error) {
      params.runtime.error?.(
        `[${params.accountId}] botlink failed to stage ${mediaRef.label}: ${String(error)}`,
      );
    }
  }
  return staged;
}

function resolveInboundBody(message: TelegramMessage): string {
  const text = message.text?.trim();
  if (text) {
    return text;
  }
  const caption = message.caption?.trim();
  if (caption) {
    return caption;
  }
  const mediaRefs = extractInboundMediaRefs(message);
  if (mediaRefs.length > 0) {
    return mediaRefs.map((item) => `<media:${item.label}>`).join(" ");
  }
  return "";
}

async function deliverBotlinkReply(params: {
  payload: ReplyPayload;
  client: BotlinkApiClient;
  account: ResolvedBotlinkAccount;
  config: OpenClawConfig;
  runtime: BotlinkRuntimeEnv;
  chatId: string | number;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const core = getBotlinkRuntime();
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: params.config,
    channel: "botlink",
    accountId: params.account.accountId,
  });
  const text = core.channel.text.convertMarkdownTables(params.payload.text ?? "", tableMode);

  const sentMedia = await sendMediaWithLeadingCaption({
    mediaUrls: resolveOutboundMediaUrls(params.payload),
    caption: text,
    send: async ({ mediaUrl, caption }) => {
      await params.client.sendMedia({
        chatId: params.chatId,
        mediaUrl,
        caption: caption || undefined,
      });
      params.statusSink?.({ lastOutboundAt: Date.now() });
    },
    onError: (error) => {
      params.runtime.error?.(
        `[${params.account.accountId}] botlink media reply failed: ${String(error)}`,
      );
    },
  });
  if (sentMedia) {
    return;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const chunkMode = core.channel.text.resolveChunkMode(
    params.config,
    "botlink",
    params.account.accountId,
  );
  const chunks = core.channel.text.chunkMarkdownTextWithMode(trimmed, BOTLINK_TEXT_LIMIT, chunkMode);
  for (const chunk of chunks) {
    await params.client.sendMessage({
      chatId: params.chatId,
      text: chunk,
    });
    params.statusSink?.({ lastOutboundAt: Date.now() });
  }
}

async function processIncomingMessage(params: {
  message: TelegramMessage;
  client: BotlinkApiClient;
  account: ResolvedBotlinkAccount;
  config: OpenClawConfig;
  runtime: BotlinkRuntimeEnv;
  botUsername?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}) {
  const { message, client, account, config, runtime, botUsername, statusSink } = params;
  const rawBody = resolveInboundBody(message);
  if (!rawBody) {
    return;
  }

  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  if (isGroup && account.groupRequireMention && !isMessageTargetingBot(message, botUsername)) {
    return;
  }

  const chatId = message.chat.id;
  const senderId = String(message.from?.id ?? chatId);
  const senderName = resolveSenderName(message);
  const routePeerId = isGroup ? String(chatId) : senderId;

  const core = getBotlinkRuntime();
  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg: config,
    channel: "botlink",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: routePeerId,
    },
    runtime: core.channel,
    sessionStore: config.session?.store,
  });

  const fromLabel = isGroup
    ? message.chat.title?.trim() || `group:${String(chatId)}`
    : senderName || `user:${senderId}`;
  const timestamp = typeof message.date === "number" ? message.date * 1000 : Date.now();
  const { storePath, body } = buildEnvelope({
    channel: "Botlink",
    from: fromLabel,
    timestamp,
    body: rawBody,
  });

  const mediaList = await stageInboundMedia({
    message,
    client,
    runtime,
    accountId: account.accountId,
  });
  const mediaPayload = buildAgentMediaPayload(mediaList);

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? `botlink:chat:${String(chatId)}` : `botlink:user:${senderId}`,
    To: `botlink:${String(chatId)}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName,
    SenderId: senderId,
    MessageSid: String(message.message_id),
    Timestamp: timestamp,
    Provider: "botlink",
    Surface: "botlink",
    OriginatingChannel: "botlink",
    OriginatingTo: `botlink:${String(chatId)}`,
    ...mediaPayload,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (error) => {
      runtime.error?.(`[${account.accountId}] botlink session record failed: ${String(error)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "botlink",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        await deliverBotlinkReply({
          payload,
          client,
          account,
          config,
          runtime,
          chatId,
          statusSink,
        });
      },
      onError: (error, info) => {
        runtime.error?.(`[${account.accountId}] botlink ${info.kind} reply failed: ${String(error)}`);
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}

async function processUpdate(params: {
  update: TelegramUpdate;
  client: BotlinkApiClient;
  account: ResolvedBotlinkAccount;
  config: OpenClawConfig;
  runtime: BotlinkRuntimeEnv;
  botUsername?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}) {
  const message = pickInboundMessage(params.update);
  if (!message) {
    return;
  }
  params.statusSink?.({ lastInboundAt: Date.now() });
  await processIncomingMessage({
    message,
    client: params.client,
    account: params.account,
    config: params.config,
    runtime: params.runtime,
    botUsername: params.botUsername,
    statusSink: params.statusSink,
  });
}

export async function monitorBotlinkProvider(options: BotlinkMonitorOptions): Promise<BotlinkMonitorResult> {
  const client = new BotlinkApiClient({
    botToken: options.account.botToken,
    apiBaseUrl: options.account.apiBaseUrl,
  });

  let stopped = false;
  let offset = 0;
  let botUsername: string | undefined;

  try {
    const me = await client.getMe(10_000);
    botUsername = me.username?.trim().toLowerCase();
  } catch (error) {
    options.runtime.error?.(
      `[${options.account.accountId}] botlink failed to load bot identity: ${String(error)}`,
    );
  }

  const stop = () => {
    stopped = true;
  };

  options.abortSignal.addEventListener("abort", stop, { once: true });
  const waitForAbort = new Promise<void>((resolve) => {
    if (options.abortSignal.aborted) {
      resolve();
      return;
    }
    options.abortSignal.addEventListener("abort", () => resolve(), { once: true });
  });

  const poll = async () => {
    while (!stopped && !options.abortSignal.aborted) {
      try {
        const updates = await client.getUpdates({
          offset,
          timeoutSec: options.account.pollingTimeoutSec,
          allowedUpdates: [
            "message",
            "edited_message",
            "channel_post",
            "edited_channel_post",
          ],
        });
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          await processUpdate({
            update,
            client,
            account: options.account,
            config: options.config,
            runtime: options.runtime,
            botUsername,
            statusSink: options.statusSink,
          });
        }
      } catch (error) {
        if (stopped || options.abortSignal.aborted) {
          break;
        }
        options.runtime.error?.(
          `[${options.account.accountId}] botlink polling failed: ${String(error)}`,
        );
        await sleep(options.account.pollingRetryMs);
      }
    }
  };

  void poll();
  await waitForAbort;
  stop();
  return { stop };
}
