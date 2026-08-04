import { generateSnowflake, type Channel, type Message, type Task, type User } from "@cove/shared";
import type { Repos } from "../repos/index.js";

export interface CreateTaskOccurrenceInput {
  channel: Channel;
  creator: User;
  title: string;
  description?: string;
  assigneeId?: string | null;
  heartbeatIntervalMs?: number;
  recurring?: { id: string; seq: number };
}

export interface TaskOccurrence {
  cardMessage: Message;
  thread: Channel;
  assignmentMessage: Message;
  task: Task;
}

/**
 * Creates an ordinary task's durable records. Call this inside the caller's
 * transaction; callers dispatch the returned records only after it commits.
 */
export function createTaskOccurrence(repos: Repos, input: CreateTaskOccurrenceInput): TaskOccurrence {
  const { channel, creator } = input;
  const title = input.title.trim();
  const assigneeId = input.assigneeId ?? null;
  const seq = repos.tasks.getNextSeq(channel.id);
  const now = Date.now();
  const messageId = generateSnowflake();
  const taskId = generateSnowflake();

  const cardContent = JSON.stringify({ title, status: "open", assignee_id: assigneeId, seq });
  const cardMetadata = JSON.stringify({ content_type: "task", skip_agent_notify: true });
  repos.db.prepare(
    "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(messageId, channel.id, creator.id, creator.username, cardContent, now, cardMetadata, null);
  const cardMessage: Message = {
    id: messageId,
    channel_id: channel.id,
    content: cardContent,
    author: { id: creator.id, username: creator.username, bot: creator.bot, avatar: creator.avatar ?? null, discriminator: creator.discriminator ?? "0", global_name: creator.global_name ?? null },
    timestamp: new Date(now).toISOString(),
    edited_timestamp: null,
    type: 0,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_roles: [],
    pinned: false,
    tts: false,
    mention_everyone: false,
    metadata: cardMetadata,
  };

  const thread = repos.threads.createFromMessage(channel.guild_id, channel.id, messageId, [...title].slice(0, 30).join(""), creator.id);
  if (assigneeId && assigneeId !== creator.id && repos.members.exists(channel.guild_id, assigneeId)) {
    repos.threads.addMember(thread.id, assigneeId);
  }
  if (channel.owner_id && channel.owner_id !== creator.id && channel.owner_id !== assigneeId && repos.members.exists(channel.guild_id, channel.owner_id)) {
    repos.threads.addMember(thread.id, channel.owner_id);
  }

  const task = repos.tasks.create(taskId, channel.id, thread.id, messageId, assigneeId, title, seq, {
    guild_id: channel.guild_id,
    description: input.description ?? "",
    created_by: creator.id,
    recurring_id: input.recurring?.id ?? null,
    recurring_seq: input.recurring?.seq ?? 0,
  });

  const assignmentNow = Date.now();
  const assignmentId = generateSnowflake();
  const assignmentContent = [
    `This is a task assignment (task_id: ${taskId}).`,
    `Title: ${title}`,
    "工作属于这个 thread，就在这里做。",
    `开工时用 cove_task 工具设 status 为 in_progress（action: \"update\", taskId: \"${taskId}\", status: \"in_progress\"）。`,
    "完成后用 cove_task 设 status 为 in_review 并 @通知相关人验收。",
    "不要用 curl 调 REST API，用 cove_task 工具。",
  ].join("\n");
  const assignmentMetadata = JSON.stringify({ content_type: "task_assignment" });
  repos.db.prepare(
    "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(assignmentId, thread.id, creator.id, creator.username, assignmentContent, assignmentNow, assignmentMetadata, null);
  const assignmentMessage: Message = {
    id: assignmentId,
    channel_id: thread.id,
    content: assignmentContent,
    author: { id: "system", username: "System", bot: false, avatar: null, discriminator: "0", global_name: "System" },
    timestamp: new Date(assignmentNow).toISOString(),
    edited_timestamp: null,
    type: 0,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_roles: [],
    pinned: false,
    tts: false,
    mention_everyone: false,
    metadata: assignmentMetadata,
  };

  const heartbeatIntervalMs = input.heartbeatIntervalMs && input.heartbeatIntervalMs > 0 ? input.heartbeatIntervalMs : 300_000;
  const heartbeatLastAt = Date.now();
  repos.tasks.update(taskId, { heartbeat_interval_ms: heartbeatIntervalMs, heartbeat_last_at: heartbeatLastAt });
  task.heartbeat_interval_ms = heartbeatIntervalMs;
  task.heartbeat_last_at = heartbeatLastAt;

  return { cardMessage, thread, assignmentMessage, task };
}
