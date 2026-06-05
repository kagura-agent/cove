import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import { requireAuth, type AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";

export function agentRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(repos.users);

  app.post("/users", auth, async (c) => {
    const body = await parseJsonBody<{
      id?: string;
      username: string;
      avatar?: string;
      bot?: boolean;
      bio?: string;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.username, "username", { required: true, maxLength: 80 });
    if (err) return validationError(c, err);

    const username = body.username.trim();

    const id = body.id?.trim() || username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (repos.users.exists(id)) {
      return c.json({ message: "User already exists", code: 40002 }, 409);
    }

    const user = repos.users.create({ id: body.id, username, avatar: body.avatar, bot: body.bot, bio: body.bio }, repos.guilds.getDefaultId());
    return c.json(user, 201);
  });

  app.post("/users/:id/token", auth, (c) => {
    const id = c.req.param("id");
    const actorId = c.get("botUser").id;

    // Only the user themselves can regenerate their token
    if (id !== actorId) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    const token = repos.users.regenerateToken(id!);
    if (!token) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }
    return c.json({ token });
  });

  app.get("/users/:id", (c, next) => {
    const id = c.req.param("id");
    if (id === "@me") return next();
    const user = repos.users.getById(id);
    if (!user) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }
    return c.json(user);
  });

  app.patch("/users/:id", auth, async (c) => {
    const id = c.req.param("id");
    const actorId = c.get("botUser").id;

    // Only the user themselves can update their profile
    if (id !== actorId) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    if (!repos.users.exists(id!)) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }

    const body = await parseJsonBody<{
      username?: string;
      avatar?: string | null;
      bio?: string | null;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const err = validateString(body.username, "username", { maxLength: 80 });
    if (err) return validationError(c, err);

    const updated = repos.users.update(id!, body)!;
    return c.json(updated);
  });

  app.delete("/users/:id", auth, (c) => {
    const id = c.req.param("id");
    const actorId = c.get("botUser").id;

    // Only the user themselves can delete their account
    if (id !== actorId) {
      return c.json({ message: "Missing Permissions", code: 50013 }, 403);
    }

    if (!repos.users.delete(id!)) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }
    return c.body(null, 204);
  });

  // ─── Guild Members ─────────────────────────────────────────

  app.get("/users/@me/guilds", auth, (c) => {
    const userId = c.get("botUser").id;
    return c.json(repos.guilds.listForUser(userId));
  });

  app.get("/guilds/:guildId/members", auth, (c) => {
    const guildId = c.req.param("guildId")!;
    if (!repos.guilds.exists(guildId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const userId = c.get("botUser").id;
    if (!repos.members.exists(guildId, userId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    return c.json(repos.members.list(guildId));
  });

  app.put("/guilds/:guildId/members/:userId", auth, async (c) => {
    const guildId = c.req.param("guildId")!;
    const userId = c.req.param("userId")!;

    if (!repos.guilds.exists(guildId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const actingUserId = c.get("botUser").id;
    if (!repos.members.exists(guildId, actingUserId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    if (!repos.users.exists(userId)) {
      return c.json({ message: "Unknown User", code: 10013 }, 404);
    }

    const existing = repos.members.get(guildId, userId);
    if (existing) {
      return c.json(existing);
    }

    const body = await c.req.json<{ nick?: string; roles?: string[] }>().catch(() => ({} as { nick?: string; roles?: string[] }));
    const member = repos.members.add(guildId, userId, body.nick, body.roles);
    dispatcher?.addGuildToUser(userId, guildId);
    return c.json(member, 201);
  });

  app.delete("/guilds/:guildId/members/:userId", auth, (c) => {
    const guildId = c.req.param("guildId")!;
    const userId = c.req.param("userId")!;

    if (!repos.guilds.exists(guildId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    const actingUserId = c.get("botUser").id;
    if (!repos.members.exists(guildId, actingUserId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }

    if (!repos.members.exists(guildId, userId)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    repos.members.remove(guildId, userId);
    dispatcher?.removeGuildFromUser(userId, guildId);
    return c.body(null, 204);
  });

  return app;
}
