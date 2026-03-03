import { loadOutboundMediaFromUrl } from "openclaw/plugin-sdk";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export type TelegramChat = {
  id: number | string;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramUser = {
  id: number | string;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  width?: number;
  height?: number;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  photo?: TelegramPhotoSize[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
  video?: { file_id: string; file_name?: string; mime_type?: string };
  audio?: { file_id: string; file_name?: string; mime_type?: string };
  voice?: { file_id: string; file_name?: string; mime_type?: string };
  animation?: { file_id: string; file_name?: string; mime_type?: string };
  sticker?: { file_id: string; emoji?: string };
  reply_to_message?: { message_id?: number };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

export type TelegramGetMe = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramGetFile = {
  file_id: string;
  file_unique_id?: string;
  file_path?: string;
  file_size?: number;
};

export function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/g, "");
}

function buildTimeoutSignal(timeoutMs?: number): { signal?: AbortSignal; cancel: () => void } {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: undefined, cancel: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function parseTelegramChatId(value: string | number): string | number {
  if (typeof value === "number") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("chatId is required.");
  }
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && /^-?\d+$/.test(trimmed)) {
    return asNumber;
  }
  return trimmed;
}

function guessUploadMethod(mediaUrl: string, mimeType?: string): "sendPhoto" | "sendDocument" {
  const lower = mediaUrl.toLowerCase();
  if (mimeType?.startsWith("image/")) {
    return "sendPhoto";
  }
  if (/\.(png|jpg|jpeg|gif|webp)(\?|$)/.test(lower)) {
    return "sendPhoto";
  }
  return "sendDocument";
}

export class BotlinkApiClient {
  private readonly botToken: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(params: { botToken: string; apiBaseUrl: string; fetchImpl?: FetchLike }) {
    this.botToken = params.botToken.trim();
    this.apiBaseUrl = normalizeApiBaseUrl(params.apiBaseUrl);
    this.fetchImpl = params.fetchImpl ?? fetch;
    if (!this.botToken) {
      throw new Error("Botlink botToken is required.");
    }
    if (!this.apiBaseUrl) {
      throw new Error("Botlink apiBaseUrl is required.");
    }
  }

  buildMethodUrl(method: string): string {
    return `${this.apiBaseUrl}/bot${this.botToken}/${method}`;
  }

  buildFileUrl(filePath: string): string {
    return `${this.apiBaseUrl}/file/bot${this.botToken}/${filePath.replace(/^\/+/, "")}`;
  }

  private async decodeEnvelope<T>(response: Response, method: string): Promise<T> {
    if (!response.ok) {
      throw new Error(`Botlink API ${method} failed with HTTP ${response.status}.`);
    }
    const envelope = (await response.json()) as TelegramApiEnvelope<T>;
    if (!envelope.ok || typeof envelope.result === "undefined") {
      throw new Error(
        `Botlink API ${method} failed: ${envelope.description ?? `error ${envelope.error_code ?? "unknown"}`}`,
      );
    }
    return envelope.result;
  }

