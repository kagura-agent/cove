import type { DiscordChannel, DiscordMessage, DiscordUser, CoveAgent } from "@cove/shared";

export type Channel = DiscordChannel;
export type Author = DiscordUser;
export type Message = DiscordMessage;
export type Bot = CoveAgent;

export interface BotCreateResponse {
  id: string;
  username: string;
  token: string;
  emoji?: string;
  bio?: string;
}
