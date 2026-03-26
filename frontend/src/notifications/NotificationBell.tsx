import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from './NotificationCenter';

function useClickOutside(ref: React.RefObject<HTMLElement>, onOutside: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      onOutside();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, onOutside]);
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function NotificationBell() {
  const nav = useNavigate();
  const { items, unreadCount, markRead, markAllRead, clear } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useClickOutside(rootRef, () => setOpen(false));

  const topItems = useMemo(() => items.slice(0, 10), [items]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="btn h-10 w-10 !rounded-2xl !px-0 !py-0"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
      >
        <span className="relative inline-flex items-center justify-center">
          {/* Bell icon */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M13.73 21a2 2 0 01-3.46 0"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          {unreadCount > 0 ? (
            <span className="absolute -right-2 -top-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-olea-800 px-1 text-[11px] font-black text-white shadow">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[92vw] max-w-md rounded-3xl border border-slate-200/70 bg-white/90 shadow-soft backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="text-sm font-black text-slate-900">Notifications</div>
            <div className="flex items-center gap-2">
              <button className="btn !px-3" onClick={markAllRead}>
                Tout lu
              </button>
              <button className="btn danger !px-3" onClick={clear}>
                Vider
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-auto px-2 pb-2">
            {topItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">Aucune notification</div>
            ) : (
              <div className="flex flex-col gap-2">
                {topItems.map((n) => {
                  const clickable = !!n.href;
                  return (
                    <div
                      key={n.id}
                      className={[
                        'rounded-3xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm',
                        clickable ? 'cursor-pointer hover:bg-white' : '',
                      ].join(' ')}
                      role={clickable ? 'button' : 'status'}
                      tabIndex={clickable ? 0 : -1}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                        if (n.href) nav(n.href);
                      }}
                      onKeyDown={(e) => {
                        if (!n.href) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          markRead(n.id);
                          setOpen(false);
                          nav(n.href);
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {!n.read ? <span className="h-2 w-2 rounded-full bg-olea-800" /> : null}
                            <div className="truncate text-sm font-black text-slate-900">{n.title}</div>
                          </div>
                          {n.message ? (
                            <div className="mt-1 max-h-10 overflow-hidden text-ellipsis text-xs text-slate-600">
                              {n.message}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-xs font-semibold text-slate-500">
                          {formatTime(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 px-4 py-3">
            <button
              className="btn !px-3"
              onClick={() => {
                setOpen(false);
                nav('/notifications');
              }}
            >
              Voir tout
            </button>
            <div className="text-xs font-semibold text-slate-500">
              {items.length > 0 ? `${Math.min(items.length, 200)} derniers` : ''}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
