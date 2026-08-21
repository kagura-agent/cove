import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Spin, Empty } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import type { GuildChannelUsage, GuildDailyUsage, GuildUsageOverview, GuildTaskUsage, GuildUsageRange, TaskEfficiencyReport, AgentRunUsage } from "@cove/shared";
import { useActiveIds } from "../hooks/useActiveIds";
import { useGuildStore } from "../stores/useGuildStore";
import { useChannelStore } from "../stores/useChannelStore";
import { routes } from "../lib/routes";
import * as api from "../lib/api";
import { formatUsd, formatTokens } from "./AgentRunTimeline";
import { flattenDailyForChart, topModelsByCost } from "../lib/guild-usage";
import { STATUS_COLORS } from "../lib/taskStatusConfig";
import { ThreadPanel } from "./ThreadPanel";
import {
  CostChartFrame, CostGrid, CostXAxis, CostYAxis, CostTooltipBox, CostLegend,
  Bar, BarChart, ComposedChart, Line, modelColor, costTick, tokenTick,
} from "./CostChart";
import type { ReactNode, CSSProperties } from "react";

const MUTED = "var(--text-muted)";
const GOOD = "#23a55a";
const BAD = "var(--status-danger, #ed4245)";

const styles = {
  root: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" } as CSSProperties,
  header: { display: "flex", alignItems: "center", gap: "var(--content-gap)", padding: "0 var(--content-pad)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)", height: "var(--header-height)", flexShrink: 0 } as CSSProperties,
  headerTitle: { margin: 0, color: "var(--header-primary)", fontSize: "var(--font-size-lg)", fontWeight: 700 } as CSSProperties,
  content: { flex: 1, overflowY: "auto", padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" } as CSSProperties,
  kpiRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)" } as CSSProperties,
  kpiCard: { background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: 2 } as CSSProperties,
  kpiLabel: { fontSize: "var(--font-size-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: MUTED } as CSSProperties,
  kpiValue: { fontSize: "var(--font-size-xl)", fontWeight: 700, color: "var(--header-primary)", fontVariantNumeric: "tabular-nums" } as CSSProperties,
  kpiSub: { fontSize: "var(--font-size-xs)", color: MUTED } as CSSProperties,
  card: { background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", padding: "var(--space-md)" } as CSSProperties,
  cardTitle: { fontSize: "var(--font-size-sm)", fontWeight: 700, color: "var(--header-primary)", margin: "0 0 var(--space-sm)" } as CSSProperties,
  rankRow: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "6px 4px", borderRadius: "var(--space-xs)", cursor: "pointer", transition: "background 0.15s" } as CSSProperties,
  rankName: { width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0, color: "var(--interactive-normal)", fontSize: "var(--font-size-sm)" } as CSSProperties,
  rankBarWrap: { flex: 1, height: 14, background: "var(--bg-modifier-hover, rgba(255,255,255,0.04))", borderRadius: 7, overflow: "hidden" } as CSSProperties,
  rankBar: { height: "100%", borderRadius: 7, transition: "width 0.3s ease" } as CSSProperties,
  rankMeta: { width: 170, textAlign: "right", fontSize: "var(--font-size-xs)", color: MUTED, flexShrink: 0, fontVariantNumeric: "tabular-nums" } as CSSProperties,
  drillHeader: { display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" } as CSSProperties,
  backBtn: { background: "none", border: "1px solid var(--border-subtle)", color: "var(--interactive-normal)", borderRadius: "var(--space-xs)", padding: "2px 10px", fontSize: "var(--font-size-xs)", cursor: "pointer" } as CSSProperties,
  taskRow: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "6px 4px", borderRadius: "var(--space-xs)", cursor: "pointer", fontSize: "var(--font-size-sm)" } as CSSProperties,
  taskTitle: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--interactive-active)" } as CSSProperties,
  taskMeta: { fontSize: "var(--font-size-xs)", color: MUTED, flexShrink: 0, fontVariantNumeric: "tabular-nums", display: "flex", gap: "var(--space-sm)" } as CSSProperties,
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: MUTED, gap: "var(--space-sm)", padding: "var(--space-xxl)" } as CSSProperties,
  drillCard: { background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", padding: "var(--space-md)", marginTop: "var(--space-md)" } as CSSProperties,
  rangeTabs: { display: "flex", gap: 2, background: "var(--bg-modifier-hover, rgba(255,255,255,0.04))", borderRadius: "var(--space-xs)", padding: 2, marginLeft: "auto" } as CSSProperties,
  rangeTab: { background: "none", border: "none", borderRadius: 6, padding: "2px 10px", fontSize: "var(--font-size-xs)", color: MUTED, cursor: "pointer" } as CSSProperties,
  rangeTabActive: { background: "var(--bg-floating, #232428)", color: "var(--header-primary)", fontWeight: 600 } as CSSProperties,
} as const;

