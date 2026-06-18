/**
 * Pure helpers for building agent inbound context (cove.md resolution,
 * attachment URL collection, body composition with batched message context).
 *
 * Extracted from dispatch.ts (Phase 0.5 of #398). No behavior change —
 * identical logic, just moved into separately-testable units.
 */

import type { CoveRestClient } from "./rest-client.js";
import type { Message } from "@cove/shared";

/**
 * For threads (channel.type === 11), cove.md lives on the parent channel,
 * not the thread itself. Returns the channelId where getCoveMd should look.
 *
 * Failure (e.g. getChannel throws) falls back to the original channelId
 * — matches main behavior at dispatch.ts L262-271.
 */
export async function resolveCoveMdChannelId(
  restClient: CoveRestClient,
  channelId: string,
): Promise<string> {
  try {
    const channel = await restClient.getChannel(channelId);
    if (channel.type === 11 && channel.parent_id) {
      return channel.parent_id;
    }
  } catch {
    /* fall back to channelId */
  }
  return channelId;
}

/**
 * Extract image attachment URLs from the primary message and any batched
 * messages. URLs starting with '/' get prefixed with account.baseUrl.
 * De-dupes URLs (a single image referenced in primary + batched only counts
 * once) — matches main behavior at dispatch.ts L275-292.
 */
export function collectImageAttachmentUrls(
  message: Message,
  batchedMessages: Message[] | undefined,
  baseUrl: string,
): string[] {
  const imageAttachments = (message.attachments || []).filter(
    (a: any) => a.content_type?.startsWith("image/"),
  );
  const attachmentUrls = imageAttachments.map((a: any) => a.url);
  const fullAttachmentUrls = attachmentUrls.map((url: string) => {
    if (url.startsWith("/")) return baseUrl + url;
    return url;
  });

  if (batchedMessages) {
    for (const bm of batchedMessages) {
      const bmImages = (bm.attachments || []).filter(
        (a: any) => a.content_type?.startsWith("image/"),
      );
      for (const a of bmImages) {
        const url = a.url.startsWith("/") ? baseUrl + a.url : a.url;
        if (!fullAttachmentUrls.includes(url)) fullAttachmentUrls.push(url);
      }
    }
  }

  return fullAttachmentUrls;
}

/**
 * Compose body text passed to the agent. For batched messages, prepends each
 * earlier message as `name: content [image: url]` lines, then a blank line,
 * then the primary message content. Trailing image URLs (from
 * collectImageAttachmentUrls) appended after another blank line.
 *
 * Matches main behavior at dispatch.ts L294-313.
 */
export function buildBodyForAgent(
  message: Message,
  batchedMessages: Message[] | undefined,
  fullAttachmentUrls: string[],
  baseUrl: string,
): string {
  let bodyForAgent = message.content;
  if (batchedMessages && batchedMessages.length > 0) {
    const contextLines = batchedMessages.map((m) => {
      const name = m.author?.global_name || m.author?.username || "Unknown";
      let line = name + ": " + m.content;
      // Inline image markers next to the sending author
      const msgImages = (m.attachments || []).filter(
        (a: any) => a.content_type?.startsWith("image/"),
      );
      for (const img of msgImages) {
        const imgUrl = img.url.startsWith("/") ? baseUrl + img.url : img.url;
        line += " [image: " + imgUrl + "]";
      }
      return line;
    });
    bodyForAgent = contextLines.join("\n") + "\n\n" + bodyForAgent;
  }

  // Append image URLs to body so agent sees them
  if (fullAttachmentUrls.length > 0) {
    const urlsText = fullAttachmentUrls
      .map((url: string) => "[image: " + url + "]")
      .join("\n");
    bodyForAgent = bodyForAgent ? bodyForAgent + "\n\n" + urlsText : urlsText;
  }

  return bodyForAgent;
}
