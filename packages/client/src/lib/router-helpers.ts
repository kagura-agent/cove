/**
 * Router helper functions extracted from router.tsx to break circular dependencies.
 *
 * Circular chains broken:
 *   1) AppShell > ... > useBotStore > router.tsx
 *   2) router.tsx > ChannelView > ChatArea > ChatMarkdown
 *   3) router.tsx > ChannelView > ChatArea > MessageContextMenu
 *
 * These helpers use a late-bound router reference so they can be imported
 * without pulling in the router module (and its lazy component imports).
 */
import { useChannelStore } from "../stores/useChannelStore";

// Late-bound reference set by router.tsx after creation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _router: any = null;

/** Called by router.tsx to register the router instance. */
export function _bindRouter(router: unknown): void {
  _router = router;
}

/** Get the bound router instance (for navigate, etc.). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRouter(): any {
  return _router;
}

/** Read active IDs from the current router state (non-React code). */
export function getActiveIdsFromRouter(): {
  guildId: string | null;
  channelId: string | null;
  threadId: string | null;
} {
  if (!_router) return { guildId: null, channelId: null, threadId: null };
  const matches = _router.state.matches;
  const channelMatch = matches.find((m: { params: { channelId?: string } }) => m.params.channelId);
  if (!channelMatch) return { guildId: null, channelId: null, threadId: null };
  return {
    guildId: channelMatch.params.guildId ?? null,
    channelId: channelMatch.params.channelId ?? null,
    threadId: channelMatch.params.threadId ?? null,
  };
}

/** Look up guildId for a given channelId from the channel store. */
export function getGuildForChannel(channelId: string): string | null {
  const { channelsByGuildId } = useChannelStore.getState();
  for (const [guildId, channels] of Object.entries(channelsByGuildId)) {
    if (channels.some((c) => c.id === channelId)) {
      return guildId;
    }
  }
  return null;
}
