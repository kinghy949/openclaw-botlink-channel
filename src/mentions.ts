import type { TelegramMessage } from "./api-client.js";

export function extractMentionedUsernames(text: string): string[] {
  const result = new Set<string>();
  const mentionRegex = /(^|\s)@([a-zA-Z0-9_]{1,32})\b/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    result.add(match[2].toLowerCase());
  }
  return [...result];
}

export function isMessageTargetingBot(message: TelegramMessage, botUsername?: string): boolean {
  const normalizedBotUsername = botUsername?.trim().toLowerCase();
  if (!normalizedBotUsername) {
    return true;
  }

  const text = `${message.text ?? ""}\n${message.caption ?? ""}`.trim();
  const mentions = extractMentionedUsernames(text);
  if (mentions.includes(normalizedBotUsername)) {
    return true;
  }

  const replyUsername = message.reply_to_message?.from?.username?.trim().toLowerCase();
  if (replyUsername && replyUsername === normalizedBotUsername) {
    return true;
  }

  return false;
}
