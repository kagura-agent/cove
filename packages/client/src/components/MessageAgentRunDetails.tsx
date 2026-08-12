import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";
import { ExecutionChip, ExecutionTimeline } from "./AgentRunTimeline";

const NARROW_VIEWPORT = 640;
const VIEWPORT_GUTTER = 12;
const POPOVER_GAP = 8;
const POPOVER_WIDTH = 420;

export type ExecutionDetailsPlacement = { top: number; left: number; width: number; maxHeight: number; placement: "above" | "below" };

/** Keep a desktop popover in the viewport and prefer the roomier side of its chip. */
export function executionDetailsPlacement(anchor: DOMRect, viewport: { width: number; height: number }, surfaceHeight = 360): ExecutionDetailsPlacement {
  const width = Math.min(POPOVER_WIDTH, Math.max(280, viewport.width - VIEWPORT_GUTTER * 2));
  const availableBelow = viewport.height - anchor.bottom - POPOVER_GAP - VIEWPORT_GUTTER;
  const availableAbove = anchor.top - POPOVER_GAP - VIEWPORT_GUTTER;
  const placement = availableBelow >= Math.min(surfaceHeight, 220) || availableBelow >= availableAbove ? "below" : "above";
  const maxHeight = Math.max(120, Math.min(surfaceHeight, placement === "below" ? availableBelow : availableAbove));
  const top = placement === "below" ? anchor.bottom + POPOVER_GAP : Math.max(VIEWPORT_GUTTER, anchor.top - POPOVER_GAP - maxHeight);
  const left = Math.min(Math.max(VIEWPORT_GUTTER, anchor.left), Math.max(VIEWPORT_GUTTER, viewport.width - width - VIEWPORT_GUTTER));
  return { top, left, width, maxHeight, placement };
}

/** Lazy, message-scoped evidence viewer. No per-message request is made until opened. */
export function MessageAgentRunDetails({ channelId, messageId }: { channelId: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null);
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState<number | undefined>();
  const [narrow, setNarrow] = useState(false);
  const [placement, setPlacement] = useState<ExecutionDetailsPlacement | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const load = useCallback(() => api.fetchMessageAgentRun(channelId, messageId).then((value) => { setTimeline(value); setChecked(true); }).catch(() => setChecked(true)), [channelId, messageId]);
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => chipRef.current?.focus());
  }, []);

  useEffect(() => {
    const onUpdate = (run: NonNullable<AgentRunTimeline["run"]>) => {
      if (run.assistant_message_id === messageId && (run.thread_id === channelId || (!run.thread_id && run.channel_id === channelId))) load();
    };
    dispatcher.on("AGENT_RUN_UPDATED", onUpdate);
    return () => dispatcher.off("AGENT_RUN_UPDATED", onUpdate);
  }, [channelId, messageId, load]);
  useEffect(() => {
    if (timeline?.run?.status !== "active") return;
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, [timeline?.run?.status]);

  const updateViewport = useCallback(() => {
    const isNarrow = window.innerWidth < NARROW_VIEWPORT;
    setNarrow(isNarrow);
    if (!isNarrow && chipRef.current) setPlacement(executionDetailsPlacement(chipRef.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, surfaceRef.current?.getBoundingClientRect().height));
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("scroll", updateViewport, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    if (surfaceRef.current) observer?.observe(surfaceRef.current);
    return () => { window.removeEventListener("resize", updateViewport); window.removeEventListener("scroll", updateViewport, true); observer?.disconnect(); };
  }, [open, updateViewport, timeline?.events.length]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!chipRef.current?.contains(target) && !surfaceRef.current?.contains(target)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onPointerDown, true); };
  }, [close, open]);

  const toggle = () => { const next = !open; setOpen(next); if (next && !checked) load(); };
  // Before an associated update arrives, bots offer a lazy check rather than
  // issuing one request for every historical message in the scrollback.
  if (checked && !timeline?.run) return null;
  const run = timeline?.run;
  const content = open && run ? <ExecutionDetailsSurface narrow={narrow} placement={placement} surfaceRef={surfaceRef} titleId={titleId} onClose={() => close(true)} events={timeline?.events ?? []} /> : null;
  return <div style={{ marginTop: "var(--space-xs)" }}>
    <button ref={chipRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={open ? titleId : undefined} aria-label="Show execution details" style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--border-subtle)", borderRadius: 999, background: "transparent", color: "var(--text-muted)", padding: "3px 8px", cursor: "pointer", fontSize: "var(--font-size-xs)", maxWidth: "100%" }}>
      {run ? <ExecutionChip run={run} events={timeline?.events ?? []} now={now} /> : <>◌ <span>Execution details</span></>}
    </button>
    {content && typeof document !== "undefined" ? createPortal(content, document.body) : content}
  </div>;
}

function ExecutionDetailsSurface({ narrow, placement, surfaceRef, titleId, onClose, events }: { narrow: boolean; placement: ExecutionDetailsPlacement | null; surfaceRef: React.RefObject<HTMLElement | null>; titleId: string; onClose: () => void; events: NonNullable<AgentRunTimeline["events"]> }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButtonRef.current?.focus(); }, []);
  const closeButton = <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close execution details" style={{ border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>;
  const surfaceHeight = narrow ? "min(58vh, 460px)" : `${placement?.maxHeight ?? 360}px`;
  const heading = <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", paddingBottom: "var(--space-xs)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}><strong id={titleId} style={{ fontSize: "var(--font-size-sm)" }}>Execution details</strong>{closeButton}</header>;
  const timeline = <div style={{ overflow: "auto", flex: 1, paddingTop: "var(--space-xs)" }}><ExecutionTimeline events={events} /></div>;
  if (narrow) return <div style={{ position: "fixed", zIndex: 10000, inset: 0, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,.42)" }}>
    <section ref={surfaceRef as React.RefObject<HTMLElement>} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width: "100%", maxHeight: "82vh", height: surfaceHeight, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg-floating)", borderRadius: "16px 16px 0 0", boxShadow: "0 -8px 28px rgba(0,0,0,.35)", padding: "var(--space-md)" }}>{heading}{timeline}</section>
  </div>;
  return <section ref={surfaceRef as React.RefObject<HTMLElement>} role="dialog" aria-labelledby={titleId} style={{ position: "fixed", zIndex: 10000, top: placement?.top ?? VIEWPORT_GUTTER, left: placement?.left ?? VIEWPORT_GUTTER, width: placement?.width ?? POPOVER_WIDTH, maxWidth: `calc(100vw - ${VIEWPORT_GUTTER * 2}px)`, height: surfaceHeight, display: "flex", flexDirection: "column", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: "var(--space-sm)" }}>{heading}{timeline}</section>;
}
