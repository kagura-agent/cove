import { dispatcher } from "./gateway-dispatcher";
import type { GatewayEventMap } from "./gateway-dispatcher";
import { useMessageStore } from "../stores/useMessageStore";
import { useChannelStore } from "../stores/useChannelStore";
import { usePresenceStore } from "../stores/usePresenceStore";
import { useReadStateStore } from "../stores/useReadStateStore";
import { useUserStore } from "../stores/useUserStore";
import { useTypingStore, typingTimeoutIds } from "../stores/useTypingStore";
import { useGuildStore } from "../stores/useGuildStore";
import { useMemberStore } from "../stores/useMemberStore";
import { useReplyStore } from "../stores/useReplyStore";
import { useChannelFilesStore } from "../stores/useChannelFilesStore";
import { useThreadStore } from "../stores/useThreadStore";
import type { Channel } from "../types";
import * as api from "./api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handlers: Array<{ event: keyof GatewayEventMap; handler: (data: any) => void }> = [];
// Track which messages have already incremented mention count (prevents double-counting on MESSAGE_UPDATE)
const mentionedMessageIds = new Set<string>();

function subscribe<K extends keyof GatewayEventMap>(event: K, handler: (data: GatewayEventMap[K]) => void): void {
  dispatcher.on(event, handler);
  handlers.push({ event, handler });
}

