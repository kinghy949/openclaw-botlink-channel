import type { TelegramMessage } from "./api-client.js";

export type BotlinkRoutePeer = {
  kind: "direct" | "group";
  id: string;
};

export type BotlinkRoutePeerResolution = {
  isGroup: boolean;
  primaryPeer: BotlinkRoutePeer;
  secondaryPeer?: BotlinkRoutePeer;
};

export type BotlinkRouteResolution<T> = {
  value: T;
  matchedBy?: string;
};

export type BotlinkRouteFallbackResult<T> = {
  selected: BotlinkRouteResolution<T>;
  selectedPeer: BotlinkRoutePeer;
  usedFallback: boolean;
  primaryMatchedBy?: string;
  secondaryMatchedBy?: string;
};

function isExplicitRouteMatch(matchedBy?: string): boolean {
  return Boolean(matchedBy && matchedBy !== "default");
}

export function resolveBotlinkRoutePeers(message: TelegramMessage): BotlinkRoutePeerResolution {
  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  const chatId = String(message.chat.id);
  if (isGroup) {
    return {
      isGroup: true,
      primaryPeer: {
        kind: "group",
        id: chatId,
      },
    };
  }

  const senderId = String(message.from?.id ?? message.chat.id);
  return {
    isGroup: false,
    primaryPeer: {
      kind: "direct",
      id: chatId,
    },
    secondaryPeer:
      senderId !== chatId
        ? {
            kind: "direct",
            id: senderId,
          }
        : undefined,
  };
}

export function resolveBotlinkRouteWithFallback<T>(params: {
  primaryPeer: BotlinkRoutePeer;
  secondaryPeer?: BotlinkRoutePeer;
  resolveByPeer: (peer: BotlinkRoutePeer) => BotlinkRouteResolution<T>;
}): BotlinkRouteFallbackResult<T> {
  const primary = params.resolveByPeer(params.primaryPeer);
  if (!params.secondaryPeer || primary.matchedBy !== "default") {
    return {
      selected: primary,
      selectedPeer: params.primaryPeer,
      usedFallback: false,
      primaryMatchedBy: primary.matchedBy,
    };
  }

  const secondary = params.resolveByPeer(params.secondaryPeer);
  if (isExplicitRouteMatch(secondary.matchedBy)) {
    return {
      selected: secondary,
      selectedPeer: params.secondaryPeer,
      usedFallback: true,
      primaryMatchedBy: primary.matchedBy,
      secondaryMatchedBy: secondary.matchedBy,
    };
  }

  return {
    selected: primary,
    selectedPeer: params.primaryPeer,
    usedFallback: false,
    primaryMatchedBy: primary.matchedBy,
    secondaryMatchedBy: secondary.matchedBy,
  };
}

export function formatBotlinkRoutePeer(peer?: BotlinkRoutePeer): string {
  return peer ? `${peer.kind}:${peer.id}` : "none";
}
