import type Database from "better-sqlite3";
import { generateSnowflake, type Message, type Reaction, type User } from "@cove/shared";
import type { ReactionsRepo } from "./reactions.js";

interface MessageRow {
  id: string;
  channel_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  timestamp: number;
  metadata: string | null;
  edited_timestamp: number | null;
  sender_username: string | null;
  sender_bot: number | null;
  webhook_id: string | null;
  referenced_message_id: string | null;
}

const MSG_SELECT = "SELECT m.*, u.username AS sender_username, u.bot AS sender_bot FROM messages m LEFT JOIN users u ON u.id = m.sender";

function toMessage(row: MessageRow, reactions?: Reaction[]): Message {
  let author: Message["author"];
  if (row.webhook_id) {
    author = {
      id: row.webhook_id,
      username: row.sender_name ?? "Webhook",
      avatar: null,
      bot: true,
      discriminator: "0",
      global_name: null,
    };
  } else if (row.sender) {
    author = {
      id: row.sender,
      username: row.sender_username ?? row.sender_name ?? row.sender,
      bot: row.sender_bot === 1,
      avatar: null,
      discriminator: "0",
      global_name: null,
    };
  } else {
    author = {
      id: "0",
      username: row.sender_name ?? "Deleted Webhook",
      avatar: null,
      bot: true,
      discriminator: "0",
      global_name: null,
    };
  }

  const msg: Message = {
    id: row.id,
    channel_id: row.channel_id,
    content: row.content,
    author,
    timestamp: new Date(row.timestamp).toISOString(),
    edited_timestamp: row.edited_timestamp
      ? new Date(row.edited_timestamp).toISOString()
      : null,
    type: 0,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_roles: [],
    pinned: false,
    tts: false,
    mention_everyone: false,
    reactions: reactions ?? [],
  };
  if (row.webhook_id) {
    msg.webhook_id = row.webhook_id;
  }
  if (row.referenced_message_id) {
    msg.message_reference = { message_id: row.referenced_message_id, channel_id: row.channel_id };
  }
  return msg;
}

