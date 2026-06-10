import type Database from "better-sqlite3";
import { MessagesRepo } from "./messages.js";
import { ChannelsRepo } from "./channels.js";
import { UsersRepo } from "./users.js";
import { MembersRepo } from "./members.js";
import { GuildsRepo } from "./guilds.js";
import { ReadStatesRepo } from "./readStates.js";
import { ReactionsRepo } from "./reactions.js";
import { WebhooksRepo } from "./webhooks.js";

export { MessagesRepo, ChannelsRepo, UsersRepo, MembersRepo, GuildsRepo, ReadStatesRepo, ReactionsRepo, WebhooksRepo };

export interface Repos {
  db: Database.Database;
  messages: MessagesRepo;
  channels: ChannelsRepo;
  users: UsersRepo;
  members: MembersRepo;
  guilds: GuildsRepo;
  readStates: ReadStatesRepo;
  reactions: ReactionsRepo;
  webhooks: WebhooksRepo;
}

export function createRepos(db: Database.Database): Repos {
  const reactions = new ReactionsRepo(db);
  return {
    db,
    messages: new MessagesRepo(db, reactions),
    channels: new ChannelsRepo(db),
    users: new UsersRepo(db),
    members: new MembersRepo(db),
    guilds: new GuildsRepo(db),
    readStates: new ReadStatesRepo(db),
    reactions,
    webhooks: new WebhooksRepo(db),
  };
}