  async call<T>(
    method: string,
    payload: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    const { signal, cancel } = buildTimeoutSignal(timeoutMs);
    try {
      const response = await this.fetchImpl(this.buildMethodUrl(method), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      return await this.decodeEnvelope<T>(response, method);
    } finally {
      cancel();
    }
  }

  async callMultipart<T>(
    method: string,
    fields: Record<string, string | number | boolean | undefined>,
    file?: {
      field: string;
      filename: string;
      contentType?: string;
      buffer: Uint8Array;
    },
    timeoutMs?: number,
  ): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "undefined") {
        continue;
      }
      form.set(key, String(value));
    }
    if (file) {
      const blob = new Blob([file.buffer], { type: file.contentType ?? "application/octet-stream" });
      form.set(file.field, blob, file.filename);
    }
    const { signal, cancel } = buildTimeoutSignal(timeoutMs);
    try {
      const response = await this.fetchImpl(this.buildMethodUrl(method), {
        method: "POST",
        body: form,
        signal,
      });
      return await this.decodeEnvelope<T>(response, method);
    } finally {
      cancel();
    }
  }

  async getMe(timeoutMs?: number): Promise<TelegramGetMe> {
    return await this.call<TelegramGetMe>("getMe", {}, timeoutMs);
  }

  async getUpdates(params: {
    offset?: number;
    timeoutSec?: number;
    allowedUpdates?: string[];
    timeoutMs?: number;
  }): Promise<TelegramUpdate[]> {
    const timeoutSec = Math.max(1, Math.min(60, Math.trunc(params.timeoutSec ?? 25)));
    const timeoutMs = params.timeoutMs ?? timeoutSec * 1000 + 8_000;
    const payload: Record<string, unknown> = {
      timeout: timeoutSec,
    };
    if (typeof params.offset === "number") {
      payload.offset = params.offset;
    }
    if (params.allowedUpdates?.length) {
      payload.allowed_updates = params.allowedUpdates;
    }
    return await this.call<TelegramUpdate[]>("getUpdates", payload, timeoutMs);
  }

  async getFile(fileId: string, timeoutMs?: number): Promise<TelegramGetFile> {
    return await this.call<TelegramGetFile>("getFile", { file_id: fileId }, timeoutMs);
  }

  async sendMessage(params: {
    chatId: string | number;
    text: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    disableNotification?: boolean;
  }): Promise<TelegramMessage> {
    const payload: Record<string, unknown> = {
      chat_id: parseTelegramChatId(params.chatId),
      text: params.text,
    };
    if (typeof params.replyToMessageId === "number") {
      payload.reply_to_message_id = params.replyToMessageId;
    }
    if (typeof params.messageThreadId === "number") {
      payload.message_thread_id = params.messageThreadId;
    }
    if (typeof params.disableNotification === "boolean") {
      payload.disable_notification = params.disableNotification;
    }
    return await this.call<TelegramMessage>("sendMessage", payload);
  }

  async sendMedia(params: {
    chatId: string | number;
    mediaUrl: string;
    caption?: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    disableNotification?: boolean;
    mediaLocalRoots?: readonly string[];
  }): Promise<TelegramMessage> {
    const loaded = await loadOutboundMediaFromUrl(params.mediaUrl, {
      mediaLocalRoots: params.mediaLocalRoots,
    });
    const filename = loaded.fileName ?? `upload-${Date.now()}`;
    const method = guessUploadMethod(params.mediaUrl, loaded.contentType);
    const field = method === "sendPhoto" ? "photo" : "document";
    return await this.callMultipart<TelegramMessage>(
      method,
      {
        chat_id: parseTelegramChatId(params.chatId),
        caption: params.caption,
        reply_to_message_id: params.replyToMessageId,
        message_thread_id: params.messageThreadId,
        disable_notification: params.disableNotification,
      },
      {
        field,
        filename,
        contentType: loaded.contentType,
        buffer: loaded.buffer,
      },
    );
  }

  async editMessageText(params: {
    chatId: string | number;
    messageId: number;
    text: string;
  }): Promise<TelegramMessage | true> {
    return await this.call<TelegramMessage | true>("editMessageText", {
      chat_id: parseTelegramChatId(params.chatId),
      message_id: params.messageId,
      text: params.text,
    });
  }

  async deleteMessage(params: { chatId: string | number; messageId: number }): Promise<boolean> {
    return await this.call<boolean>("deleteMessage", {
      chat_id: parseTelegramChatId(params.chatId),
      message_id: params.messageId,
    });
  }

  async setMessageReaction(params: {
    chatId: string | number;
    messageId: number;
    emoji?: string;
    remove?: boolean;
  }): Promise<boolean> {
    const emoji = params.emoji?.trim() ?? "";
    const shouldRemove = params.remove === true || emoji.length === 0;
    const reaction = shouldRemove
      ? []
      : [
          {
            type: "emoji",
            emoji,
          },
        ];
    return await this.call<boolean>("setMessageReaction", {
      chat_id: parseTelegramChatId(params.chatId),
      message_id: params.messageId,
      reaction,
    });
  }
}
