import type { RecurringTask } from "@cove/shared";
import type { Repos } from "../repos/index.js";
import { createTaskAssignmentMessage, createTaskOccurrence } from "../services/task-occurrence.js";
import { advanceCronNextRun, isCronScheduled } from "../services/recurrence-schedule.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";

const TICK_MS = parseInt(process.env["RECURRING_TASK_TICK_MS"] ?? "30000", 10);

/**
 * Computes the next_run_at to persist after a spawn.
 *
 * - Interval schedules: fixed grid anchored at the original next_run_at
 *   (existing behavior — the worker still advances past missed runs).
 * - Cron schedules: next fire time after the previous fire time. With
 *   catch_up=skip the template lands on the next scheduled wall-clock time
 *   (missed runs during downtime are skipped); with catch_up=run it keeps
 *   advancing until past now so the worker backfills one run per missed fire.
 */
function nextRunAfterSpawn(template: RecurringTask, now: number): number | null {
  if (isCronScheduled(template)) {
    return advanceCronNextRun(template, template.next_run_at, now);
  }
  const elapsedIntervals = Math.floor((now - template.next_run_at) / template.interval_ms) + 1;
  return template.next_run_at + elapsedIntervals * template.interval_ms;
}

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
    return isCronScheduled(template) || (template.interval_ms > 0 && template.next_run_at > 0);
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

        const nextRunAt = nextRunAfterSpawn(latestTemplate, now);
        if (nextRunAt === null) {
          this.repos.recurringTasks.update(latestTemplate.id, { enabled: false, next_run_at: 0 });
          return null;
        }
        const previous = latestTemplate.last_task_id ? this.repos.tasks.getById(latestTemplate.last_task_id) : null;
        if (!previous || previous.status === "open" || previous.status === "in_progress") {
          // Overlap guard: never spawn a second concurrent occurrence.
          // - interval / cron skip: advance next_run_at so we stop re-checking.
          // - cron catch_up=run: keep next_run_at at the missed fire; once the
          //   task completes, the worker backfills the missed run.
          const keepMissedFire = isCronScheduled(latestTemplate) && latestTemplate.catch_up === "run";
          if (!keepMissedFire) {
            this.repos.recurringTasks.update(latestTemplate.id, { next_run_at: nextRunAt });
          }
          return null;
        }
        if (previous.status === "cancelled") {
          this.repos.recurringTasks.update(latestTemplate.id, { enabled: false, next_run_at: 0 });
          return null;
        }

        const channel = this.repos.channels.getById(latestTemplate.channel_id);
        const creator = this.repos.users.getById(latestTemplate.created_by);
        if (!channel || !creator || !this.repos.members.exists(channel.guild_id, creator.id)) {
          const keepMissedFire = isCronScheduled(latestTemplate) && latestTemplate.catch_up === "run";
          if (!keepMissedFire) {
            this.repos.recurringTasks.update(latestTemplate.id, { next_run_at: nextRunAt });
          }
          console.error(`Recurring task ${latestTemplate.id} cannot spawn because its channel or creator is unavailable`);
          return null;
        }

        if (latestTemplate.occurrence_mode === "same_task") {
          // Preserve the task's own heartbeat config; never auto-enable a default.
          const heartbeatIntervalMs = previous.assignee_id && previous.heartbeat_interval_ms > 0
            ? previous.heartbeat_interval_ms
            : 0;
          const reopenedTask = this.repos.tasks.update(previous.task_id, {
            status: "open",
            heartbeat_interval_ms: heartbeatIntervalMs,
            heartbeat_last_at: previous.assignee_id ? now : 0,
          });
          if (!reopenedTask) return null;
          const assignmentMessage = reopenedTask.assignee_id
            ? createTaskAssignmentMessage(this.repos, {
                threadId: reopenedTask.thread_id,
                creator,
                taskId: reopenedTask.task_id,
                title: reopenedTask.title,
                description: reopenedTask.description,
                assigneeId: reopenedTask.assignee_id,
              })
            : undefined;
          this.repos.recurringTasks.update(latestTemplate.id, { next_run_at: nextRunAt, last_spawned_at: now });
          return { type: "reassign" as const, assignmentMessage, task: this.repos.tasks.getById(reopenedTask.task_id)! };
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
        return { type: "create" as const, occurrence: { ...occurrence, task: this.repos.tasks.getById(occurrence.task.task_id)! } };
      })();
      if (!result) return;
      if (result.type === "reassign") {
        if (result.assignmentMessage) this.dispatcher.messageCreate(result.assignmentMessage);
        this.dispatcher.taskUpdated(result.task);
        return;
      }
      this.dispatcher.messageCreate(result.occurrence.cardMessage);
      this.dispatcher.threadCreate(result.occurrence.thread);
      if (result.occurrence.assignmentMessage) this.dispatcher.messageCreate(result.occurrence.assignmentMessage);
      this.dispatcher.taskCreated(result.occurrence.task);
    } catch (error) {
      console.error(`Recurring task ${template.id} spawn error:`, error);
    }
  }
}
