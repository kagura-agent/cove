import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { Repos } from "./repos/index.js";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes } from "./routes/messages.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes, type OAuthConfig } from "./routes/auth.js";
import { registerRoutes } from "./routes/register.js";
import { reactionRoutes } from "./routes/reactions.js";
import { webhookRoutes, webhookExecuteRoutes } from "./routes/webhooks.js";
import { permissionRoutes } from "./routes/permissions.js";
import { channelFilesRoutes } from "./routes/channel-files.js";
import { threadRoutes } from "./routes/threads.js";
import { requireAuth, type AppEnv } from "./auth.js";
import type { GatewayDispatcher } from "./ws/dispatcher.js";
import { API_PREFIX } from "@cove/shared";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { getAttachmentPath } from "./attachment-storage.js";
import { readFile } from "fs/promises";
import { resolve, relative } from "path";

export interface AppConfig {
  gatewayUrl?: string;
  oauth?: OAuthConfig;
}

const PUBLIC_PATHS = new Set(["/api/auth/google", "/api/auth/callback", "/api/auth/me", "/api/auth/pending-status", "/api/auth/logout", `${API_PREFIX}/auth/register`]);

export function createApp(
  db: Database.Database,
  repos: Repos,
  dispatcher?: GatewayDispatcher,
  config?: AppConfig,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.route(API_PREFIX, registerRoutes(db));

  if (config?.oauth) {
    app.route("/", authRoutes(db, config.oauth, repos.guilds, repos.users));
  }

  // Webhook execute endpoint — no auth required (token is in the URL)
  app.route(API_PREFIX, webhookExecuteRoutes(repos, dispatcher));

  // Global auth: all /api/* routes (except PUBLIC_PATHS and OPTIONS) require a valid token.
  const authMw = requireAuth(repos.users);
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const path = c.req.path.replace(/\/+$/, "") || "/";
    if (PUBLIC_PATHS.has(path)) return next();
    return authMw(c, next);
  });

  // Rate limiting — after auth so we have userId, before routes
  app.use("/api/*", rateLimitMiddleware());

  // Static file serving for attachments (requires auth)
  app.get(API_PREFIX + "/attachments/:guildId/:channelId/:attachmentId/:filename", authMw, async (c) => {
    const guildId = c.req.param("guildId")!;
    const channelId = c.req.param("channelId")!;
    const attachmentId = c.req.param("attachmentId")!;
    const filename = c.req.param("filename")!;

    // Sanitize to prevent path traversal
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '');
    const safeGuildId = sanitize(guildId);
    const safeChannelId = sanitize(channelId);
    const safeAttachmentId = sanitize(attachmentId);
    const safeFilename = sanitize(filename);
    if (!safeGuildId || !safeChannelId || !safeAttachmentId || !safeFilename) {
      return c.json({ message: 'Invalid path', code: 50035 }, 400);
    }

    // Authorization: check guild membership
    const user = c.get('botUser');
    const channel = repos.channels.getById(safeChannelId);
    if (!channel) {
      return c.json({ message: 'Unknown Channel', code: 10003 }, 404);
    }
    const member = repos.members.get(channel.guild_id, user.id);
    if (!member) {
      return c.json({ message: 'Missing Access', code: 50001 }, 403);
    }

    try {
      const filePath = await getAttachmentPath(safeGuildId, safeChannelId, safeAttachmentId, safeFilename);

      // Verify resolved path is under attachments dir with proper boundary check
      const ATTACHMENT_ROOT = resolve(process.cwd(), 'data', 'attachments');
      const resolvedPath = resolve(filePath);
      const rel = relative(ATTACHMENT_ROOT, resolvedPath);
      if (rel.startsWith('..') || resolve(ATTACHMENT_ROOT, rel) !== resolvedPath) {
        return c.json({ message: 'Invalid path', code: 50035 }, 400);
      }

      const fileData = await readFile(filePath);

      // Determine content type from file extension
      let contentType = "application/octet-stream";
      let isImage = false;
      if (safeFilename.endsWith(".jpg") || safeFilename.endsWith(".jpeg")) {
        contentType = "image/jpeg";
        isImage = true;
      } else if (safeFilename.endsWith(".png")) {
        contentType = "image/png";
        isImage = true;
      } else if (safeFilename.endsWith(".gif")) {
        contentType = "image/gif";
        isImage = true;
      } else if (safeFilename.endsWith(".webp")) {
        contentType = "image/webp";
        isImage = true;
        isImage = true;
      }

      return c.body(fileData, 200, {
        "Content-Type": contentType,
        "Content-Disposition": isImage
          ? `inline; filename="${safeFilename}"`
          : `attachment; filename="${safeFilename}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
    } catch (err) {
      return c.json({ message: "Attachment not found", code: 10008 }, 404);
    }
  });

  app.route(API_PREFIX, channelRoutes(repos, dispatcher));
  app.route(API_PREFIX, messagesRoutes(repos, dispatcher));
  app.route(API_PREFIX, reactionRoutes(repos, dispatcher));
  app.route(API_PREFIX, webhookRoutes(repos));
  app.route(API_PREFIX, agentRoutes(repos, dispatcher));
  app.route(API_PREFIX, permissionRoutes(repos));
  app.route(API_PREFIX, channelFilesRoutes(repos, dispatcher));
  app.route(API_PREFIX, threadRoutes(repos, dispatcher));

  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get(`${API_PREFIX}/gateway`, (c) => c.json({ url: gwUrl }));
  app.get(`${API_PREFIX}/gateway/bot`, (c) => c.json({
    url: gwUrl,
    shards: 1,
    session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
  }));

  app.get(`${API_PREFIX}/guilds/:guildId/presences`, (c) => {
    const guildId = c.req.param("guildId")!;
    if (!repos.guilds.exists(guildId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const userId = c.get("botUser").id;
    if (!repos.members.exists(guildId, userId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const onlineIds = dispatcher?.getOnlineUserIds() ?? [];
    return c.json(onlineIds.map((id) => ({ user: { id }, status: "online" })));
  });

  app.get(`${API_PREFIX}/users/@me`, (c) => {
    return c.json(c.get("botUser"));
  });

  app.get(`${API_PREFIX}/users/@me/guilds`, (c) => {
    const user = c.get("botUser");
    return c.json(repos.guilds.listForUser(user.id));
  });

  return app;
}
