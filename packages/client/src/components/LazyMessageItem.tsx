import { useRef, useState, useEffect, type ReactNode } from "react";

const PLACEHOLDER_HEIGHT = 60;
const ROOT_MARGIN = "2000px 0px";
const REVEALED_CAP = 10_000;
const REVEALED_EVICT = 2_000;

/**
 * Tracks which message IDs have been rendered at least once.
 * Survives across remounts so that previously-visible items don't
 * reset to 60 px placeholders on channel switch.
 */
const revealedIds = new Set<string>();

function cappedRevealedAdd(id: string): void {
  revealedIds.add(id);
  if (revealedIds.size > REVEALED_CAP) {
    const iter = revealedIds.values();
    for (let i = 0; i < REVEALED_EVICT; i++) {
      const { value, done } = iter.next();
      if (done) break;
      revealedIds.delete(value);
    }
  }
}

// ── Shared IntersectionObserver ─────────────────────────────────────────
// A single observer per scroll-root, shared by all LazyMessageItem
// instances. Element→callback map dispatches intersection entries.

type VisibilityCallback = () => void;

const observerMap = new Map<Element, VisibilityCallback>();
let sharedObserver: IntersectionObserver | null = null;
let currentRoot: Element | null = null;

function getSharedObserver(root: Element | null): IntersectionObserver {
  if (sharedObserver && currentRoot === root) return sharedObserver;
  // Root changed (or first call) — recreate observer
  sharedObserver?.disconnect();
  observerMap.clear();
  currentRoot = root;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const cb = observerMap.get(entry.target);
          if (cb) {
            observerMap.delete(entry.target);
            sharedObserver!.unobserve(entry.target);
            cb();
          }
        }
      }
    },
    { root: root ?? undefined, rootMargin: ROOT_MARGIN },
  );
  return sharedObserver;
}

/**
 * Register a placeholder element with the shared observer.
 * Returns an unregister function for cleanup.
 */
export function registerVisibilityTarget(
  el: Element,
  onVisible: VisibilityCallback,
  root: Element | null,
): () => void {
  const observer = getSharedObserver(root);
  observerMap.set(el, onVisible);
  observer.observe(el);
  return () => {
    observerMap.delete(el);
    observer.unobserve(el);
  };
}

// ── Component ───────────────────────────────────────────────────────────

interface LazyMessageItemProps {
  /** Unique message ID — used to persist visibility across remounts. */
  messageId: string;
  /** Render eagerly (skip IntersectionObserver). */
  eager: boolean;
  /** Scroll container element used as IntersectionObserver root. */
  scrollRoot: Element | null;
  children: ReactNode;
}

/**
 * Wraps a message item with IntersectionObserver-based lazy rendering.
 * Once the placeholder enters the scroll container's vicinity (2 000 px
 * margin), the real content renders and stays rendered permanently.
 *
 * Uses a shared IntersectionObserver (one per scroll root) instead of
 * creating an individual observer per item.
 *
 * Visibility is persisted in a module-level Set keyed by messageId so
 * that items previously rendered keep their real height on remount.
 */
export function LazyMessageItem({ messageId, eager, scrollRoot, children }: LazyMessageItemProps) {
  const [visible, setVisible] = useState(eager || revealedIds.has(messageId));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;

    return registerVisibilityTarget(
      el,
      () => setVisible(true),
      scrollRoot,
    );
  }, [visible, messageId, scrollRoot]);

  // Persist visibility so remounts start visible
  useEffect(() => {
    if (visible) cappedRevealedAdd(messageId);
  }, [visible, messageId]);

  if (visible) return <>{children}</>;

  return <div ref={ref} style={{ height: PLACEHOLDER_HEIGHT, flexShrink: 0 }} />;
}
