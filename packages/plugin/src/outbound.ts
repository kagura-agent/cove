/**
 * Cove outbound message adapter — declarative capability wrapper over sendDurableMessageBatch.
 *
 * Declares sendText and sendMedia capabilities for the Cove channel using the SDK's
 * createChannelMessageAdapterFromOutbound pattern. sendText delegates to sendDurableMessageBatch
 * for reliable delivery; sendMedia uploads an authorized local or remote image as multipart data.
 */
import {
  sendDurableMessageBatch,
} from "openclaw/plugin-sdk/channel-message";
import { loadOutboundMediaFromUrl } from "openclaw/plugin-sdk/outbound-media";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import { CoveRestClient } from "./rest-client.js";
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

type DurableBatchResult = Awaited<ReturnType<typeof sendDurableMessageBatch>>;

/**
 * Durable sends may resolve with a failed or incomplete outcome instead of
 * throwing. A final reply is delivered only when every requested payload has
 * a visible platform message ID; anything else must remain retryable.
 */
function assertConfirmedVisibleDelivery(result: DurableBatchResult, payloadCount: number): void {
  if (result.status === "suppressed") return;

  if (result.status !== "sent") {
    const cause = "error" in result ? result.error : undefined;
    throw cause === undefined
      ? new Error(`cove: durable send was not confirmed (status: ${result.status})`)
      : new Error(`cove: durable send was not confirmed (status: ${result.status})`, { cause });
  }

  const outcomes = result.payloadOutcomes;
  if (outcomes !== undefined) {
    if (!Array.isArray(outcomes) || outcomes.length !== payloadCount) {
      throw new Error("cove: durable send returned malformed payload outcomes");
    }

    const confirmed = outcomes.every((outcome, index) =>
      outcome?.index === index
      && outcome.status === "sent"
      && Array.isArray(outcome.results)
      && outcome.results.length > 0
      && outcome.results.every((delivery) => typeof delivery?.messageId === "string" && delivery.messageId.length > 0),
    );
    if (!confirmed) {
      throw new Error("cove: durable send returned an unconfirmed visible outcome");
    }
    return;
  }

  const hasReceipt = result.receipt?.platformMessageIds.some((messageId) =>
    typeof messageId === "string" && messageId.length > 0,
  );
  const hasResult = result.results?.some((delivery) =>
    typeof delivery?.messageId === "string" && delivery.messageId.length > 0,
  );
  if (!hasReceipt && !hasResult) {
    throw new Error("cove: durable send returned no visible delivery confirmation");
  }
}

/** Shared helper — sends a text payload via sendDurableMessageBatch with Cove defaults. */
async function sendCoveDurableBatch(opts: { cfg: unknown; to: string; accountId?: string | null; text: string; agentId: string }) {
  const result = await sendDurableMessageBatch({
    cfg: opts.cfg as any,
    channel: "cove",
    to: opts.to,
    accountId: opts.accountId ?? undefined,
    payloads: [{ text: opts.text }],
    bestEffort: true,
    durability: "best_effort",
    session: { key: `agent:${opts.agentId}:cove:group:${opts.to}` },
  });
  assertConfirmedVisibleDelivery(result, 1);
  const delivered = result as any;
  return delivered.payloadOutcomes?.[0]?.results?.[0]?.messageId ?? delivered.receipt?.platformMessageIds?.[0] ?? delivered.results?.[0]?.messageId;
}

/**
 * Creates the Cove outbound bridge adapter with sendText and sendMedia capabilities.
 *
 * - sendText: Uses sendDurableMessageBatch for reliable delivery with best_effort durability.
 * - sendMedia: Loads authorized media then sends its caption and file as one multipart Cove message.
 */
export function createCoveOutboundBridgeAdapter(
  ctx: CoveOutboundAdapterContext,
): ChannelMessageOutboundBridgeAdapter {
  const { agentId, log } = ctx;

  return {
    deliveryCapabilities: {
      durableFinal: { text: true, media: true },
    },

    async sendText(sendCtx: ChannelMessageSendTextContext<unknown>): Promise<ChannelMessageOutboundBridgeResult> {
      const messageId = await sendCoveDurableBatch({ cfg: sendCtx.cfg, to: sendCtx.to, accountId: sendCtx.accountId, text: sendCtx.text, agentId });
      return messageId ? { messageId } : {};
    },

    async sendMedia(sendCtx: ChannelMessageSendMediaContext<unknown>): Promise<ChannelMessageOutboundBridgeResult> {
      const channelConfig = (sendCtx.cfg as any)?.channels?.cove;
      const accountId = sendCtx.accountId ?? undefined;
      const account = resolveMergedAccountConfig({ channelConfig, accounts: channelConfig?.accounts, accountId: accountId as string });
      const token = account?.token;
      if (typeof token !== "string" || !token) throw new Error(`cove: account '${accountId ?? "default"}' missing token for media upload`);
      const media = await loadOutboundMediaFromUrl(sendCtx.mediaUrl, {
        maxBytes: 8 * 1024 * 1024,
        ...(sendCtx.mediaAccess ? { mediaAccess: sendCtx.mediaAccess } : {}),
        ...(sendCtx.mediaLocalRoots ? { mediaLocalRoots: sendCtx.mediaLocalRoots } : {}),
        ...(sendCtx.mediaReadFile ? { mediaReadFile: sendCtx.mediaReadFile } : {}),
      });
      const contentType = media.contentType?.toLowerCase();
      if (!contentType || !new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]).has(contentType)) {
        throw new Error(`cove: unsupported outbound media type '${media.contentType ?? "unknown"}'; allowed: jpeg, png, gif, webp`);
      }
      const client = new CoveRestClient(typeof account?.baseUrl === "string" ? account.baseUrl : "http://localhost:3400", token);
      const message = await client.sendMediaMessage(sendCtx.to, sendCtx.text ?? "", [{ buffer: media.buffer, filename: media.fileName ?? "attachment", contentType }]);
      log?.info?.(`cove: uploaded media attachment ${message.id} to ${sendCtx.to}`);
      return { messageId: message.id };
    },
  };
}
