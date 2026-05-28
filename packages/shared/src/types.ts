/**
 * Cove shared types — used by both server and client packages.
 *
 * Includes Discord-compatible types so the Cove API can be consumed
 * by any client that speaks the Discord REST/Gateway protocol.
 */

// ─── Discord-compatible types ───────────────────────────────────────────────

/** Discord user object (subset relevant to Cove). */
export interface DiscordUser {
  id: string;
  username: string;
  bot: boolean;
}

/** Discord channel object — scenes are mapped to GUILD_TEXT channels. */
export interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0 = GUILD_TEXT
  guild_id: string;
  topic: string;
  position: number;
  // Cove extensions
  icon?: string;
  scene_type?: string;
  cove_position?: { x: number; y: number };
}

/** Discord message object. */
export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: DiscordUser;
  timestamp: string; // ISO 8601
  edited_timestamp?: string | null;
  type: number; // 0 = DEFAULT
}

/** Discord Gateway opcodes. */
export enum GatewayOpcode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  REQUEST_TYPING = 4, // Cove extension: client requests typing broadcast
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

// ─── Cove extension types ───────────────────────────────────────────────────

/** Key-value state entry for a scene (e.g. "flowers_watered_today": "3"). */
export interface SceneState {
  sceneId: string;
  key: string;
  value: string;
  updatedAt: number;
}

/** An agent/character registered in Cove — Discord User compatible. */
export interface CoveAgent {
  id: string;
  username: string;
  avatar: string | null;
  bot: boolean;
  /** Cove extension: agent bio/description. */
  bio?: string | null;
}

/** Guild member — an agent assigned to the Cove guild. Discord GuildMember compatible. */
export interface CoveGuildMember {
  user: CoveAgent;
  nick: string | null;
  roles: string[];
  joined_at: string; // ISO 8601
}
