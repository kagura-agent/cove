export const routes = {
  channel: (guildId: string, channelId: string) => `/channels/${guildId}/${channelId}`,
  thread: (guildId: string, channelId: string, threadId: string) => `/channels/${guildId}/${channelId}/threads/${threadId}`,
  root: () => "/",
} as const;
