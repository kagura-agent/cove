import { Hono } from "hono";
import type Database from "better-sqlite3";
import { createRepos } from "./repos/index.js";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes } from "./routes/messages.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes, type OAuthConfig } from "./routes/auth.js";
import { registerRoutes } from "./routes/register.js";
import { requireAuth, resolveUser } from "./auth.js";
import type { GatewayDispatcher } from "./ws/dispatcher.js";

export interface AppConfig {
  gatewayUrl?: string;
  oauth?: OAuthConfig;
}

const PUBLIC_PATHS = new Set(["/api/auth/google", "/api/auth/callback", "/api/auth/me", "/api/v10/auth/register"]);

export function createApp(
  db: Database.Database,
  dispatcher?: GatewayDispatcher,
  config?: AppConfig,
): Hono {
  const app = new Hono();
  const repos = createRepos(db);

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.route("/", registerRoutes(db));

  if (config?.oauth) {
    app.route("/", authRoutes(db, config.oauth));
  }

  const authMw = requireAuth(db);
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const path = c.req.path.replace(/\/+$/, "") || "/";
    if (PUBLIC_PATHS.has(path)) return next();
    return authMw(c, next);
  });

  app.route("/", channelRoutes(db, repos, dispatcher));
  app.route("/", messagesRoutes(db, repos, dispatcher));
  app.route("/", agentRoutes(db, repos));

  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get("/api/v10/gateway", (c) => c.json({ url: gwUrl }));

  app.get("/api/v10/users/@me", (c) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (user) return c.json(user);
    return c.json({ message: "Authentication required", code: 40001 }, 401);
  });

  return app;
}
