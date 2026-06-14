import type Database from "better-sqlite3";
import { MessagesRepo } from "./messages.js";
import { ChannelsRepo } from "./channels.js";
import { UsersRepo } from "./users.js";
import { MembersRepo } from "./members.js";
import { GuildsRepo } from "./guilds.js";
import { ReadStatesRepo } from "./readStates.js";
import { ReactionsRepo } from "./reactions.js";
import { WebhooksRepo } from "./webhooks.js";
import { PermissionsRepo } from "./permissions.js";
import { ChannelFilesRepo } from "./channel-files.js";
import { ThreadsRepo } from "./threads.js";

export { MessagesRepo, ChannelsRepo, UsersRepo, MembersRepo, GuildsRepo, ReadStatesRepo, ReactionsRepo, WebhooksRepo, PermissionsRepo, ChannelFilesRepo, ThreadsRepo };

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
  permissions: PermissionsRepo;
  channelFiles: ChannelFilesRepo;
  threads: ThreadsRepo;
}

export function createRepos(db: Database.Database): Repos {
  const reactions = new ReactionsRepo(db);
  const permissions = new PermissionsRepo(db);
  const channels = new ChannelsRepo(db);
  channels.setPermissionsRepo(permissions);
  return {
    db,
    messages: new MessagesRepo(db, reactions),
    channels,
    users: new UsersRepo(db),
    members: new MembersRepo(db),
    guilds: new GuildsRepo(db),
    readStates: new ReadStatesRepo(db),
    reactions,
    webhooks: new WebhooksRepo(db),
    permissions,
    channelFiles: new ChannelFilesRepo(db),
    threads: new ThreadsRepo(db, channels),
  };
}
