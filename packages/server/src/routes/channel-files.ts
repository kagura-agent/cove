import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { AppEnv } from "../auth.js";
import { parseJsonBody, validationError } from "../validation.js";
import { requireGuildMember, requireBotChannelPermission, unknownChannel } from "./helpers.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/;
const MAX_CONTENT_SIZE = 100 * 1024; // 100KB

export function channelFilesRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List files (metadata only)
  app.get("/channels/:channelId/files", (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId");
    const channel = requireGuildMember(repos, channelId, user.id);
    if (!channel) return unknownChannel(c);
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const files = repos.channelFiles.list(channelId);
    return c.json(files);
  });

  // Get file content
  app.get("/channels/:channelId/files/:filename", (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId");
    const channel = requireGuildMember(repos, channelId, user.id);
    if (!channel) return unknownChannel(c);
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const filename = c.req.param("filename");
    if (!FILENAME_RE.test(filename)) {
      return validationError(c, "Invalid filename");
    }
    const file = repos.channelFiles.get(channelId, filename);
    if (!file) return c.json({ message: "Unknown File", code: 10014 }, 404);

    return c.json(file);
  });

  // Create/update file
  app.put("/channels/:channelId/files/:filename", async (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId");
    const channel = requireGuildMember(repos, channelId, user.id);
    if (!channel) return unknownChannel(c);
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const filename = c.req.param("filename");
    if (!FILENAME_RE.test(filename)) {
      return validationError(c, "Invalid filename. Must match /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/");
    }

    const body = await parseJsonBody<{ content: string; content_type?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");
    if (typeof body.content !== "string") return validationError(c, "content is required and must be a string");
    if (Buffer.byteLength(body.content, "utf8") > MAX_CONTENT_SIZE) {
      return validationError(c, "File content exceeds 100KB limit");
    }
    if (body.content_type !== undefined) {
      if (typeof body.content_type !== "string") return validationError(c, "content_type must be a string");
      if (body.content_type.length > 255) return validationError(c, "content_type must be at most 255 characters");
    }

    const existing = repos.channelFiles.get(channelId, filename);
    const file = repos.channelFiles.upsert(channelId, filename, body.content, body.content_type);
    if (!file) return validationError(c, "File content exceeds 100KB limit");

    if (dispatcher) {
      const fileInfo = { filename, content_type: file.content_type, size: file.size };
      if (existing) {
        dispatcher.channelFileUpdate(channelId, fileInfo);
      } else {
        dispatcher.channelFileCreate(channelId, fileInfo);
      }
    }

    return c.json(file, 200);
  });

  // Delete file
  app.delete("/channels/:channelId/files/:filename", (c) => {
    const user = c.get("botUser");
    const channelId = c.req.param("channelId");
    const channel = requireGuildMember(repos, channelId, user.id);
    if (!channel) return unknownChannel(c);
    if (!requireBotChannelPermission(repos, channelId, user.id, user.bot)) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const filename = c.req.param("filename");
    if (!FILENAME_RE.test(filename)) {
      return validationError(c, "Invalid filename");
    }
    const deleted = repos.channelFiles.delete(channelId, filename);
    if (!deleted) return c.json({ message: "Unknown File", code: 10014 }, 404);

    if (dispatcher) {
      dispatcher.channelFileDelete(channelId, filename);
    }

    return c.body(null, 204);
  });

  return app;
}