export function setupGatewaySubscriptions(): void {
  teardownGatewaySubscriptions();

  subscribe("MESSAGE_CREATE", (msg) => {
    const store = useMessageStore.getState();

    // Nonce reconciliation: if this message has a nonce matching a pending message, replace it
    if (msg.nonce) {
      const channelMsgs = store.messages[msg.channel_id] ?? [];
      const hasPending = channelMsgs.some((m) => m.nonce === msg.nonce && store.pendingStatus[m.id]);
      if (hasPending) {
        store.reconcilePending(msg.channel_id, msg.nonce, msg);
        useTypingStore.getState().clearTyping(msg.channel_id, msg.author.id);
        return;
      }
    }

    store.addMessage(msg.channel_id, msg);
    useTypingStore.getState().clearTyping(msg.channel_id, msg.author.id);

    // Mark channel unread if the message is from someone else and not the active channel
    const selfId = useUserStore.getState().id;
    const activeChannelId = useChannelStore.getState().activeChannelId;
    if (msg.author.id !== selfId && msg.channel_id !== activeChannelId) {
      useReadStateStore.getState().setUnread(msg.channel_id);
      // Mark mentioned if current user is in mentions
      if (selfId && msg.mentions?.some((u: { id: string }) => u.id === selfId)) {
        mentionedMessageIds.add(msg.id);
        useReadStateStore.getState().setMentioned(msg.channel_id);
      }
    }

    // Auto-ack incoming messages in the active channel from other users
    if (msg.author.id !== selfId && msg.channel_id === activeChannelId) {
      api.ackMessage(msg.channel_id, msg.id).catch(() => {});
    }
  });

  subscribe("MESSAGE_UPDATE", (msg) => {
    useMessageStore.getState().updateMessage(msg.channel_id, msg.id, msg.content, msg.edited_timestamp, msg.mentions);
    // Check if an edit added a mention of the current user (draft streaming)
    // Only increment if this message hasn't already been counted as a mention
    const selfId = useUserStore.getState().id;
    const activeChannelId = useChannelStore.getState().activeChannelId;
    if (selfId && msg.channel_id !== activeChannelId && msg.mentions?.some((u: { id: string }) => u.id === selfId)) {
      if (!mentionedMessageIds.has(msg.id)) {
        mentionedMessageIds.add(msg.id);
        useReadStateStore.getState().setMentioned(msg.channel_id);
      }
    }
  });

  subscribe("MESSAGE_DELETE", (data) => {
    useMessageStore.getState().removeMessage(data.channel_id, data.id);
    useReplyStore.getState().clearReplyForDeletedMessage(data.channel_id, data.id);
  });

  subscribe("MESSAGE_DELETE_BULK", (data) => {
    const store = useMessageStore.getState();
    const replyStore = useReplyStore.getState();
    for (const id of data.ids) {
      store.removeMessage(data.channel_id, id);
      replyStore.clearReplyForDeletedMessage(data.channel_id, id);
    }
  });

  subscribe("TYPING_START", (data) => {
    const selfId = useUserStore.getState().id;
    if (data.user_id === selfId) return;
    useTypingStore.getState().clearTyping(data.channel_id, data.user_id);
    const timeout = setTimeout(() => {
      typingTimeoutIds.delete(timeout);
      useTypingStore.getState().clearTyping(data.channel_id, data.user_id);
    }, 8000);
    typingTimeoutIds.add(timeout);
    useTypingStore.setState((s) => {
      const existing = s.typingUsers[data.channel_id] ?? [];
      return {
        typingUsers: {
          ...s.typingUsers,
          [data.channel_id]: [
            ...existing,
            { userId: data.user_id, username: data.username ?? data.user_id, timeout },
          ],
        },
      };
    });
  });

  subscribe("PRESENCE_UPDATE", (data) => {
    if (data.status === "online") {
      usePresenceStore.getState().setOnline(data.user.id);
    } else {
      usePresenceStore.getState().setOffline(data.user.id);
    }
  });

  subscribe("READY", (data) => {
    if (data.user) {
      useUserStore.getState().setUser(data.user);
    }

    // Seed GuildStore and guild-scoped channels
    if (data.guilds?.length) {
      const guildStore = useGuildStore.getState();
      const channelStore = useChannelStore.getState();

      // Extract guild objects (without channels) for GuildStore
      const guilds = data.guilds.map(({ channels: _channels, ...guild }) => guild);
      guildStore.setGuilds(guilds);
      guildStore.setActiveGuild(guilds[0].id);

      // Seed channels per guild
      for (const guild of data.guilds) {
        if (guild.channels) {
          channelStore.setChannels(guild.id, guild.channels);
        }

        // Fetch active threads for entire guild in one call
        api.fetchGuildActiveThreads(guild.id).then(({ threads }) => {
          const byParent: Record<string, Channel[]> = {};
          for (const t of threads) {
            if (t.parent_id) {
              (byParent[t.parent_id] ??= []).push(t);
            }
          }
          for (const [parentId, parentThreads] of Object.entries(byParent)) {
            useThreadStore.getState().setThreads(parentId, parentThreads);
          }
        }).catch(() => {});
      }

      // Auto-select first channel of active guild
      const activeGuildChannels = data.guilds[0].channels ?? [];
      if (activeGuildChannels.length > 0 && !channelStore.activeChannelId) {
        channelStore.setActiveChannel(activeGuildChannels[0].id);
      }

      // Pre-fetch members for all guilds (needed for @mention autocomplete)
      for (const guild of guilds) {
        useMemberStore.getState().fetchMembers(guild.id).catch(() => {});
      }
    }

    if (data.presences) {
      usePresenceStore.getState().initPresences(
        data.presences.filter((p) => p.status === "online").map((p) => p.user.id),
      );
    }
    if (data.read_state) {
      useReadStateStore.getState().initReadStates(data.read_state);
    }
  });

  subscribe("MESSAGE_ACK", (data) => {
    useReadStateStore.getState().markRead(data.channel_id, data.message_id);
  });

  subscribe("CHANNEL_CREATE", (channel) => {
    useChannelStore.getState().addChannel(channel);
  });

  subscribe("CHANNEL_UPDATE", (channel) => {
    useChannelStore.getState().updateChannel(channel);
  });

  subscribe("CHANNEL_DELETE", (data) => {
    useChannelStore.getState().removeChannel(data.id);
    useMessageStore.getState().removeChannelMessages(data.id);
    useReadStateStore.getState().removeChannel(data.id);
    useTypingStore.getState().removeChannel(data.id);
  });

  // GUILD_CREATE/DELETE: guild lifecycle events
  subscribe("GUILD_CREATE", (data) => {
    useGuildStore.getState().addGuild({ id: data.id, name: data.name, icon: null, owner_id: null, features: [] });
  });

  subscribe("GUILD_DELETE", (data) => {
    useGuildStore.getState().removeGuild(data.id);
    useChannelStore.getState().removeGuildChannels(data.id);
  });

  // GUILD_MEMBER_ADD/REMOVE: membership events
  subscribe("GUILD_MEMBER_ADD", (data) => {
    useMemberStore.getState().upsertMember(data.guild_id, {
      user: { id: data.user.id, username: data.user.id, avatar: null, bot: false, discriminator: "0", global_name: null },
      nick: data.nick,
      roles: data.roles,
      joined_at: data.joined_at,
    });
  });

  subscribe("GUILD_MEMBER_REMOVE", (data) => {
    useMemberStore.getState().removeMember(data.guild_id, data.user.id);
  });

  subscribe("MESSAGE_REACTION_ADD", (data) => {
    const selfId = useUserStore.getState().id;
    const me = data.user_id === selfId;
    useMessageStore.getState().addReaction(data.channel_id, data.message_id, data.emoji.name, me, data.count);
  });

  subscribe("MESSAGE_REACTION_REMOVE", (data) => {
    const selfId = useUserStore.getState().id;
    const me = data.user_id === selfId;
    useMessageStore.getState().removeReaction(data.channel_id, data.message_id, data.emoji.name, me, data.count);
  });

  subscribe("CHANNEL_FILE_CREATE", (data) => {
    const store = useChannelFilesStore.getState();
    const activeChannelId = useChannelStore.getState().activeChannelId;
    if (store.filesOpen && data.channel_id === activeChannelId) {
      store.fetchFiles(data.channel_id);
    }
  });

  subscribe("CHANNEL_FILE_UPDATE", (data) => {
    const store = useChannelFilesStore.getState();
    const activeChannelId = useChannelStore.getState().activeChannelId;
    if (store.filesOpen && data.channel_id === activeChannelId) {
      store.fetchFiles(data.channel_id);
      if (store.selectedFile === data.filename) {
        store.fetchFile(data.channel_id, data.filename);
      }
    }
  });

  subscribe("CHANNEL_FILE_DELETE", (data) => {
    const store = useChannelFilesStore.getState();
    const activeChannelId = useChannelStore.getState().activeChannelId;
    if (store.filesOpen && data.channel_id === activeChannelId) {
      store.fetchFiles(data.channel_id);
      if (store.selectedFile === data.filename) {
        store.clearFileContent();
      }
    }
  });

  // Thread events
  subscribe("THREAD_CREATE", (thread) => {
    useThreadStore.getState().addThread(thread);
    if (thread.parent_id) {
      // Thread ID = message ID in Discord convention
      const messageId = thread.message_id ?? thread.id;
      useMessageStore.getState().setMessageThread(thread.parent_id, messageId, thread);
    }
  });

  subscribe("THREAD_UPDATE", (thread) => {
    // Remove archived threads from sidebar
    if (thread.thread_metadata?.archived) {
      useThreadStore.getState().removeThread(thread.id);
    } else {
      useThreadStore.getState().updateThread(thread);
    }
  });

  subscribe("THREAD_DELETE", (data) => {
    useThreadStore.getState().removeThread(data.id);
  });
}

export function teardownGatewaySubscriptions(): void {
  for (const { event, handler } of handlers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatcher.off(event as any, handler);
  }
  handlers = [];
  for (const id of typingTimeoutIds) {
    clearTimeout(id);
  }
  typingTimeoutIds.clear();
  mentionedMessageIds.clear();
}
