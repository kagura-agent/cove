import { createBrowserRouter } from "react-router-dom";
import { useChannelStore } from "../stores/useChannelStore";

export const router = createBrowserRouter([
  {
    path: "/",
    lazy: () => import("../AppShell").then((m) => ({ Component: m.AppShell })),
    children: [
      {
        index: true,
        lazy: () => import("../components/RedirectToDefault").then((m) => ({ Component: m.RedirectToDefault })),
      },
      {
        path: "channels/:guildId/:channelId",
        lazy: () => import("../components/ChannelView").then((m) => ({ Component: m.ChannelView })),
        children: [
          {
            path: "threads/:threadId",
            // No element — route exists only for param capture.
            // ThreadPanel is conditionally rendered by ChannelView via useParams().
          },
        ],
      },
    ],
  },
]);

/** Read active IDs from the current router state (non-React code). */
export function getActiveIdsFromRouter(): {
  guildId: string | null;
  channelId: string | null;
  threadId: string | null;
} {
  const matches = router.state.matches;
  const channelMatch = matches.find((m) => m.params.channelId);
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
