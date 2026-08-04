import type { RecurringTask } from "@cove/shared";
import type { Repos } from "../repos/index.js";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";

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
    console.log(`Recurring task worker started (tick every ${TICK_MS / 1000}s)`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    try {
      const now = Date.now();
      for (const template of this.repos.recurringTasks.listEnabled()) {
        if (this.shouldSpawn(template, now)) this.spawnTask(template);
      }
    } catch (error) {
      console.error("Recurring task tick error:", error);
    }
  }

  private shouldSpawn(template: RecurringTask, now: number): boolean {
    if (!template.last_task_id) return true;
    const lastTask = this.repos.tasks.getById(template.last_task_id);
    if (!lastTask || (lastTask.status !== "done" && lastTask.status !== "cancelled")) return false;
    if (template.schedule_type === "on_complete") return true;
    return lastTask.updated_at + template.interval_ms <= now;
  }

  private spawnTask(template: RecurringTask): void {
    const channel = this.repos.channels.getById(template.channel_id);
    const creator = this.repos.users.getById(template.created_by);
    if (!channel || !creator || !this.repos.members.exists(channel.guild_id, creator.id)) {
      console.error(`Recurring task ${template.id} cannot spawn because its channel or creator is unavailable`);
      return;
    }

    try {
      const result = this.repos.db.transaction(() => {
        const latestTemplate = this.repos.recurringTasks.getById(template.id);
        if (!latestTemplate || !latestTemplate.enabled || !this.shouldSpawn(latestTemplate, Date.now())) return null;

        const previous = latestTemplate.last_task_id ? this.repos.tasks.getById(latestTemplate.last_task_id) : null;
        const recurringSeq = previous ? previous.recurring_seq + 1 : 1;
        const occurrence = createTaskOccurrence(this.repos, {
          channel,
          creator,
          title: latestTemplate.title,
          description: latestTemplate.description,
          assigneeId: latestTemplate.assignee_id,
          heartbeatIntervalMs: latestTemplate.heartbeat_interval_ms,
          recurring: { id: latestTemplate.id, seq: recurringSeq },
        });
        this.repos.recurringTasks.update(latestTemplate.id, {
          last_task_id: occurrence.task.task_id,
          last_spawned_at: Date.now(),
        });
        return occurrence;
      })();
      if (!result) return;
      this.dispatcher.messageCreate(result.cardMessage);
      this.dispatcher.threadCreate(result.thread);
      this.dispatcher.messageCreate(result.assignmentMessage);
      this.dispatcher.taskCreated(result.task);
    } catch (error) {
      console.error(`Recurring task ${template.id} spawn error:`, error);
    }
  }
}