/** Range label for card titles, e.g. "last 14 days" / "all time". */
/** Range label for card titles, e.g. "last 14 days". The daily trend caps at
 *  90 buckets (server), so there is no "all time" trend — KPI cards (all-time)
 *  are labeled separately and never follow the range. */
function rangeLabel(range: GuildUsageRange): string {
  return range === "all" ? "all time" : `last ${range} days`;
}

const RANGE_OPTIONS: Array<{ value: GuildUsageRange; label: string }> = [
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

function KpiCard({ label, value, sub, subColor }: { label: string; value: string; sub?: ReactNode; subColor?: string }) {
  return (
    <div style={styles.kpiCard}>
      <span style={styles.kpiLabel}>{label}</span>
      <span style={styles.kpiValue}>{value}</span>
      {sub && <span style={{ ...styles.kpiSub, ...(subColor ? { color: subColor, fontWeight: 600 } : {}) }}>{sub}</span>}
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span style={styles.kpiSub}>vs yesterday —</span>;
  const up = delta >= 0;
  const color = delta === 0 ? MUTED : up ? BAD : GOOD;
  const Icon = up ? ArrowUpOutlined : ArrowDownOutlined;
  return (
    <span style={{ ...styles.kpiSub, color, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
      <Icon style={{ fontSize: 10 }} />
      {formatUsd(Math.abs(delta))} vs yesterday
    </span>
  );
}

function ChannelRanking({ channels, channelName, onSelect }: {
  channels: GuildChannelUsage[];
  channelName: (id: string) => string;
  onSelect: (channelId: string) => void;
}) {
  const max = Math.max(0, ...channels.map((c) => c.cost ?? 0));
  return (
    <div>
      {channels.length === 0 && (
        <div style={styles.empty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No channel spending yet" /></div>
      )}
      {channels.map((c) => (
        <div
          key={c.channel_id}
          role="button"
          tabIndex={0}
          aria-label={`Channel #${channelName(c.channel_id)}`}
          style={styles.rankRow}
          onClick={() => onSelect(c.channel_id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(c.channel_id); } }}
        >
          <span style={styles.rankName} title={channelName(c.channel_id)}>#{channelName(c.channel_id)}</span>
          <span style={styles.rankBarWrap}>
            <span style={{ ...styles.rankBar, width: max > 0 ? `${Math.max(2, ((c.cost ?? 0) / max) * 100)}%` : "0%", background: "var(--accent, #5865f2)", display: "block" }} />
          </span>
          <span style={styles.rankMeta}>
            {c.cost != null ? formatUsd(c.cost) : "—"} · {c.tasks} task{c.tasks === 1 ? "" : "s"} · {c.calls} call{c.calls === 1 ? "" : "s"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Top tasks by cost — "where the money actually went". Clicking a row opens
 *  the task's thread in the right-side panel (master-detail, like the task
 *  board). */
function TaskRanking({ tasks, channelName, onSelect }: {
  tasks: GuildTaskUsage[];
  channelName: (id: string) => string;
  onSelect: (threadId: string) => void;
}) {
  const max = Math.max(0, ...tasks.map((t) => t.cost ?? 0));
  return (
    <div>
      {tasks.length === 0 && (
        <div style={styles.empty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No task spending yet" /></div>
      )}
      {tasks.slice(0, 12).map((t) => (
        <div
          key={t.task_id}
          role="button"
          tabIndex={0}
          aria-label={`Task ${t.title}`}
          style={styles.rankRow}
          onClick={() => onSelect(t.thread_id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.thread_id); } }}
        >
          <span style={styles.taskTitle} title={`${t.title} (#${channelName(t.channel_id)})`}>
            <span style={{ color: STATUS_COLORS[t.status] ?? "var(--text-muted)", fontSize: 10, marginRight: 4 }}>●</span>
            {t.title}
          </span>
          <span style={styles.rankBarWrap}>
            <span style={{ ...styles.rankBar, width: max > 0 ? `${Math.max(2, ((t.cost ?? 0) / max) * 100)}%` : "0%", background: "var(--accent, #5865f2)", display: "block" }} />
          </span>
          <span style={styles.rankMeta}>
            <span style={{ width: "100%", display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)" }}>
              <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>#{channelName(t.channel_id)}</span>
              <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t.calls} call{t.calls === 1 ? "" : "s"}</span>
              <span style={{ color: "var(--header-primary)", fontWeight: 600, whiteSpace: "nowrap" }}>{t.cost != null ? formatUsd(t.cost) : "—"}</span>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function TaskDrilldown({ channelId, channelName, guildId, onBack, onSelectTask }: {
  channelId: string;
  channelName: (id: string) => string;
  guildId: string;
  onBack: () => void;
  onSelectTask: (threadId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Array<{ task_id: string; thread_id: string; title: string; status: string; usage: AgentRunUsage | null }>>([]);
  const [reports, setReports] = useState<Record<string, TaskEfficiencyReport>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setTasks([]);
    setReports({});
    // Load tasks + usage + efficiency together: a separate usage request that
    // resolves before the task list would be dropped (prev is still empty),
    // leaving every row at "— / 0 calls" (review finding).
    Promise.all([
      api.fetchGuildTasks(guildId),
      api.fetchTaskUsages(channelId).catch(() => ({}) as Record<string, AgentRunUsage>),
      api.fetchChannelTaskEfficiency(channelId).catch(() => [] as TaskEfficiencyReport[]),
    ]).then(([guildTasks, usages, efficiency]) => {
      if (!alive) return;
      const inChannel = guildTasks.filter((t) => t.channel_id === channelId);
      setTasks(inChannel.map((t) => ({
        task_id: t.task_id,
        thread_id: t.thread_id,
        title: t.title,
        status: t.status,
        usage: usages[t.task_id] ?? null,
      })));
      const byId: Record<string, TaskEfficiencyReport> = {};
      for (const r of efficiency) byId[r.task_id] = r;
      setReports(byId);
    }).catch(() => { if (alive) setTasks([]); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [channelId, guildId]);

  if (loading) return <div style={{ padding: "var(--space-lg)", textAlign: "center" }}><Spin /></div>;

  return (
    <div>
      <div style={styles.drillHeader}>
        <button style={styles.backBtn} onClick={onBack}>← Channels</button>
        <span style={{ fontWeight: 700, color: "var(--header-primary)", fontSize: "var(--font-size-sm)" }}>#{channelName(channelId)}</span>
      </div>
      {tasks.length === 0 && (
        <div style={styles.empty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tasks in this channel yet" /></div>
      )}
      {tasks.map((t) => {
        const report = reports[t.task_id];
        const usage = t.usage;
        const failureRate = report?.tool_health?.failure_rate;
        return (
          <div
            key={t.task_id}
            role="button"
            tabIndex={0}
            aria-label={`Task ${t.title}`}
            style={styles.taskRow}
            onClick={() => onSelectTask(t.thread_id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectTask(t.thread_id); } }}
          >
            <span style={styles.taskTitle} title={t.title}>{t.title}</span>
            <span style={styles.taskMeta}>
              {usage?.cost != null ? <span>{formatUsd(usage.cost)}</span> : <span>—</span>}
              <span>{usage?.calls ?? 0} calls</span>
              {failureRate != null && <span style={{ color: failureRate > 0.2 ? BAD : MUTED }}>{Math.round(failureRate * 100)}% fail</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function GuildOverview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { guildId } = useActiveIds();
  const guilds = useGuildStore((s) => s.guilds);
  const channelsByGuildId = useChannelStore((s) => s.channelsByGuildId);
  const [overview, setOverview] = useState<GuildUsageOverview | null>(null);
  const [daily, setDaily] = useState<GuildDailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<GuildUsageRange>(14);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  // Master-detail: clicking a task opens its thread in a right-side panel
  // (same interaction as the task board). Selection lives in the URL so
  // refresh/back keep working, matching TaskBoard.
  const selectedThreadId = searchParams.get("thread");
  const [threadPanelWidth, setThreadPanelWidth] = useState(400);
  const [resizeDragging, setResizeDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(400);
  // Guild we have loaded data for — used to detect a real guild switch so the
  // thread panel is only cleared then (not on URL search edits).
  const loadedGuildRef = useRef<string | null>(null);
  // Fetch sequence: guards against a slow request overwriting a newer one.
  const fetchSeqRef = useRef(0);

  const channels = useMemo(() => (guildId ? channelsByGuildId[guildId] ?? [] : []), [channelsByGuildId, guildId]);
  const channelName = useCallback((id: string) => channels.find((c) => c.id === id)?.name ?? id.slice(0, 8), [channels]);

  // Validate guild exists.
  useEffect(() => {
    if (guildId && Object.keys(guilds).length > 0 && !guilds[guildId]) {
      navigate(routes.root(), { replace: true });
    }
  }, [guildId, guilds, navigate]);

  const handleOpenThread = useCallback((threadId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("thread", threadId);
      return next;
    });
  }, [setSearchParams]);

  const closeThread = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("thread");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (!guildId) return;
    // Only clear the thread panel when switching guilds. Do NOT put
    // setSearchParams/closeThread in the deps: in react-router v6 the
    // setSearchParams identity changes whenever the search string changes, so
    // depending on it here would re-run this effect on every task click →
    // loading flash + the ?thread= param getting deleted right after it is set.
    const switchedGuild = loadedGuildRef.current !== guildId;
    loadedGuildRef.current = guildId;
    if (switchedGuild) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("thread");
        return next;
      }, { replace: true });
    }
    // Lifecycle guard: a slow request for a previous guild/range must not
    // overwrite the current selection (review finding). Each fetch bumps the
    // sequence; only the latest sequence may write state.
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setSelectedChannel(null);
    Promise.all([api.fetchGuildUsageOverview(guildId, range), api.fetchGuildUsageDaily(guildId, range)])
      .then(([ov, dl]) => {
        if (fetchSeqRef.current !== seq) return;
        setOverview(ov); setDaily(dl);
      })
      .catch((err) => { if (fetchSeqRef.current === seq) console.error("fetch guild overview:", err); })
      .finally(() => { if (fetchSeqRef.current === seq) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, range]);

  // Resize the right-side thread panel (same drag pattern as TaskBoard).
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = threadPanelWidth;
    setResizeDragging(true);
    const onMouseMove = (ev: MouseEvent) => {
      const delta = dragStartX.current - ev.clientX;
      setThreadPanelWidth(Math.min(600, Math.max(280, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      setResizeDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [threadPanelWidth]);

  // Top models by cost (capped for the stacked chart).
  const topModels = useMemo(() => topModelsByCost(daily, 8), [daily]);

  // Daily chart data: flatten per-day models into { date, cost, tokens, calls, <model>: cost }.
  const dailyData = useMemo(() => flattenDailyForChart(daily), [daily]);

  if (loading) {
    return (
      <div style={styles.root}>
        <div style={styles.header}><h1 style={styles.headerTitle}>Usage Overview</h1></div>
        <div style={{ ...styles.empty, flex: 1 }}><Spin tip="Loading usage…" /></div>
      </div>
    );
  }

  const today = overview?.today_cost ?? null;
  const yesterday = overview?.yesterday_cost ?? null;

  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" }}>
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Usage Overview</h1>
        <span style={{ fontSize: "var(--font-size-xs)", color: MUTED }}>Cost where the agents work</span>
        <div style={styles.rangeTabs} role="tablist" aria-label="Time range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={String(opt.value)}
              role="tab"
              aria-selected={range === opt.value}
              style={range === opt.value ? styles.rangeTabActive : styles.rangeTab}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div style={styles.content}>
        {!overview || (overview.channels.length === 0 && overview.total_cost === null) ? (
          <div style={styles.empty}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No usage recorded yet" />
            <span style={{ fontSize: "var(--font-size-xs)" }}>Run an agent in this server and it will show up here.</span>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div style={styles.kpiRow}>
              <KpiCard label="Today" value={today != null ? formatUsd(today) : "—"} sub={today != null ? `${overview.today_calls} calls · ${formatTokens(overview.today_tokens)} tok` : undefined} />
              <KpiCard label="Today tasks" value={String(overview.today_tasks)} sub={overview.today_tasks > 0 ? "tasks with usage today" : undefined} />
              <KpiCard label="Yesterday" value={yesterday != null ? formatUsd(yesterday) : "—"} sub={<DeltaBadge delta={overview.delta} />} />
              <KpiCard label="This month" value={overview.month_cost != null ? formatUsd(overview.month_cost) : "—"} />
              <KpiCard label={`Total · ${rangeLabel(range)}`} value={overview.total_cost != null ? formatUsd(overview.total_cost) : "—"} />
              <KpiCard label="Active channels" value={String(overview.active_channels)} sub={`${channels.length} total channels`} />
              <KpiCard label="Active tasks" value={String(overview.active_tasks)} />
            </div>

            {/* Daily spend trend (bar = cost, line = tokens, dashed = tasks) */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Daily spend · {rangeLabel(range)}</h3>
              <CostChartFrame height={220}>
                <ComposedChart data={dailyData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CostGrid />
                  <CostXAxis dataKey="date" interval="preserveStartEnd" />
                  <CostYAxis tickFormatter={costTick} />
                  <CostYAxis yAxisId="tokens" orientation="right" tickFormatter={tokenTick} width={48} />
                  <CostTooltipBox
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    formatters={{
                      cost: (v) => formatUsd(Number(v)),
                      tokens: (v) => formatTokens(Number(v)),
                      tasks: (v) => `${Number(v)} tasks`,
                    }}
                  />
                  <CostLegend />
                  <Bar dataKey="cost" name="cost" fill="#5865f2" radius={[3, 3, 0, 0]} maxBarSize={32} />
                  <Line yAxisId="tokens" dataKey="tokens" name="tokens" stroke="#23a55a" strokeWidth={1.5} dot={false} />
                  {/* No tasks series: task counts (0–20) share the USD axis and
                      would compress the spend bars into invisibility. Today's
                      task count is already a KPI card. */}
                </ComposedChart>
              </CostChartFrame>
            </div>

            {/* Top tasks by cost — where the money went */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Top tasks by cost · {rangeLabel(range)}</h3>
              <TaskRanking tasks={overview.tasks} channelName={channelName} onSelect={handleOpenThread} />
            </div>

            {/* Channel ranking */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Channel spend</h3>
              <ChannelRanking channels={overview.channels} channelName={channelName} onSelect={(id) => { setSelectedChannel(id); closeThread(); }} />
            </div>

            {/* Model breakdown (stacked) */}
            {topModels.length > 0 && (
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Spend by model</h3>
                <CostChartFrame height={200}>
                  <BarChart data={dailyData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CostGrid />
                    <CostXAxis dataKey="date" interval="preserveStartEnd" />
                    <CostYAxis tickFormatter={costTick} />
                    <CostTooltipBox cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <CostLegend />
                    {topModels.map((m) => (
                      <Bar key={m} dataKey={m} name={m} stackId="cost" fill={modelColor(m)} maxBarSize={32} />
                    ))}
                  </BarChart>
                </CostChartFrame>
              </div>
            )}

            {/* Drilldown: channel → tasks */}
            {selectedChannel && (
              <div style={styles.drillCard}>
                <TaskDrilldown
                  channelId={selectedChannel}
                  channelName={channelName}
                  guildId={guildId!}
                  onBack={() => setSelectedChannel(null)}
                  onSelectTask={handleOpenThread}
                />
              </div>
            )}
          </>
        )}
      </div>
      </div>
      {/* Master-detail: task thread panel on the right (like the task board).
          Must be a sibling of the root column inside the outer row flex, or it
          stacks below the content instead of sliding in from the right. */}
      {selectedThreadId && (
        <>
          <div
            style={{
              width: 4,
              flexShrink: 0,
              cursor: "col-resize",
              background: resizeDragging ? "var(--accent)" : undefined,
              transition: "background 0.15s",
            }}
            onMouseDown={handleResizeMouseDown}
            onMouseEnter={(e) => { if (!resizeDragging) (e.currentTarget.style.background = "var(--border-subtle)"); }}
            onMouseLeave={(e) => { if (!resizeDragging) (e.currentTarget.style.background = ""); }}
          />
          <div style={{ width: threadPanelWidth, flexShrink: 0, display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-secondary)", borderLeft: "1px solid var(--border-subtle)" }}>
            <ThreadPanel threadId={selectedThreadId} onClose={closeThread} />
          </div>
        </>
      )}
    </div>
  );
}
