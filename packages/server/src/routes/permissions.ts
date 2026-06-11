import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { AppEnv } from "../auth.js";
import { parseJsonBody, validationError } from "../validation.js";
import { requireGuildMember, unknownChannel } from "./helpers.js";

export function permissionRoutes(repos: Repos): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.put("/channels/:channelId/permissions/:targetId", async (c) => {
    const user = c.get("botUser");
    if (user.bot) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }
    const channelId = c.req.param("channelId")!;
    const targetId = c.req.param("targetId")!;
    const userId = user.id;
    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) return unknownChannel(c);

    const body = await parseJsonBody<{ type: number; allow: string; deny: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    if (body.type !== 0 && body.type !== 1) {
      return validationError(c, "type must be 0 (role) or 1 (member)");
    }
    if (typeof body.allow !== "string" || typeof body.deny !== "string") {
      return validationError(c, "allow and deny must be strings");
    }

    try {
      BigInt(body.allow);
      BigInt(body.deny);
    } catch {
      return validationError(c, "allow and deny must be valid integer strings");
    }

    repos.permissions.upsert(channelId, targetId, body.type, body.allow, body.deny);
    return c.body(null, 204);
  });

  app.delete("/channels/:channelId/permissions/:targetId", (c) => {
    const user = c.get("botUser");
    if (user.bot) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }
    const channelId = c.req.param("channelId")!;
    const targetId = c.req.param("targetId")!;
    const userId = user.id;
    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) return unknownChannel(c);

    repos.permissions.remove(channelId, targetId);
    return c.body(null, 204);
  });

  return app;
}
