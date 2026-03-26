import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { http } from '../api/http';

export type NotificationKind = 'chat' | 'bordereau' | 'system';

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  message?: string;
  href?: string;
  createdAt?: number;
  read?: boolean;
};

type NotificationState = Required<Omit<NotificationItem, 'message' | 'href'>> & {
  message?: string;
  href?: string;
};

type Ctx = {
  items: NotificationState[];
  unreadCount: number;
  add: (n: NotificationItem) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
};

const NotificationContext = createContext<Ctx | null>(null);

const STORAGE_PREFIX = 'scan.notifications.';
const MAX_ITEMS = 200;

function keyFor(email: string | null) {
  return `${STORAGE_PREFIX}${email ?? 'guest'}`;
}

function safeParse(raw: string | null): NotificationState[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        const createdAt = typeof x?.createdAt === 'number' ? x.createdAt : Date.now();
        return {
          id: String(x?.id ?? ''),
          kind: (x?.kind ?? 'system') as NotificationState['kind'],
          title: String(x?.title ?? ''),
          message: x?.message ? String(x.message) : undefined,
          href: x?.href ? String(x.href) : undefined,
          createdAt,
          read: Boolean(x?.read),
        } as NotificationState;
      })
      .filter((x) => x.id && x.title);
  } catch {
    return [];
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [items, setItems] = useState<NotificationState[]>([]);
  const emailRef = useRef<string | null>(auth.email);
  const baseTitleRef = useRef<string>(document.title || 'DocuFlow');
  const blinkTimerRef = useRef<number | null>(null);

  // Load notifications when user changes
  useEffect(() => {
    emailRef.current = auth.email;
    if (!auth.token) {
      setItems([]);
      return;
    }
    const raw = localStorage.getItem(keyFor(auth.email));
    const cached = safeParse(raw);
    setItems(cached);

    // Sync from backend (persistent per account)
    let cancelled = false;
    (async () => {
      try {
        const res = await http.get<NotificationItem[]>('/notifications', { params: { limit: 200 } });
        if (cancelled) return;
        const fromApi = (res.data || []).map((n) => ({
          id: String(n.id),
          kind: (n.kind || 'system') as NotificationState['kind'],
          title: String(n.title || ''),
          message: n.message ?? undefined,
          href: n.href ?? undefined,
          createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
          read: Boolean(n.read),
        })) as NotificationState[];

        setItems((prev) => {
          const map = new Map<string, NotificationState>();
          for (const x of prev) map.set(x.id, x);
          for (const x of fromApi) map.set(x.id, x);
          return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ITEMS);
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.token, auth.email]);

  // Persist
  useEffect(() => {
    if (!auth.token) return;
    const k = keyFor(emailRef.current);
    localStorage.setItem(k, JSON.stringify(items.slice(0, MAX_ITEMS)));
  }, [items, auth.token]);

  const add = useCallback((n: NotificationItem) => {
    const createdAt = typeof n.createdAt === 'number' ? n.createdAt : Date.now();
    const incoming: NotificationState = {
      id: n.id,
      kind: n.kind,
      title: n.title,
      message: n.message,
      href: n.href,
      createdAt,
      read: Boolean(n.read),
    };

    setItems((prev) => {
      // de-dupe by id
      if (prev.some((x) => x.id === incoming.id)) return prev;
      const next = [incoming, ...prev].sort((a, b) => b.createdAt - a.createdAt);
      return next.slice(0, MAX_ITEMS);
    });
  }, []);

  const markRead = useCallback((id: string) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)));

    // best-effort persist
    http.patch(`/notifications/${encodeURIComponent(id)}/read`).catch(() => undefined);
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));

    http.patch('/notifications/read-all').catch(() => undefined);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    const k = keyFor(emailRef.current);
    localStorage.removeItem(k);

    http.delete('/notifications').catch(() => undefined);
  }, []);

  const unreadCount = useMemo(() => items.reduce((acc, x) => acc + (x.read ? 0 : 1), 0), [items]);

  useEffect(() => {
    const baseTitle = baseTitleRef.current || 'DocuFlow';
    const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);
    const attentionTitle = unreadCount > 0 ? `(${unreadLabel}) DocuFlow` : baseTitle;

    const stopBlink = () => {
      if (blinkTimerRef.current) {
        window.clearInterval(blinkTimerRef.current);
        blinkTimerRef.current = null;
      }
    };

    const applyVisibleTitle = () => {
      document.title = document.hidden ? attentionTitle : baseTitle;
    };

    stopBlink();

    if (unreadCount <= 0) {
      document.title = baseTitle;
      return () => {
        stopBlink();
        document.title = baseTitle;
      };
    }

    if (document.hidden) {
      let showAttention = true;
      document.title = attentionTitle;
      blinkTimerRef.current = window.setInterval(() => {
        document.title = showAttention ? attentionTitle : baseTitle;
        showAttention = !showAttention;
      }, 1200);
    } else {
      document.title = baseTitle;
    }

    const handleVisibility = () => {
      stopBlink();
      if (document.hidden && unreadCount > 0) {
        let showAttention = true;
        document.title = attentionTitle;
        blinkTimerRef.current = window.setInterval(() => {
          document.title = showAttention ? attentionTitle : baseTitle;
          showAttention = !showAttention;
        }, 1200);
      } else {
        applyVisibleTitle();
      }
    };

    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      stopBlink();
      document.title = unreadCount > 0 && document.hidden ? attentionTitle : baseTitle;
    };
  }, [unreadCount]);

  const value = useMemo<Ctx>(
    () => ({ items, unreadCount, add, markRead, markAllRead, clear }),
    [items, unreadCount, add, markRead, markAllRead, clear]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
