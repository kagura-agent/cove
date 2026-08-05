import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { Message } from "@cove/shared";

const TICK_MS = parseInt(process.env["TASK_HEARTBEAT_TICK_MS"] ?? "60000", 10);

const AGENT_PREAMBLE = `汇报前先主动核实与本 task 相关的外部状态。例如: 有 PR 就查 CI 状态、review 结论、未解决的讨论、合并冲突; 在等人就去读 thread 有没有新回复; 涉及部署就看服务是否正常; 文档在评审就看有没有新反馈。据此决定下一步 — 继续做、回应反馈、修问题、求助, 或者做完了就设 in_review 并通知相关人。`;

const VISIBLE_TEXT = "Heartbeat: status update requested";

export class TaskHeartbeatWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private repos: Repos,
    private dispatcher: GatewayDispatcher,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
    console.log(`💓 Task heartbeat worker started (tick every ${TICK_MS / 1000}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    try {
      const dueTasks = this.repos.tasks.listDueForHeartbeat();
      if (dueTasks.length === 0) return;

      const now = Date.now();

      for (const task of dueTasks) {
        const sinceMs = now - task.heartbeat_interval_ms;
        const hasActivity = this.repos.messages.hasRecentActivity(task.thread_id, sinceMs);

        if (hasActivity) {
          // Thread is active — just bump the timestamp, don't disturb
          this.repos.tasks.update(task.task_id, { heartbeat_last_at: now });
        } else {
          // Thread is silent — send heartbeat message
          this.sendHeartbeat(task.task_id, task.thread_id, task.created_by, task.assignee_id!, task.seq);
          this.repos.tasks.update(task.task_id, { heartbeat_last_at: now });
        }
      }
    } catch (err) {
      console.error("💓 Task heartbeat tick error:", err);
    }
  }

  private sendHeartbeat(taskId: string, threadId: string, createdBy: string, assigneeId: string, seq: number): void {
    const content = `${AGENT_PREAMBLE}\n\n${VISIBLE_TEXT}`;
    const metadata = JSON.stringify({ content_type: "task_heartbeat", assignee_id: assigneeId });

    const creator = this.repos.users.getById(createdBy);
    const senderName = creator?.username ?? "System";

    const msg = this.repos.messages.createSystemMessage(threadId, createdBy, senderName, content, metadata);

    // Dispatch via WS with author rewritten to "system" — bypasses agent self-loop filter
    const wsMessage: Message = {
      ...msg,
      author: {
        id: "system",
        username: "System",
        bot: false,
        avatar: null,
        discriminator: "0",
        global_name: "System",
      },
    };

    this.dispatcher.messageCreate(wsMessage);
    console.log(`💓 Task heartbeat: sent to task #${seq} in thread ${threadId}`);
  }
}
