import type Database from "better-sqlite3";
import { generateSnowflake, type Channel, type ThreadMetadata, type ThreadMember } from "@cove/shared";
import type { ChannelsRepo } from "./channels.js";

export class ThreadsRepo {
  constructor(private db: Database.Database, private channelsRepo: ChannelsRepo) {}

  /** Create a thread from a message. */
  createFromMessage(guildId: string, parentChannelId: string, messageId: string, name: string, ownerId: string, autoArchiveDuration?: number): Channel {
    return this.createThread(guildId, parentChannelId, messageId, name, ownerId, autoArchiveDuration);
  }

  /** Create a standalone thread (not attached to a specific message). */
  createStandalone(guildId: string, parentChannelId: string, name: string, ownerId: string, autoArchiveDuration?: number): Channel {
    return this.createThread(guildId, parentChannelId, null, name, ownerId, autoArchiveDuration);
  }

  /** List active (non-archived) threads in a channel. */
  listActiveByChannel(channelId: string): Channel[] {
    const rows = this.db.prepare(
      "SELECT * FROM channels WHERE parent_id = ? AND type = 11 AND json_extract(thread_metadata, '$.archived') = 0"
    ).all(channelId) as ChannelRow[];
    return rows.map(toChannel);
  }

  /** List active threads in a guild. */
  listActiveByGuild(guildId: string): Channel[] {
    const rows = this.db.prepare(
      "SELECT * FROM channels WHERE guild_id = ? AND type = 11 AND json_extract(thread_metadata, '$.archived') = 0"
    ).all(guildId) as ChannelRow[];
    return rows.map(toChannel);
  }

  /** Archive or unarchive a thread. Returns updated channel or null. */
  setArchived(threadId: string, archived: boolean): Channel | null {
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ? AND type = 11").get(threadId) as ChannelRow | undefined;
    if (!row || !row.thread_metadata) return null;

    const metadata: ThreadMetadata = JSON.parse(row.thread_metadata);
    metadata.archived = archived;
    if (archived) {
      metadata.archive_timestamp = new Date().toISOString();
    }

    this.db.prepare("UPDATE channels SET thread_metadata = ? WHERE id = ?").run(JSON.stringify(metadata), threadId);
    return this.channelsRepo.getById(threadId);
  }

  /** Lock or unlock a thread. Returns updated channel or null. */
  setLocked(threadId: string, locked: boolean): Channel | null {
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ? AND type = 11").get(threadId) as ChannelRow | undefined;
    if (!row || !row.thread_metadata) return null;

    const metadata: ThreadMetadata = JSON.parse(row.thread_metadata);
    metadata.locked = locked;

    this.db.prepare("UPDATE channels SET thread_metadata = ? WHERE id = ?").run(JSON.stringify(metadata), threadId);
    return this.channelsRepo.getById(threadId);
  }

  /** Add a member to a thread. Returns true if newly added. */
  addMember(threadId: string, userId: string): boolean {
    const joinTimestamp = new Date().toISOString();
    const result = this.db.prepare(
      "INSERT OR IGNORE INTO thread_members (thread_id, user_id, join_timestamp) VALUES (?, ?, ?)"
    ).run(threadId, userId, joinTimestamp);

    if (result.changes > 0) {
      this.db.prepare("UPDATE channels SET member_count = member_count + 1 WHERE id = ?").run(threadId);
      return true;
    }
    return false;
  }

  /** Remove a member from a thread. Returns true if removed. */
  removeMember(threadId: string, userId: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM thread_members WHERE thread_id = ? AND user_id = ?"
    ).run(threadId, userId);

    if (result.changes > 0) {
      this.db.prepare("UPDATE channels SET member_count = MAX(member_count - 1, 0) WHERE id = ?").run(threadId);
      return true;
    }
    return false;
  }

  /** List members of a thread. */
  listMembers(threadId: string): ThreadMember[] {
    const rows = this.db.prepare(
      "SELECT thread_id, user_id, join_timestamp FROM thread_members WHERE thread_id = ?"
    ).all(threadId) as ThreadMemberRow[];
    return rows.map((r) => ({
      id: r.thread_id,
      user_id: r.user_id,
      join_timestamp: r.join_timestamp,
    }));
  }

  /** Check if user is a thread member. */
  isMember(threadId: string, userId: string): boolean {
    return !!this.db.prepare(
      "SELECT 1 FROM thread_members WHERE thread_id = ? AND user_id = ?"
    ).get(threadId, userId);
  }

  /** Increment message_count and total_message_sent for a thread. */
  incrementMessageCount(threadId: string): void {
    this.db.prepare(
      "UPDATE channels SET message_count = message_count + 1, total_message_sent = total_message_sent + 1 WHERE id = ? AND type = 11"
    ).run(threadId);
  }

  /** Decrement message_count (on message delete, floor at 0). */
  decrementMessageCount(threadId: string): void {
    this.db.prepare(
      "UPDATE channels SET message_count = MAX(message_count - 1, 0) WHERE id = ? AND type = 11"
    ).run(threadId);
  }

  /** Get thread info to attach to parent message. Returns { id, name, message_count } or null. */
  getThreadForMessage(messageId: string): { id: string; name: string; message_count: number } | null {
    const row = this.db.prepare(
      "SELECT id, name, message_count FROM channels WHERE message_id = ? AND type = 11 LIMIT 1"
    ).get(messageId) as { id: string; name: string; message_count: number } | undefined;
    return row ?? null;
  }

  private createThread(
    guildId: string,
    parentChannelId: string,
    messageId: string | null,
    name: string,
    ownerId: string,
    autoArchiveDuration?: number,
  ): Channel {
    const id = generateSnowflake();
    const now = new Date().toISOString();
    const metadata: ThreadMetadata = {
      archived: false,
      auto_archive_duration: autoArchiveDuration ?? 1440,
      archive_timestamp: now,
      locked: false,
      create_timestamp: now,
    };

    this.db.prepare(
      `INSERT INTO channels (id, guild_id, name, type, topic, position, parent_id, message_id, owner_id, thread_metadata, message_count, member_count, total_message_sent)
       VALUES (?, ?, ?, 11, NULL, 0, ?, ?, ?, ?, 0, 0, 0)`
    ).run(id, guildId, name, parentChannelId, messageId, ownerId, JSON.stringify(metadata));

    // Auto-add owner as thread member
    this.addMember(id, ownerId);

    return this.channelsRepo.getById(id)!;
  }
}

interface ChannelRow {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  topic: string | null;
  position: number;
  last_message_id: string | null;
  parent_id: string | null;
  message_id: string | null;
  thread_metadata: string | null;
  message_count: number;
  member_count: number;
  owner_id: string | null;
  total_message_sent: number;
}

interface ThreadMemberRow {
  thread_id: string;
  user_id: string;
  join_timestamp: string;
}

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    guild_id: row.guild_id,
    topic: row.topic,
    position: row.position,
    last_message_id: row.last_message_id,
    permission_overwrites: [],
    nsfw: false,
    rate_limit_per_user: 0,
    parent_id: row.parent_id ?? undefined,
    message_id: row.message_id ?? undefined,
    thread_metadata: row.thread_metadata ? JSON.parse(row.thread_metadata) : undefined,
    message_count: row.message_count ?? undefined,
    member_count: row.member_count ?? undefined,
    owner_id: row.owner_id ?? undefined,
    total_message_sent: row.total_message_sent ?? undefined,
  };
}
