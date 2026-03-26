import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export type ToastVariant = 'info' | 'ok' | 'warn' | 'danger';

export type ToastInput = {
  title: string;
  message?: string;
  variant?: ToastVariant;
  href?: string;
  durationMs?: number;
};

type Toast = {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  href?: string;
  createdAt: number;
};

type ToastContextValue = {
  push: (t: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function uid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function variantClasses(v: ToastVariant) {
  switch (v) {
    case 'ok':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case 'warn':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'danger':
      return 'border-red-200 bg-red-50 text-red-900';
    default:
      return 'border-slate-200/70 bg-white/80 text-slate-900';
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const remove = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = uid();
      const toast: Toast = {
        id,
        title: input.title,
        message: input.message,
        variant: input.variant ?? 'info',
        href: input.href,
        createdAt: Date.now(),
      };
      setToasts((prev) => [toast, ...prev].slice(0, 6));

      const duration = input.durationMs ?? 5000;
      const timer = window.setTimeout(() => remove(id), duration);
      timers.current.set(id, timer);
    },
    [remove]
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Bottom-right popups */}
      <div className="fixed bottom-4 right-4 z-[9999] flex w-[92vw] max-w-sm flex-col gap-2 sm:w-[420px]">
        {toasts.map((t) => {
          const clickable = !!t.href;
          return (
            <div
              key={t.id}
              className={[
                'rounded-3xl border shadow-soft backdrop-blur',
                'px-4 py-3',
                variantClasses(t.variant),
                clickable ? 'cursor-pointer hover:shadow' : '',
              ].join(' ')}
              role={clickable ? 'button' : 'status'}
              tabIndex={clickable ? 0 : -1}
              onClick={() => {
                if (t.href) navigate(t.href);
              }}
              onKeyDown={(e) => {
                if (!t.href) return;
                if (e.key === 'Enter' || e.key === ' ') navigate(t.href);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black">{t.title}</div>
                  {t.message ? (
                    <div className="mt-1 max-h-10 overflow-hidden text-ellipsis text-xs text-slate-600">
                      {t.message}
                    </div>
                  ) : null}
                </div>
                <button
                  className="btn h-8 w-8 !rounded-2xl !px-0 !py-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(t.id);
                  }}
                  aria-label="Fermer"
                  title="Fermer"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
