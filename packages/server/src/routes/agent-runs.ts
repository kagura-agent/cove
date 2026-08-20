import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import { PermissionBits, type AgentRunEventType } from "@cove/shared";
import { parseJsonBody, validationError } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
const TYPES = new Set<AgentRunEventType>(["run_started","run_finished","run_failed","run_aborted","tool_started","tool_progress","tool_finished","tool_failed","command_output","patch_summary","approval_requested","subagent_started","subagent_progress","subagent_finished","subagent_failed"]);

export function agentRunRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
 const app = new Hono<AppEnv>();
 app.post("/agent-runs", async c => {
  const body = await parseJsonBody<Record<string, unknown>>(c); if (!body || typeof body.channel_id !== "string" || typeof body.trigger_message_id !== "string") return validationError(c, "channel_id and trigger_message_id are required");
  const user = c.get("botUser"); await requireChannelPermission(repos, body.channel_id, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);
  const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
  // Normalize legacy/defensive callers: a run whose channel_id points at a
  // thread (old plugin behavior, channel_id == thread_id) is rewritten so
  // channel_id is the parent channel and thread_id the thread. New callers
  // already send channel_id = parent + thread_id = thread.
  const rawChannel = repos.channels.getById(body.channel_id);
  const channelId = rawChannel?.type === 11 && rawChannel.parent_id ? rawChannel.parent_id : body.channel_id;
  const normalizedThreadId = rawChannel?.type === 11 && rawChannel.parent_id ? rawChannel.id : threadId;
  // A thread run is permission-anchored to its parent channel, while the trigger
  // lives in the thread itself. Do not require child agents to be thread members.
  const trigger = repos.messages.getById(normalizedThreadId ?? channelId, body.trigger_message_id); if (!trigger || (trigger.channel_id !== channelId && trigger.channel_id !== normalizedThreadId)) return c.json({ message: "Unknown trigger message", code: 10008 }, 404);
  const run = repos.agentRuns.start({ agent_id: user.id, channel_id: channelId, trigger_message_id: body.trigger_message_id, thread_id: normalizedThreadId, parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : null });
  repos.agentRuns.append(run.run_id, { type: "run_started", action: "Starting" }); const timeline = repos.agentRuns.timelineForRun(run.run_id); dispatcher?.agentRunUpdated(timeline.run!); return c.json(timeline.run!, 201);
 });
 app.get("/agent-runs/:runId", async c => { const run = repos.agentRuns.get(c.req.param("runId")); if (!run) return c.json({ message: "Unknown agent run", code: 10081 }, 404); await requireChannelPermission(repos, run.channel_id, c.get("botUser").id, PermissionBits.VIEW_CHANNEL); return c.json(repos.agentRuns.timelineForRun(run.run_id)); });
 // The render channel is part of the lookup boundary.  In particular, a run
 // anchored to a parent channel may only be read through its matching thread.
 app.get("/channels/:channelId/messages/:messageId/agent-run", async c => { const channelId=c.req.param("channelId"); await requireChannelPermission(repos,channelId,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); const message=repos.messages.getById(channelId,c.req.param("messageId")); if(!message) return c.json({message:"Unknown Message",code:10008},404); const run=repos.agentRuns.forAssistantMessage(channelId,message.id); return c.json(run ? repos.agentRuns.timelineForRun(run.run_id) : {run:null,events:[]}); });
 app.get("/channels/:channelId/agent-runs/latest", async c => { const id = c.req.param("channelId"); await requireChannelPermission(repos,id,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); return c.json(repos.agentRuns.timeline({channelId:id, threadId:c.req.query("thread_id")})); });
 // Scope-aggregated usage: channel (ALL runs incl. threads), thread (spans sessions),
 // task (spans the task's sessions). Same AgentRunUsage shape as per-run usage.
 app.get("/channels/:channelId/usage", async c => { const channelId = c.req.param("channelId"); await requireChannelPermission(repos,channelId,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); return c.json(repos.agentRuns.usageByScope({ channelId })); });
 app.get("/channels/:channelId/threads/:threadId/usage", async c => { const { channelId, threadId } = c.req.param(); await requireChannelPermission(repos,channelId,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); // The thread must actually belong to this channel — otherwise a caller with
 // access to one channel could read usage for an arbitrary thread elsewhere.
 const thread = repos.channels.getById(threadId); if (!thread || thread.parent_id !== channelId) return c.json({ message: "Unknown Thread", code: 10008 }, 404); return c.json(repos.agentRuns.usageByScope({ threadId })); });
 app.get("/tasks/:taskId/usage", async c => { const task = repos.tasks.getById(c.req.param("taskId")); if (!task) return c.json({ message: "Unknown Task", code: 10080 }, 404); await requireChannelPermission(repos,task.channel_id,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); return c.json(repos.agentRuns.usageByScope({ taskId: task.task_id })); });
 // Per-task usage for the task table: { task_id: AgentRunUsage }. Tasks without
 // usage are absent; the client renders an em dash for them.
 app.get("/channels/:channelId/tasks/usage", async c => { const channelId = c.req.param("channelId"); await requireChannelPermission(repos,channelId,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); return c.json(repos.agentRuns.usageByTask(channelId)); });
 // Per-task efficiency report (#572 Phase 1): cost + tool health + run health
 // + baseline comparison, all computed from existing data.
 app.get("/tasks/:taskId/efficiency", async c => { const task = repos.tasks.getById(c.req.param("taskId")); if (!task) return c.json({ message: "Unknown Task", code: 10080 }, 404); await requireChannelPermission(repos,task.channel_id,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); const scope = c.req.query("baseline") === "all" ? "all" : "channel"; const report = repos.taskEfficiency.report(task.task_id, { baselineScope: scope }); return c.json(report); });
 // Per-run efficiency stats for one task (chart source for #574 Phase 2).
 app.get("/tasks/:taskId/runs/stats", async c => { const task = repos.tasks.getById(c.req.param("taskId")); if (!task) return c.json({ message: "Unknown Task", code: 10080 }, 404); await requireChannelPermission(repos,task.channel_id,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); const stats = repos.taskEfficiency.runStats(task.task_id); if (!stats) return c.json({ message: "Unknown Task", code: 10080 }, 404); return c.json(stats); });
 // Per-task efficiency for every task in a channel (one shared channel baseline).
 app.get("/channels/:channelId/tasks/efficiency", async c => { const channelId = c.req.param("channelId"); await requireChannelPermission(repos,channelId,c.get("botUser").id,PermissionBits.VIEW_CHANNEL); const scope = c.req.query("baseline") === "all" ? "all" : "channel"; return c.json(repos.taskEfficiency.channelReports(channelId, { baselineScope: scope })); });
 app.post("/agent-runs/:runId/events", async c => { const run = repos.agentRuns.get(c.req.param("runId")); if (!run) return c.json({ message: "Unknown agent run", code: 10081 }, 404); const user=c.get("botUser"); await requireChannelPermission(repos,run.channel_id,user.id,PermissionBits.SEND_MESSAGES|PermissionBits.VIEW_CHANNEL); if(run.agent_id!==user.id) return c.json({message:"Missing Permissions",code:50013},403); const body=await parseJsonBody<Record<string,unknown>>(c); if(!body || typeof body.type!=="string" || !TYPES.has(body.type as AgentRunEventType)) return validationError(c,"Invalid agent run event type"); const updated=repos.agentRuns.append(run.run_id,body as {type:AgentRunEventType}); if(!updated) return c.json({message:"Unknown or inactive agent run",code:10081},409); dispatcher?.agentRunUpdated(updated); return c.json(updated); });
 app.post("/agent-runs/:runId/usage", async c => { const run = repos.agentRuns.get(c.req.param("runId")); if (!run) return c.json({ message: "Unknown agent run", code: 10081 }, 404); const user=c.get("botUser"); await requireChannelPermission(repos,run.channel_id,user.id,PermissionBits.SEND_MESSAGES|PermissionBits.VIEW_CHANNEL); if(run.agent_id!==user.id) return c.json({message:"Missing Permissions",code:50013},403); const body=await parseJsonBody<Record<string,unknown>>(c); if(!body || typeof body.provider!=="string" || typeof body.model!=="string") return validationError(c,"provider and model are required"); const tokens = (n: unknown) => (Number.isFinite(n) && (n as number) > 0) ? Math.floor(n as number) : 0; const cost = body.cost == null ? null : (Number.isFinite(body.cost) ? Number(body.cost) : null); const cost_source = cost === null ? "none" : (body.cost_source === "provider" || body.cost_source === "price_table" ? body.cost_source : "price_table"); repos.agentRuns.recordUsage(run.run_id, { provider: String(body.provider), model: String(body.model), input_tokens: tokens(body.input_tokens), output_tokens: tokens(body.output_tokens), cache_read_tokens: tokens(body.cache_read_tokens), cache_write_tokens: tokens(body.cache_write_tokens), cost, cost_source }); // Broadcast so aggregate chips (channel/thread/task headers, task table)
 // refresh live instead of waiting for a manual reload.
 dispatcher?.usageUpdated(run);
 return c.json({ ok: true }); });
 app.patch("/agent-runs/:runId", async c => { const run=repos.agentRuns.get(c.req.param("runId")); if(!run) return c.json({message:"Unknown agent run",code:10081},404); const user=c.get("botUser"); await requireChannelPermission(repos,run.channel_id,user.id,PermissionBits.SEND_MESSAGES|PermissionBits.VIEW_CHANNEL); if(run.agent_id!==user.id) return c.json({message:"Missing Permissions",code:50013},403); const body=await parseJsonBody<Record<string,unknown>>(c); if(!body || typeof body.assistant_message_id!=="string") return validationError(c,"assistant_message_id is required"); const messageChannelId=run.thread_id ?? run.channel_id; const msg=repos.messages.getById(messageChannelId, body.assistant_message_id); if(!msg || msg.channel_id!==messageChannelId) return c.json({message:"Unknown assistant message",code:10008},404); const updated=repos.agentRuns.associateMessage(run.run_id,body.assistant_message_id); if(!updated) return c.json({message:"Run already has a different assistant message",code:409},409); dispatcher?.agentRunUpdated(updated); return c.json(updated); });
 return app;
}
