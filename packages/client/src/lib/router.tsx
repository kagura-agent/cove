import { createBrowserRouter } from "react-router-dom";
import { _bindRouter } from "./router-helpers";

// Re-export helpers so existing imports from "./router" still work
export { getActiveIdsFromRouter, getGuildForChannel, getRouter } from "./router-helpers";

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
        path: "channels/:guildId",
        lazy: () => import("../components/ServerOverview").then((m) => ({ Component: m.ServerOverview })),
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

// Bind the router instance so helpers can access it without circular imports
_bindRouter(router);
