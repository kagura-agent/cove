/**
 * Cove shared types — used by both server and client packages.
 *
 * Includes Discord-compatible types so the Cove API can be consumed
 * by any client that speaks the Discord REST/Gateway protocol.
 */

/** The versioned API prefix used by all Cove REST endpoints. */
export const API_VERSION = 'v10';
export const API_PREFIX = '/api/v10';

// ─── Discord-compatible types ───────────────────────────────────────────────

/** User object (Discord-compatible). */
export interface User {
  id: string;
  username: string;
  bot: boolean;
  avatar: string | null;
  discriminator: string;
  global_name: string | null;
}

/** A channel-level permission overwrite for a role or member. */
export interface PermissionOverwrite {
  id: string;          // target user or role id
  type: number;        // 0 = role, 1 = member
  allow: string;       // permission bitfield as string (bigint)
  deny: string;        // permission bitfield as string (bigint)
}

export const PermissionFlags = {
  VIEW_CHANNEL: (1n << 10n).toString(),
  SEND_MESSAGES: (1n << 11n).toString(),
  MANAGE_MESSAGES: (1n << 13n).toString(),
  MANAGE_CHANNELS: (1n << 4n).toString(),
  MANAGE_WEBHOOKS: (1n << 29n).toString(),
} as const;

/** Thread metadata — stored as JSON in the channel row. */
export interface ThreadMetadata {
  archived: boolean;
  auto_archive_duration: number; // minutes
  archive_timestamp: string; // ISO 8601
  locked: boolean;
  invitable?: boolean; // whether non-members can be invited
  create_timestamp: string; // ISO 8601
}

/** Channel object — channels are mapped to GUILD_TEXT. */
export interface Channel {
  id: string;
  name: string;
  type: number; // 0 = GUILD_TEXT
  guild_id: string;
  topic: string | null;
  position: number;
  last_message_id: string | null;
  permission_overwrites: PermissionOverwrite[];
  nsfw: boolean;
  rate_limit_per_user: number;
  parent_id?: string | null;
  message_id?: string | null;
  thread_metadata?: ThreadMetadata | null;
  message_count?: number;
  member_count?: number;
  owner_id?: string | null;
  total_message_sent?: number;
}

/** Message object (Discord-compatible). */
export interface Message {
  id: string;
  channel_id: string;
  content: string;
  author: User;
  timestamp: string; // ISO 8601
  edited_timestamp?: string | null;
  type: number; // 0 = DEFAULT
  attachments: unknown[];
  embeds: unknown[];
  mentions: User[];
  mention_roles: string[];
  pinned: boolean;
  tts: boolean;
  mention_everyone: boolean;
  /** Client-generated nonce for optimistic send reconciliation. */
  nonce?: string;
  reactions?: Reaction[];
  webhook_id?: string;
  /** Reference to another message (for replies). */
  message_reference?: { message_id: string; channel_id?: string; guild_id?: string };
  /** The referenced message object (populated by server). */
  referenced_message?: Message | null;
  /** Guild the message belongs to. Present on gateway dispatches; absent on REST responses. */
  guild_id?: string;
  /** Thread spawned from this message (present on parent messages that have threads). */
  thread?: Channel | null;
}

/** A reaction summary for a message. */
export interface Reaction {
  emoji: { id: string | null; name: string };
  count: number;
  me: boolean;
}

/** Discord Gateway opcodes. */
export enum GatewayOpcode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  /** Reserved — not used by Cove. Locked out to prevent accidental sends. */
  VOICE_STATE_UPDATE = 4,
  RESUME = 6,
  RECONNECT = 7,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

/** Discord Gateway payload shape. */
export interface GatewayPayload {
  op: GatewayOpcode;
  d: unknown;
  s?: number | null; // sequence number (DISPATCH only)
  t?: string | null; // event name (DISPATCH only)
}

/** Guild object (Discord-compatible). */
export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string | null;
  features: string[];
}

// ─── Cove extension types ───────────────────────────────────────────────────

/** An agent/character registered in Cove — Discord User compatible. */
export interface CoveAgent {
  id: string;
  username: string;
  avatar: string | null;
  bot: boolean;
  discriminator: string;
  global_name: string | null;
  /** Cove extension: agent bio/description. */
  bio?: string | null;
}

export interface PresenceUpdate {
  user: { id: string };
  status: "online" | "offline";
}

/** Guild member — an agent assigned to the Cove guild. Discord GuildMember compatible. */
export interface CoveGuildMember {
  user: CoveAgent;
  nick: string | null;
  roles: string[];
  joined_at: string; // ISO 8601
}

/** Webhook object (Discord-compatible). */
export interface Webhook {
  id: string;
  channel_id: string;
  guild_id: string;
  name: string;
  avatar: string | null;
  token?: string;
}

/** A thread member entry. */
export interface ThreadMember {
  id?: string; // thread id
  user_id?: string;
  join_timestamp: string; // ISO 8601
  flags: number; // default 0
}
