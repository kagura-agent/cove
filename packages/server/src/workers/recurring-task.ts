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

  private isCalendarSchedule(template: RecurringTask): boolean {
    return template.interval_ms > 0 && template.next_run_at > 0;
  }

  private nextCalendarRun(template: RecurringTask, now: number): number {
    const elapsedIntervals = Math.floor((now - template.next_run_at) / template.interval_ms) + 1;
    return template.next_run_at + elapsedIntervals * template.interval_ms;
  }

  private shouldSpawn(template: RecurringTask, now: number): boolean {
    return this.isCalendarSchedule(template) && template.next_run_at <= now;
  }

  private spawnTask(template: RecurringTask): void {
    try {
      const result = this.repos.db.transaction(() => {
        const latestTemplate = this.repos.recurringTasks.getById(template.id);
        const now = Date.now();
        if (!latestTemplate || !latestTemplate.enabled || !this.shouldSpawn(latestTemplate, now)) return null;

        const nextRunAt = this.nextCalendarRun(latestTemplate, now);
        const previous = latestTemplate.last_task_id ? this.repos.tasks.getById(latestTemplate.last_task_id) : null;
        if (!previous || (previous.status !== "done" && previous.status !== "cancelled")) {
          this.repos.recurringTasks.update(latestTemplate.id, { next_run_at: nextRunAt });
          return null;
        }

        const channel = this.repos.channels.getById(latestTemplate.channel_id);
        const creator = this.repos.users.getById(latestTemplate.created_by);
        if (!channel || !creator || !this.repos.members.exists(channel.guild_id, creator.id)) {
          this.repos.recurringTasks.update(latestTemplate.id, { next_run_at: nextRunAt });
          console.error(`Recurring task ${latestTemplate.id} cannot spawn because its channel or creator is unavailable`);
          return null;
        }

        if (latestTemplate.occurrence_mode === "same_task") {
          const task = this.repos.tasks.update(previous.task_id, { status: "open" });
          if (!task) return null;
          this.repos.recurringTasks.update(latestTemplate.id, { next_run_at: nextRunAt, last_spawned_at: now });
          return { type: "reopen" as const, task };
        }

        const recurringSeq = previous.recurring_seq + 1;
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
          next_run_at: nextRunAt,
          last_task_id: occurrence.task.task_id,
          last_spawned_at: now,
        });
        return { type: "create" as const, occurrence };
      })();
      if (!result) return;
      if (result.type === "reopen") {
        this.dispatcher.taskUpdated(result.task);
        return;
      }
      this.dispatcher.messageCreate(result.occurrence.cardMessage);
      this.dispatcher.threadCreate(result.occurrence.thread);
      this.dispatcher.messageCreate(result.occurrence.assignmentMessage);
      this.dispatcher.taskCreated(result.occurrence.task);
    } catch (error) {
      console.error(`Recurring task ${template.id} spawn error:`, error);
    }
  }
}
