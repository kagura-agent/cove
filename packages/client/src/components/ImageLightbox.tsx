import { useEffect, useCallback } from 'react';

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        cursor: 'zoom-out',
      }}
    >
      {/* Top-right action bar */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 16, right: 16,
          display: 'flex', gap: 8, alignItems: 'center',
        }}
      >
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#dbdee1', fontSize: 13,
            textDecoration: 'none', padding: '4px 8px',
            borderRadius: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
        >
          Open original
        </a>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#dbdee1', fontSize: 20, padding: '4px 8px',
            borderRadius: 4, lineHeight: 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={e => (e.currentTarget.style.color = '#dbdee1')}
        >✕</button>
      </div>
      <img
        src={src}
        alt={alt}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          objectFit: 'contain',
          cursor: 'default',
        }}
      />
    </div>
  );
}
