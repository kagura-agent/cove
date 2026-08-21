export const routes = {
  channel: (guildId: string, channelId: string) => `/channels/${guildId}/${channelId}`,
  thread: (guildId: string, channelId: string, threadId: string) => `/channels/${guildId}/${channelId}/threads/${threadId}`,
  guildTasks: (guildId: string) => `/guilds/${guildId}/tasks`,
  guildOverview: (guildId: string) => `/guilds/${guildId}/overview`,
  root: () => "/",
} as const;
