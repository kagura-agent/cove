/**
 * Pure helpers for building agent inbound context (cove.md resolution,
 * attachment URL collection, body composition).
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
 * Extract image attachment URLs from the message.
 * URLs starting with '/' get prefixed with account.baseUrl.
 */
export function collectImageAttachmentUrls(
  message: Message,
  baseUrl: string,
): string[] {
  const imageAttachments = (message.attachments || []).filter(
    (a: any) => a.content_type?.startsWith("image/"),
  );
  const attachmentUrls = imageAttachments.map((a: any) => a.url);
  return attachmentUrls.map((url: string) => {
    if (url.startsWith("/")) return baseUrl + url;
    return url;
  });
}

/**
 * Compose body text passed to the agent. Trailing image URLs (from
 * collectImageAttachmentUrls) appended after a blank line.
 */
export function buildBodyForAgent(
  message: Message,
  fullAttachmentUrls: string[],
  baseUrl: string,
): string {
  let bodyForAgent = message.content;

  // Append image URLs to body so agent sees them
  if (fullAttachmentUrls.length > 0) {
    const urlsText = fullAttachmentUrls
      .map((url: string) => "[image: " + url + "]")
      .join("\n");
    bodyForAgent = bodyForAgent ? bodyForAgent + "\n\n" + urlsText : urlsText;
  }

  return bodyForAgent;
}
