import type Database from "better-sqlite3";
import { MessagesRepo } from "./messages.js";
import { ChannelsRepo } from "./channels.js";
import { StateRepo } from "./state.js";
import { UsersRepo } from "./users.js";
import { MembersRepo } from "./members.js";

export { MessagesRepo, ChannelsRepo, StateRepo, UsersRepo, MembersRepo };

export const DEFAULT_GUILD_ID = "cove";

export interface Repos {
  messages: MessagesRepo;
  channels: ChannelsRepo;
  state: StateRepo;
  users: UsersRepo;
  members: MembersRepo;
}

export function createRepos(db: Database.Database): Repos {
  return {
    messages: new MessagesRepo(db),
    channels: new ChannelsRepo(db),
    state: new StateRepo(db),
    users: new UsersRepo(db),
    members: new MembersRepo(db),
  };
}
