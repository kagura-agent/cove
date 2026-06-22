/**
 * Cove outbound message adapter — declarative capability wrapper over sendDurableMessageBatch.
 *
 * Declares sendText and sendMedia capabilities for the Cove channel using the SDK's
 * createChannelMessageAdapterFromOutbound pattern. sendText delegates to sendDurableMessageBatch
 * for reliable delivery; sendMedia is a stub pending REST API support for media uploads.
 */
import {
  createChannelMessageAdapterFromOutbound,
  sendDurableMessageBatch,
} from "openclaw/plugin-sdk/channel-message";
import type {
  ChannelMessageSendTextContext,
  ChannelMessageSendMediaContext,
  ChannelMessageOutboundBridgeResult,
  ChannelMessageOutboundBridgeAdapter,
} from "openclaw/plugin-sdk/channel-message";

export interface CoveOutboundAdapterContext {
  /** Agent ID used to construct session keys for durable delivery. */
  agentId: string;
  log?: { warn?: (...a: any[]) => void; info?: (...a: any[]) => void };
}

/**
 * Creates the Cove outbound bridge adapter with sendText and sendMedia capabilities.
 *
 * - sendText: Uses sendDurableMessageBatch for reliable delivery with best_effort durability.
 * - sendMedia: Stub — Cove REST API does not yet support media uploads. Logs a warning and
 *   falls back to text-only delivery if text is available.
 */
export function createCoveOutboundBridgeAdapter(
  ctx: CoveOutboundAdapterContext,
): ChannelMessageOutboundBridgeAdapter {
  const { agentId, log } = ctx;

  return {
    deliveryCapabilities: {
      durableFinal: { text: true, media: true },
    },

    async sendText(sendCtx: ChannelMessageSendTextContext): Promise<ChannelMessageOutboundBridgeResult> {
      const result = await sendDurableMessageBatch({
        cfg: sendCtx.cfg,
        channel: "cove",
        to: sendCtx.to,
        accountId: sendCtx.accountId ?? undefined,
        payloads: [{ text: sendCtx.text }],
        bestEffort: true,
        durability: "best_effort",
        session: { key: `agent:${agentId}:cove:group:${sendCtx.to}` },
      });
      const messageId = result?.status === "sent" ? result.results?.[0]?.messageId : undefined;
      return { messageId };
    },

    async sendMedia(sendCtx: ChannelMessageSendMediaContext): Promise<ChannelMessageOutboundBridgeResult> {
      log?.warn?.(
        `cove: sendMedia not yet supported by Cove REST API — media URL ignored: ${sendCtx.mediaUrl}`,
      );
      // Stub: Cove REST API only supports text content.
      // Fall back to text-only delivery when text is present.
      if (sendCtx.text) {
        const result = await sendDurableMessageBatch({
          cfg: sendCtx.cfg,
          channel: "cove",
          to: sendCtx.to,
          accountId: sendCtx.accountId ?? undefined,
          payloads: [{ text: sendCtx.text }],
          bestEffort: true,
          durability: "best_effort",
          session: { key: `agent:${agentId}:cove:group:${sendCtx.to}` },
        });
        const messageId = result?.status === "sent" ? result.results?.[0]?.messageId : undefined;
        return { messageId };
      }
      return {};
    },
  };
}

/**
 * Creates a full ChannelMessageAdapterShape for Cove dispatch-level outbound delivery.
 * Wraps the bridge adapter via the SDK's createChannelMessageAdapterFromOutbound.
 */
export function createCoveOutboundMessageAdapter(ctx: CoveOutboundAdapterContext) {
  return createChannelMessageAdapterFromOutbound({
    id: "cove-dispatch-outbound",
    outbound: createCoveOutboundBridgeAdapter(ctx),
  });
}
