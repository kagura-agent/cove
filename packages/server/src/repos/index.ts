import type Database from "better-sqlite3";
import { MessagesRepo } from "./messages.js";
import { ChannelsRepo } from "./channels.js";
import { UsersRepo } from "./users.js";
import { MembersRepo } from "./members.js";
import { GuildsRepo } from "./guilds.js";
import { ReadStatesRepo } from "./readStates.js";

export { MessagesRepo, ChannelsRepo, UsersRepo, MembersRepo, GuildsRepo, ReadStatesRepo };

export interface Repos {
  messages: MessagesRepo;
  channels: ChannelsRepo;
  users: UsersRepo;
  members: MembersRepo;
  guilds: GuildsRepo;
  readStates: ReadStatesRepo;
}

export function createRepos(db: Database.Database): Repos {
  return {
    messages: new MessagesRepo(db),
    channels: new ChannelsRepo(db),
    users: new UsersRepo(db),
    members: new MembersRepo(db),
    guilds: new GuildsRepo(db),
    readStates: new ReadStatesRepo(db),
  };
}