/** Extract user IDs from Discord-style mention syntax <@userId> */
function parseMentionIds(content: string): string[] {
  const re = /<@(\d+)>/g;
  const ids: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export class MessagesRepo {
  constructor(private db: Database.Database, private reactionsRepo?: ReactionsRepo) {}

  list(channelId: string, opts: { limit: number; before?: string; after?: string; around?: string }, currentUserId?: string): Message[] {
    const { limit, before, after, around } = opts;
    let rows: MessageRow[];

    if (before) {
      rows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
        .all(channelId, before, limit) as MessageRow[];
    } else if (after) {
      rows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
        .all(channelId, after, limit) as MessageRow[];
    } else if (around) {
      const half = Math.floor(limit / 2);
      const beforeRows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
        .all(channelId, around, half) as MessageRow[];
      const centerRow = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id = ?`)
        .get(channelId, around) as MessageRow | undefined;
      const afterRows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
        .all(channelId, around, half) as MessageRow[];
      rows = [...beforeRows.reverse(), ...(centerRow ? [centerRow] : []), ...afterRows];
    } else {
      rows = this.db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT ?`)
        .all(channelId, limit) as MessageRow[];
    }

    const messages = rows.map(r => toMessage(r));
    if (this.reactionsRepo) {
      const ids = messages.map(m => m.id);
      const reactionMap = this.reactionsRepo.getForMessages(ids, currentUserId);
      for (const msg of messages) {
        msg.reactions = reactionMap.get(msg.id) ?? [];
      }
    }
    // Populate referenced_message for replies
    this.populateReferencedMessages(messages, channelId, currentUserId);
    // Resolve @mentions
    this.resolveMentions(messages);
    return messages;
  }

  getById(channelId: string, messageId: string, currentUserId?: string): Message | null {
    const row = this.db.prepare(`${MSG_SELECT} WHERE m.id = ? AND m.channel_id = ?`)
      .get(messageId, channelId) as MessageRow | undefined;
    if (!row) return null;
    const msg = toMessage(row);
    if (this.reactionsRepo) {
      msg.reactions = this.reactionsRepo.getForMessage(messageId, currentUserId);
    }
    // Populate referenced_message for replies
    if (msg.message_reference?.message_id) {
      const refRow = this.db.prepare(`${MSG_SELECT} WHERE m.id = ? AND m.channel_id = ?`)
        .get(msg.message_reference.message_id, channelId) as MessageRow | undefined;
      msg.referenced_message = refRow ? toMessage(refRow) : null;
    }
    // Resolve @mentions
    this.resolveMentions([msg]);
    return msg;
  }

  create(channelId: string, author: User, content: string, referencedMessageId?: string): Message {
    const now = Date.now();
    const id = generateSnowflake();

    this.db.prepare(
      "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp, referenced_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, author.id, author.username, content, now, null, null, referencedMessageId ?? null);

    const msg: Message = {
      id,
      channel_id: channelId,
      content,
      author: {
        ...author,
        avatar: author.avatar ?? null,
        discriminator: author.discriminator ?? "0",
        global_name: author.global_name ?? null,
      },
      timestamp: new Date(now).toISOString(),
      edited_timestamp: null,
      type: 0,
      attachments: [],
      embeds: [],
      mentions: [],
      mention_roles: [],
      pinned: false,
      tts: false,
      mention_everyone: false,
    };

    if (referencedMessageId) {
      msg.message_reference = { message_id: referencedMessageId, channel_id: channelId };
      // Populate referenced_message
      const refMsg = this.getById(channelId, referencedMessageId);
      msg.referenced_message = refMsg ?? null;
    }

    // Resolve @mentions
    this.resolveMentions([msg]);

    return msg;
  }

  createFromWebhook(channelId: string, webhookId: string, webhookName: string, webhookAvatar: string | null, content: string): Message {
    const now = Date.now();
    const id = generateSnowflake();

    this.db.prepare(
      "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp, webhook_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, null, webhookName, content, now, null, null, webhookId);

    return {
      id,
      channel_id: channelId,
      content,
      author: {
        id: webhookId,
        username: webhookName,
        avatar: webhookAvatar,
        bot: true,
        discriminator: "0",
        global_name: null,
      },
      timestamp: new Date(now).toISOString(),
      edited_timestamp: null,
      type: 0,
      attachments: [],
      embeds: [],
      mentions: [],
      mention_roles: [],
      pinned: false,
      tts: false,
      mention_everyone: false,
      webhook_id: webhookId,
    };
  }

  update(channelId: string, messageId: string, content: string): Message | null {
    const editedTimestamp = Date.now();
    const result = this.db.prepare(
      "UPDATE messages SET content = ?, edited_timestamp = ? WHERE id = ? AND channel_id = ?"
    ).run(content, editedTimestamp, messageId, channelId);

    if (result.changes === 0) return null;

    const row = this.db.prepare(`${MSG_SELECT} WHERE m.id = ? AND m.channel_id = ?`)
      .get(messageId, channelId) as MessageRow;
    const msg = toMessage(row);
    this.resolveMentions([msg]);
    return msg;
  }

  delete(channelId: string, messageId: string): boolean {
    const result = this.db.prepare("DELETE FROM messages WHERE id = ? AND channel_id = ?")
      .run(messageId, channelId);
    return result.changes > 0;
  }

  deleteAll(channelId: string): number {
    const result = this.db.prepare("DELETE FROM messages WHERE channel_id = ?").run(channelId);
    return result.changes;
  }

  /** Batch-populate referenced_message for replies. */
  private populateReferencedMessages(messages: Message[], channelId: string, _currentUserId?: string): void {
    const refIds = new Set<string>();
    for (const msg of messages) {
      if (msg.message_reference?.message_id) {
        refIds.add(msg.message_reference.message_id);
      }
    }
    if (refIds.size === 0) return;

    // Build a map of referenced messages — some may already be in the current batch
    const refMap = new Map<string, Message>();
    for (const msg of messages) {
      if (refIds.has(msg.id)) {
        refMap.set(msg.id, msg);
      }
    }

    // Fetch any referenced messages not in the current batch
    const missing = [...refIds].filter(id => !refMap.has(id));
    if (missing.length > 0) {
      const placeholders = missing.map(() => "?").join(",");
      const rows = this.db.prepare(
        `${MSG_SELECT} WHERE m.id IN (${placeholders}) AND m.channel_id = ?`
      ).all(...missing, channelId) as MessageRow[];
      for (const row of rows) {
        refMap.set(row.id, toMessage(row));
      }
    }

    // Assign referenced_message to each reply
    for (const msg of messages) {
      if (msg.message_reference?.message_id) {
        msg.referenced_message = refMap.get(msg.message_reference.message_id) ?? null;
      }
    }
  }

  /** Resolve <@userId> mentions in message content to User objects.
   *  Only resolves users who are members of the guild the channel belongs to. */
  private resolveMentions(messages: Message[]): void {
    const allIds = new Set<string>();
    const channelIds = new Set<string>();
    for (const msg of messages) {
      channelIds.add(msg.channel_id);
      for (const id of parseMentionIds(msg.content)) {
        allIds.add(id);
      }
    }
    if (allIds.size === 0) return;

    // Get the guild ID from the first channel (all messages in a batch are same channel)
    const channelId = [...channelIds][0];
    const channel = this.db.prepare("SELECT guild_id FROM channels WHERE id = ?").get(channelId) as { guild_id: string } | undefined;
    if (!channel) return;

    const userMap = new Map<string, User>();
    const idList = [...allIds];
    const placeholders = idList.map(() => "?").join(",");
    // Only resolve users who are guild members
    const rows = this.db.prepare(
      `SELECT u.id, u.username, u.bot, u.avatar FROM users u
       INNER JOIN guild_members gm ON gm.user_id = u.id AND gm.guild_id = ?
       WHERE u.id IN (${placeholders})`
    ).all(channel.guild_id, ...idList) as Array<{ id: string; username: string; bot: number; avatar: string | null }>;
    for (const row of rows) {
      userMap.set(row.id, {
        id: row.id,
        username: row.username,
        bot: row.bot === 1,
        avatar: row.avatar,
        discriminator: "0",
        global_name: null,
      });
    }

    for (const msg of messages) {
      const mentionIds = parseMentionIds(msg.content);
      msg.mentions = mentionIds
        .map(id => userMap.get(id))
        .filter((u): u is User => u !== undefined);
    }
  }
}
