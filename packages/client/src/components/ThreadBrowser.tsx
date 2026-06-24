import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CSSProperties } from 'react';
import type { Channel } from '../types';
import { useActiveIds } from '../hooks/useActiveIds';
import { routes } from '../lib/routes';
import * as api from '../lib/api';
import { ThreadIcon } from './ThreadIcon';

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle: CSSProperties = {
  width: 480,
  maxHeight: '70vh',
  background: 'var(--bg-floating, var(--bg-secondary))',
  borderRadius: 'var(--space-sm)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: 'var(--space-md)',
  borderBottom: '1px solid var(--border-subtle)',
  gap: 'var(--space-sm)',
};

const closeBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: 'var(--font-size-xl)',
  cursor: 'pointer',
  padding: 'var(--space-xs)',
  lineHeight: 1,
};

const tabStyle: CSSProperties = {
  padding: 'var(--space-xs) var(--space-md)',
  cursor: 'pointer',
  borderRadius: 'var(--space-xs)',
  fontSize: 'var(--font-size-md)',
  fontWeight: 500,
  color: 'var(--text-muted)',
  background: 'transparent',
  border: 'none',
  transition: 'background 0.15s, color 0.15s',
};

const activeTabStyle: CSSProperties = {
  ...tabStyle,
  color: 'var(--interactive-active)',
  background: 'var(--bg-modifier-active)',
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--space-sm)',
};

const threadItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  padding: 'var(--space-sm) var(--space-md)',
  borderRadius: 'var(--space-xs)',
  cursor: 'pointer',
  transition: 'background 0.15s',
  fontSize: 'var(--font-size-md)',
  color: 'var(--text-normal)',
};

interface Props {
  channelId: string;
  onClose: () => void;
}

export function ThreadBrowser({ channelId, onClose }: Props) {
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [activeThreads, setActiveThreads] = useState<Channel[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { guildId } = useActiveIds();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.fetchActiveThreads(channelId),
      api.fetchArchivedThreads(channelId),
    ]).then(([active, archived]) => {
      setActiveThreads(active.threads);
      setArchivedThreads(archived.threads);
    }).catch(console.error).finally(() => setLoading(false));
  }, [channelId]);

  const threads = tab === 'active' ? activeThreads : archivedThreads;

  function handleClick(thread: Channel) {
    if (guildId) navigate(routes.thread(guildId, channelId, thread.id));
    onClose();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--header-primary)', flex: 1 }}>Threads</span>
          <button style={closeBtnStyle} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)', padding: '0 var(--space-md) var(--space-sm)' }}>
          <button style={tab === 'active' ? activeTabStyle : tabStyle} onClick={() => setTab('active')}>
            Active
          </button>
          <button style={tab === 'archived' ? activeTabStyle : tabStyle} onClick={() => setTab('archived')}>
            Archived
          </button>
        </div>
        <div style={listStyle} className="scroll-container">
          {loading && <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>Loading...</div>}
          {!loading && threads.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>
              No {tab} threads
            </div>
          )}
          {threads.map(t => {
            const name = t.name.length > 50 ? t.name.slice(0, 50) + '\u2026' : t.name;
            return (
              <div
                key={t.id}
                style={threadItemStyle}
                onClick={() => handleClick(t)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-modifier-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <ThreadIcon size={16} style={{ opacity: 0.5, color: 'var(--interactive-normal)' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                  {t.message_count ?? 0} messages
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
