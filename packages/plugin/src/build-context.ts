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
 * Resolves thread context: the channelId for cove.md lookup and the raw
 * channel object (so callers can reuse it without re-fetching).
 *
 * For threads (channel.type === 11), cove.md lives on the parent channel.
 * Failure falls back to the original channelId with channel undefined.
 */
export async function resolveThreadContext(
  restClient: CoveRestClient,
  channelId: string,
): Promise<{ coveMdChannelId: string; channel?: { type: number; parent_id?: string | null } }> {
  try {
    const channel = await restClient.getChannel(channelId);
    const coveMdChannelId =
      channel.type === 11 && channel.parent_id ? channel.parent_id : channelId;
    return { coveMdChannelId, channel };
  } catch {
    return { coveMdChannelId: channelId };
  }
}

/**
 * Back-compat wrapper — delegates to resolveThreadContext.
 */
export async function resolveCoveMdChannelId(
  restClient: CoveRestClient,
  channelId: string,
): Promise<string> {
  const { coveMdChannelId } = await resolveThreadContext(restClient, channelId);
  return coveMdChannelId;
}

/**
 * Returns true if the channel is a task thread (type 11 with is_task_thread
 * flag set by the server during task creation). Reads the flag directly from
 * the channel object — no getTasks query needed.
 *
 * Accepts an optional pre-fetched channel object to avoid redundant API calls.
 */
export async function isTaskThread(
  restClient: CoveRestClient,
  channelId: string,
  channel?: { type: number; parent_id?: string | null; is_task_thread?: boolean },
): Promise<boolean> {
  try {
    const ch = channel ?? (await restClient.getChannel(channelId));
    return ch.type === 11 && Boolean((ch as any).is_task_thread);
  } catch {
    return false;
  }
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
