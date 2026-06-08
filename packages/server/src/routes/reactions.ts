import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { requireGuildMember, unknownChannel, unknownMessage } from "./helpers.js";

export function reactionRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // PUT /channels/:channelId/messages/:messageId/reactions/:emoji/@me
  app.put("/channels/:channelId/messages/:messageId/reactions/:emoji/@me", (c) => {
    const channelId = c.req.param("channelId");
    const messageId = c.req.param("messageId");
    const emoji = c.req.param("emoji");

    if (!emoji || emoji.length > 64) {
      return c.json({ message: "Invalid emoji" }, 400);
    }
    const userId = c.get("botUser").id;

    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) return unknownChannel(c);

    const message = repos.messages.getById(channelId, messageId);
    if (!message) return unknownMessage(c);

    const added = repos.reactions.add(messageId, userId, emoji);
    if (added) {
      const count = repos.reactions.getCount(messageId, emoji);
      dispatcher?.reactionAdd(channelId, messageId, userId, emoji, channel.guild_id, count);
    }

    return c.body(null, 204);
  });

  // DELETE /channels/:channelId/messages/:messageId/reactions/:emoji/@me
  app.delete("/channels/:channelId/messages/:messageId/reactions/:emoji/@me", (c) => {
    const channelId = c.req.param("channelId");
    const messageId = c.req.param("messageId");
    const emoji = c.req.param("emoji");

    if (!emoji || emoji.length > 64) {
      return c.json({ message: "Invalid emoji" }, 400);
    }
    const userId = c.get("botUser").id;

    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) return unknownChannel(c);

    const message = repos.messages.getById(channelId, messageId);
    if (!message) return unknownMessage(c);

    const removed = repos.reactions.remove(messageId, userId, emoji);
    if (removed) {
      const count = repos.reactions.getCount(messageId, emoji);
      dispatcher?.reactionRemove(channelId, messageId, userId, emoji, channel.guild_id, count);
    }

    return c.body(null, 204);
  });

  // GET /channels/:channelId/messages/:messageId/reactions/:emoji
  app.get("/channels/:channelId/messages/:messageId/reactions/:emoji", (c) => {
    const channelId = c.req.param("channelId");
    const messageId = c.req.param("messageId");
    const emoji = c.req.param("emoji");

    if (!emoji || emoji.length > 64) {
      return c.json({ message: "Invalid emoji" }, 400);
    }
    const userId = c.get("botUser").id;

    const channel = requireGuildMember(repos, channelId, userId);
    if (!channel) return unknownChannel(c);

    const message = repos.messages.getById(channelId, messageId);
    if (!message) return unknownMessage(c);

    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "25", 10) || 25, 1), 100);
    const after = c.req.query("after") || undefined;

    const users = repos.reactions.getUsersForReaction(messageId, emoji, limit, after);

    return c.json(users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar,
      discriminator: "0",
      global_name: null,
      bot: !!u.bot,
    })));
  });

  return app;
}
