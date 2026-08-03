import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import { generateSnowflake, type Message, type RecurringTask } from "@cove/shared";

const TICK_MS = parseInt(process.env["RECURRING_TASK_TICK_MS"] ?? "30000", 10);

export class RecurringTaskWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private repos: Repos,
    private dispatcher: GatewayDispatcher,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
    console.log(`🔁 Recurring task worker started (tick every ${TICK_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    try {
      const templates = this.repos.recurringTasks.listEnabled();
      if (templates.length === 0) return;

      const now = Date.now();

      for (const template of templates) {
        if (this.shouldSpawn(template, now)) {
          this.spawnTask(template);
        }
      }
    } catch (err) {
      console.error("🔁 Recurring task tick error:", err);
    }
  }

  private shouldSpawn(template: RecurringTask, now: number): boolean {
    // If there's an active previous instance, skip (overlap protection)
    if (template.last_task_id) {
      const lastTask = this.repos.tasks.getById(template.last_task_id);
      if (lastTask && lastTask.status !== "done" && lastTask.status !== "cancelled") {
        return false;
      }
    }

    if (template.schedule_type === "on_complete") {
      // Spawn when last task is done/cancelled, or first run (no last_task_id)
      return true;
    }

    if (template.schedule_type === "interval") {
      return (template.last_spawned_at + template.interval_ms) <= now;
    }

    return false;
  }

  private spawnTask(template: RecurringTask): void {
    try {
      const channel = this.repos.channels.getById(template.channel_id);
      if (!channel) {
        console.error(`🔁 Recurring task ${template.id}: channel ${template.channel_id} not found`);
        return;
      }

      const creator = this.repos.users.getById(template.created_by);
      if (!creator) {
        console.error(`🔁 Recurring task ${template.id}: creator ${template.created_by} not found`);
        return;
      }

      // Count previous instances to determine recurring_seq
      const lastTask = template.last_task_id ? this.repos.tasks.getById(template.last_task_id) : null;
      const recurringSeq = lastTask ? (lastTask.recurring_seq ?? 0) + 1 : 1;

      const result = this.repos.db.transaction(() => {
        const seq = this.repos.tasks.getNextSeq(template.channel_id);
        const now = Date.now();
        const messageId = generateSnowflake();
        const taskId = generateSnowflake();
        const title = template.title;

        // 1. Card message
        const cardContent = JSON.stringify({ title, status: "open", assignee_id: template.assignee_id, seq });
        const cardMetadata = JSON.stringify({ content_type: "task", skip_agent_notify: true });
        this.repos.db.prepare(
          "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(messageId, template.channel_id, creator.id, creator.username, cardContent, now, cardMetadata, null);
        const cardMessage: Message = {
          id: messageId,
          channel_id: template.channel_id,
          content: cardContent,
          author: { id: creator.id, username: creator.username, bot: (creator as any).bot ?? false, avatar: (creator as any).avatar ?? null, discriminator: (creator as any).discriminator ?? "0", global_name: (creator as any).global_name ?? null },
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

        // 2. Thread from card message
        const threadName = [...title].slice(0, 30).join("");
        const thread = this.repos.threads.createFromMessage(
          channel.guild_id,
          template.channel_id,
          messageId,
          threadName,
          creator.id,
        );

        // 3. Add assignee to thread members
        if (template.assignee_id && template.assignee_id !== creator.id) {
          this.repos.threads.addMember(thread.id, template.assignee_id);
        }
        if (channel.owner_id && channel.owner_id !== creator.id && channel.owner_id !== template.assignee_id) {
          if (this.repos.members.exists(channel.guild_id, channel.owner_id)) {
            this.repos.threads.addMember(thread.id, channel.owner_id);
          }
        }

        // 4. Assignment message in thread
        const assignmentNow = Date.now();
        const assignmentId = generateSnowflake();
        const preamble = [
          `This is a task assignment (task_id: ${taskId}).`,
          `Title: ${title}`,
          `工作属于这个 thread，就在这里做。`,
          `开工时用 cove_task 工具设 status 为 in_progress（action: "update", taskId: "${taskId}", status: "in_progress"）。`,
          `完成后用 cove_task 设 status 为 in_review 并 @通知相关人验收。`,
          `不要用 curl 调 REST API，用 cove_task 工具。`,
        ].join("\n");
        const assignmentContent = preamble;
        const assignmentMetadata = JSON.stringify({ content_type: "task_assignment" });
        this.repos.db.prepare(
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

        // 5. Task row
        const task = this.repos.tasks.create(taskId, template.channel_id, thread.id, messageId, template.assignee_id, title, seq, {
          guild_id: channel.guild_id,
          description: template.description,
          created_by: creator.id,
          recurring_id: template.id,
          recurring_seq: recurringSeq,
        });

        // Set heartbeat
        const heartbeatMs = template.heartbeat_interval_ms > 0 ? template.heartbeat_interval_ms : 300000;
        this.repos.tasks.update(taskId, { heartbeat_interval_ms: heartbeatMs, heartbeat_last_at: Date.now() });
        task.heartbeat_interval_ms = heartbeatMs;
        task.heartbeat_last_at = Date.now();

        // Update recurring task template
        this.repos.recurringTasks.update(template.id, {
          last_task_id: taskId,
          last_spawned_at: Date.now(),
        });

        return { cardMessage, thread, assignmentMessage, task };
      })();

      // Broadcast outside transaction
      this.dispatcher.messageCreate(result.cardMessage);
      this.dispatcher.threadCreate(result.thread);
      this.dispatcher.messageCreate(result.assignmentMessage);
      this.dispatcher.taskCreated(result.task);

      console.log(`🔁 Recurring task ${template.id}: spawned task instance #${recurringSeq} (${result.task.task_id})`);
    } catch (err) {
      console.error(`🔁 Recurring task ${template.id}: spawn error:`, err);
    }
  }
}
