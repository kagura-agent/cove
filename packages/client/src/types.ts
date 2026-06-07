import type { Channel, Guild, Message, User, CoveAgent, CoveGuildMember } from "@cove/shared";

export type { Channel };
export type { Guild };
export type Author = User;
export type { Message };
export type Bot = CoveAgent;
export type GuildMember = CoveGuildMember;

export interface BotCreateResponse {
  id: string;
  username: string;
  token: string;
  bio?: string;
}
