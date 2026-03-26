import React, { useEffect } from 'react';

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  width,
}: {
  title?: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card w-full overflow-hidden flex max-h-[calc(100vh-2rem)] flex-col"
        style={{ maxWidth: width ? `${width}px` : '720px' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/70 bg-white/60 px-5 py-4">
          <div className="text-base font-black text-slate-900">{title ?? ''}</div>
          <button className="btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-5">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200/70 bg-white/60 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
