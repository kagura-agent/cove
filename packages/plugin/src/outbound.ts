/**
 * Cove outbound message adapter — declarative capability wrapper over sendDurableMessageBatch.
 *
 * Declares sendText and sendMedia capabilities for the Cove channel using the SDK's
 * createChannelMessageAdapterFromOutbound pattern. sendText delegates to sendDurableMessageBatch
 * for reliable delivery; sendMedia is a stub pending REST API support for media uploads.
 */
import {
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

/** Shared helper — sends a text payload via sendDurableMessageBatch with Cove defaults. */
async function sendCoveDurableBatch(opts: { cfg: unknown; to: string; accountId?: string | null; text: string; agentId: string }) {
  await sendDurableMessageBatch({
    cfg: opts.cfg as any,
    channel: "cove",
    to: opts.to,
    accountId: opts.accountId ?? undefined,
    payloads: [{ text: opts.text }],
    bestEffort: true,
    durability: "best_effort",
    session: { key: `agent:${opts.agentId}:cove:group:${opts.to}` },
  });
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
      durableFinal: { text: true },
    },

    async sendText(sendCtx: ChannelMessageSendTextContext<unknown>): Promise<ChannelMessageOutboundBridgeResult> {
      await sendCoveDurableBatch({ cfg: sendCtx.cfg, to: sendCtx.to, accountId: sendCtx.accountId, text: sendCtx.text, agentId });
      return {};
    },

    async sendMedia(sendCtx: ChannelMessageSendMediaContext<unknown>): Promise<ChannelMessageOutboundBridgeResult> {
      log?.warn?.(
        `cove: sendMedia not yet supported by Cove REST API — media URL ignored: ${sendCtx.mediaUrl}`,
      );
      // Stub: Cove REST API only supports text content.
      // Fall back to text-only delivery when text is present.
      // TODO(#401): implement when Cove REST API supports media uploads
      if (sendCtx.text) {
        await sendCoveDurableBatch({ cfg: sendCtx.cfg, to: sendCtx.to, accountId: sendCtx.accountId, text: sendCtx.text, agentId });
      }
      return {};
    },
  };
}
