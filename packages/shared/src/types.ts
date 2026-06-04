/**
 * Cove shared types — used by both server and client packages.
 *
 * Includes Discord-compatible types so the Cove API can be consumed
 * by any client that speaks the Discord REST/Gateway protocol.
 */

// ─── Discord-compatible types ───────────────────────────────────────────────

/** User object (Discord-compatible). */
export interface User {
  id: string;
  username: string;
  bot: boolean;
}

/** Channel object — channels are mapped to GUILD_TEXT. */
export interface Channel {
  id: string;
  name: string;
  type: number; // 0 = GUILD_TEXT
  guild_id: string;
  topic: string | null;
  position: number;
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
}

/** Discord Gateway opcodes. */
export enum GatewayOpcode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  REQUEST_TYPING = 4,
  RESUME = 6,
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
}

// ─── Cove extension types ───────────────────────────────────────────────────

/** An agent/character registered in Cove — Discord User compatible. */
export interface CoveAgent {
  id: string;
  username: string;
  avatar: string | null;
  bot: boolean;
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
