import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useLocation } from 'react-router-dom';

import { http } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { AttachmentPreviewModal } from '../components/AttachmentPreviewModal';
import type { ChatMessage, ChatSidebarUserDto } from '../types';

type MeDto = {
  id: number;
  email: string;
  roles?: string[];
};

type UiMessage = ChatMessage & {
  optimistic?: boolean;
  failed?: boolean;
};

type PresenceUpdate = {
  userId: number;
  online: boolean;
  at?: string;
  lastSeenAt?: number | null;
};

type SeenEvent = {
  byUserId: number;
  otherUserId: number;
  lastSeenMessageId: number | null;
  seenAt: string;
};

type SidebarUser = ChatSidebarUserDto & {
  fullName?: string | null;
};

function safeTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function safeDateLabel(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'short', day: '2-digit' });
  } catch {
    return '';
  }
}

function uid() {
  // Prefer crypto.randomUUID when available.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function extOf(name?: string | null) {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  if (i < 0) return '';
  return name.slice(i + 1).toLowerCase();
}

function isPdf(mime?: string | null, fileName?: string | null) {
  if (mime && mime.toLowerCase() === 'application/pdf') return true;
  return extOf(fileName) === 'pdf';
}

// Only treat an "image/*" as previewable when browsers commonly support it.
function isPreviewableImage(mime?: string | null, fileName?: string | null) {
  const m = (mime ?? '').toLowerCase();
  const ext = extOf(fileName);

  const byMime = m.startsWith('image/')
    ? ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'].includes(m)
    : false;

  const byExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);

  return byMime || byExt;
}

function formatBytes(n?: number | null) {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const fixed = i === 0 ? 0 : 1;
  return `${v.toFixed(fixed)} ${units[i]}`;
}

function shortPreview(m: ChatMessage | null) {
  if (!m) return '';
  if (m.type === 'TEXT') {
    const t = (m.content ?? '').trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }
  if (m.type === 'IMAGE') return '📷 Image';
  if (m.type === 'VOICE') return '🎤 Message vocal';
  const pdf = isPdf(m.mimeType ?? null, m.fileName ?? m.content ?? null);
  return pdf ? '📄 PDF' : '📎 Fichier';
}

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩', '😢', '😭', '😡', '👍', '👎', '🙏', '👏', '💪',
  '🔥', '✨', '✅', '❌', '⚠️', '📌', '📎', '📷', '📄', '🎉', '❤️', '💙', '💚', '💛', '🤝',
];

export function ChatPage() {
  const auth = useAuth();
  const location = useLocation();

  const [me, setMe] = useState<MeDto | null>(null);
  const [users, setUsers] = useState<SidebarUser[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const forcedUserId = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    const raw = sp.get('user');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [location.search]);

  const [userQuery, setUserQuery] = useState('');

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wsState, setWsState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const meRef = useRef<MeDto | null>(null);
  const activeUserIdRef = useRef<number | null>(null);

  // Constrain chat view to viewport so lists scroll *inside* (no infinite page scroll)
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; fileName?: string | null; mimeType?: string | null; title?: string } | null>(null);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    activeUserIdRef.current = activeUserId;
  }, [activeUserId]);

  useEffect(() => {
    const compute = () => {
      if (!panelRef.current) return;
      const top = panelRef.current.getBoundingClientRect().top;
      const h = Math.max(520, Math.floor(window.innerHeight - top - 16));
      setPanelHeight(h);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const activeUser = useMemo(() => users.find((u) => u.id === activeUserId) ?? null, [users, activeUserId]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.fullName ?? u.email).toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, userQuery]);

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' });

  const openAttachmentPreview = (url: string, options?: { fileName?: string | null; mimeType?: string | null; title?: string }) => {
    setAttachmentPreview({ url, ...options });
  };

  const loadBootstrap = async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await http.get<MeDto>('/chat/me');
      setMe(meRes.data);

      const usersRes = await http.get<SidebarUser[]>('/chat/sidebar');
      setUsers(usersRes.data || []);

      const forced = forcedUserId;
      if (forced && (usersRes.data || []).some((u) => Number(u.id) === Number(forced))) {
        setActiveUserId(forced);
      } else if (!activeUserId && (usersRes.data || []).length) {
        setActiveUserId((usersRes.data || [])[0].id);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  // If opened from a toast (/chat?user=ID), switch to that conversation
  useEffect(() => {
    if (forcedUserId) setActiveUserId(forcedUserId);
  }, [forcedUserId]);

  const loadHistory = async (otherId: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await http.get<ChatMessage[]>(`/chat/history/${otherId}`);
      setMessages(res.data as UiMessage[]);
      setUsers((prev) => prev.map((u) => (u.id === otherId ? { ...u, unreadCount: 0 } : u)));
      setTimeout(scrollToBottom, 0);

      // Mark all incoming messages from this user as seen
      const meNow = meRef.current;
      if (meNow && socketRef.current) {
        const lastIncomingId = (res.data || [])
          .filter((m) => m.senderId === otherId && m.recipientId === meNow.id)
          .reduce((acc, m) => (m.id > acc ? m.id : acc), 0);
        if (lastIncomingId > 0) {
          socketRef.current.emit('chat.seen', { otherUserId: otherId, lastMessageId: lastIncomingId }, () => undefined);
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  // Initial bootstrap
  useEffect(() => {
    loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load history when switching conversations
  useEffect(() => {
    if (activeUserId) void loadHistory(activeUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUserId]);

  // Socket.IO connection (single connection tied to token)
  useEffect(() => {
    if (!auth.token) return;

    setWsState('connecting');
    const s = io('/', {
      path: '/ws',
      auth: { token: auth.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      timeout: 10_000,
    });

    socketRef.current = s;

    s.on('connect', () => {
      setWsState('connected');
      setError(null);
    });

    s.on('disconnect', () => {
      setWsState('disconnected');
    });

    s.on('connect_error', (err) => {
      setWsState('disconnected');
      setError(err?.message ? `WebSocket: ${err.message}` : 'WebSocket: connexion impossible');
    });

    s.on('presence.update', (p: PresenceUpdate) => {
      if (!p?.userId) return;
      setUsers((prev) =>
        prev.map((u) =>
          u.id === Number(p.userId)
            ? { ...u, online: Boolean(p.online), lastSeenAt: p.lastSeenAt ?? u.lastSeenAt ?? null }
            : u
        )
      );
    });

    const upsertActive = (incoming: ChatMessage) => {
      setMessages((prev) => {
        // Replace optimistic by clientMessageId if present
        if (incoming.clientMessageId) {
          const idx = prev.findIndex((m) => m.clientMessageId && m.clientMessageId === incoming.clientMessageId);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...(incoming as UiMessage), optimistic: false, failed: false };
            return copy;
          }
        }

        // De-dupe by id
        if (prev.some((m) => m.id === incoming.id)) return prev;
        return [...prev, incoming as UiMessage];
      });
    };

    s.on('chat.seen', (ev: SeenEvent) => {
      const meNow = meRef.current;
      if (!meNow) return;
      if (Number(ev?.otherUserId) !== Number(meNow.id)) return; // otherUserId is the sender in this event

      const byUserId = Number(ev.byUserId);
      const lastSeen = ev.lastSeenMessageId ? Number(ev.lastSeenMessageId) : null;
      const seenAtIso = ev.seenAt;

      setMessages((prev) =>
        prev.map((m) => {
          // my outgoing messages to that user
          if (m.senderId === meNow.id && m.recipientId === byUserId) {
            if (lastSeen == null || m.id <= lastSeen) {
              return { ...m, seenAt: seenAtIso };
            }
          }
          return m;
        })
      );
    });

    s.on('chat.message', (m: ChatMessage) => {
      const meNow = meRef.current;
      if (!meNow) return;

      const otherId = m.senderId === meNow.id ? m.recipientId : m.senderId;

      // Update sidebar (last message + unread count)
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== otherId) return u;

          const incomingToMe = m.recipientId === meNow.id && m.senderId === otherId;
          const isActive = Number(activeUserIdRef.current) === Number(otherId);

          const unreadNext = incomingToMe && !isActive ? (Number(u.unreadCount || 0) + 1) : u.unreadCount;
          return {
            ...u,
            lastMessage: m,
            unreadCount: isActive ? 0 : unreadNext,
          };
        })
      );

      // Only append if it concerns the active conversation.
      const otherActive = activeUserIdRef.current;
      if (!otherActive) return;
      const relevant =
        (m.senderId === meNow.id && m.recipientId === otherActive) ||
        (m.senderId === otherActive && m.recipientId === meNow.id);

      if (!relevant) return;

      upsertActive(m);
      setTimeout(scrollToBottom, 0);

      // If it's an incoming message from the active user, mark seen
      const isIncomingFromActive = m.senderId === otherActive && m.recipientId === meNow.id;
      if (isIncomingFromActive) {
        s.emit('chat.seen', { otherUserId: otherActive, lastMessageId: m.id }, () => undefined);
      }
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [auth.token]);

  const bumpSidebarLastMessage = (otherId: number, m: ChatMessage) => {
    setUsers((prev) => prev.map((u) => (u.id === otherId ? { ...u, lastMessage: m } : u)));
  };

  const sendText = async () => {
    if (!me || !activeUserId) return;
    const t = text.trim();
    if (!t) return;

    const clientMessageId = uid();
    setText('');
    setError(null);

    // Optimistic UI
    const optimistic: UiMessage = {
      id: -Date.now(),
      senderId: me.id,
      recipientId: activeUserId,
      content: t,
      type: 'TEXT',
      sentAt: new Date().toISOString(),
      clientMessageId,
      optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    bumpSidebarLastMessage(activeUserId, optimistic);
    setTimeout(scrollToBottom, 0);

    socketRef.current?.emit(
      'chat.send',
      {
        recipientId: activeUserId,
        type: 'TEXT',
        content: t,
        clientMessageId,
      },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok) {
          setMessages((prev) =>
            prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, failed: true, optimistic: false } : m))
          );
          setError(ack?.error ?? 'Envoi impossible');
        }
      }
    );
  };

  const onUploadOne = async (file: File) => {
    if (!me || !activeUserId) return;
    setError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      const up = await http.post('/chat/upload', form);

      const mediaUrl = up.data?.url as string | undefined;
      const originalName = (up.data?.originalName ?? file.name) as string;
      const mimeType = (up.data?.mimeType ?? file.type ?? null) as string | null;
      const size = (up.data?.size ?? file.size ?? null) as number | null;

      if (!mediaUrl) throw new Error('Upload: URL manquante');

      // If it's an image that many browsers can preview, render as IMAGE. Otherwise render as FILE.
      const msgType: ChatMessage['type'] = isPreviewableImage(mimeType, originalName) ? 'IMAGE' : 'FILE';
      const clientMessageId = uid();

      // Optimistic message
      const optimistic: UiMessage = {
        id: -Date.now(),
        senderId: me.id,
        recipientId: activeUserId,
        content: originalName,
        type: msgType,
        mediaUrl,
        mimeType,
        fileName: originalName,
        fileSize: size,
        sentAt: new Date().toISOString(),
        clientMessageId,
        optimistic: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      bumpSidebarLastMessage(activeUserId, optimistic);
      setTimeout(scrollToBottom, 0);

      socketRef.current?.emit(
        'chat.send',
        {
          recipientId: activeUserId,
          type: msgType,
          content: originalName,
          mediaUrl,
          mimeType,
          fileName: originalName,
          fileSize: size,
          clientMessageId,
        },
        (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) {
            setMessages((prev) =>
              prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, failed: true, optimistic: false } : m))
            );
            setError(ack?.error ?? 'Envoi impossible');
          }
        }
      );
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Upload impossible');
    }
  };

  const onUploadMany = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    // Sequential uploads -> simpler UX + avoids spamming the socket at once
    for (const f of Array.from(files)) {
      // eslint-disable-next-line no-await-in-loop
      await onUploadOne(f);
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      const e = textareaRef.current;
      if (!e) return;
      e.focus();
      const pos = start + emoji.length;
      e.selectionStart = pos;
      e.selectionEnd = pos;
    });
  };

  const groups = useMemo(() => {
    // Simple day grouping for readability.
    const out: Array<{ day: string; items: UiMessage[] }> = [];
    const byDay = new Map<string, UiMessage[]>();
    for (const m of messages) {
      const day = safeDateLabel(m.sentAt);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(m);
    }
    for (const [day, items] of byDay.entries()) out.push({ day, items });
    return out;
  }, [messages]);

  return (
    <div ref={panelRef} className="overflow-hidden" style={panelHeight ? { height: panelHeight } : undefined}>
      <div className="flex h-full flex-col gap-4">
        <div className="card shrink-0 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="h1">Chat</div>
              <div className="muted">Messagerie interne en temps réel (Socket.IO)</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={'badge ' + (wsState === 'connected' ? 'ok' : wsState === 'connecting' ? 'warn' : 'danger')}
                title={wsState === 'connected' ? 'Connecté' : wsState === 'connecting' ? 'Connexion…' : 'Déconnecté'}
              >
                {wsState === 'connected' ? 'En ligne' : wsState === 'connecting' ? 'Connexion…' : 'Hors ligne'}
              </span>
              <button className="btn" onClick={loadBootstrap} disabled={loading}>
                Recharger
              </button>
            </div>
          </div>
          {error ? <div className="mt-3 badge danger">{error}</div> : null}
        </div>

        <div className="grid flex-1 min-h-0 gap-4 lg:grid-cols-12">
          {/* Users */}
          <div className="card flex min-h-0 flex-col overflow-hidden lg:col-span-4">
            <div className="border-b border-slate-200/70 bg-white/60 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-900">Utilisateurs</div>
                  <div className="mt-1 text-xs text-slate-500">Sélectionnez une conversation</div>
                </div>
                <div className="w-40">
                  <input
                    className="input h-9 px-3 py-2 text-xs"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Rechercher…"
                  />
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {filteredUsers.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 text-sm text-slate-600">—</div>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map((u) => {
                    const active = u.id === activeUserId;
                    const last = u.lastMessage;
                    const lastLine = last
                      ? `${last.senderId === me?.id ? 'Vous: ' : ''}${shortPreview(last)}`
                      : '';
                    return (
                      <button
                        key={u.id}
                        className={[
                          'w-full rounded-2xl border px-4 py-3 text-left transition',
                          active
                            ? 'border-olea-200 bg-olea-50 shadow-sm'
                            : 'border-slate-200/70 bg-white/60 hover:bg-white',
                        ].join(' ')}
                        onClick={() => setActiveUserId(u.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={
                                  'inline-block h-2 w-2 rounded-full ' + (u.online ? 'bg-emerald-500' : 'bg-slate-300')
                                }
                                title={u.online ? 'En ligne' : 'Hors ligne'}
                              />
                              <div className="truncate text-sm font-black text-slate-900">{u.fullName ?? u.email}</div>
                            </div>
                            <div className="truncate text-xs text-slate-500">{u.email}</div>
                            {lastLine ? <div className="mt-1 truncate text-xs text-slate-600">{lastLine}</div> : null}
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            {u.unreadCount > 0 ? (
                              <span className="badge bg-olea-800 text-white">{u.unreadCount > 99 ? '99+' : u.unreadCount}</span>
                            ) : active ? (
                              <span className="badge ok">Actif</span>
                            ) : null}
                            {last?.sentAt ? (
                              <span className="text-[11px] font-semibold text-slate-500">{safeTime(last.sentAt)}</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Conversation */}
          <div className="card flex min-h-0 flex-col overflow-hidden lg:col-span-8">
            <div className="border-b border-slate-200/70 bg-white/60 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-900">
                    {activeUser ? activeUser.fullName ?? activeUser.email : '—'}
                  </div>
                  <div className="truncate text-xs text-slate-500">{activeUser ? activeUser.email : ''}</div>
                </div>

                <label className="btn cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf"
                    multiple
                    onChange={(e) => {
                      void onUploadMany(e.target.files);
                      e.currentTarget.value = '';
                    }}
                  />
                  Joindre
                </label>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 text-sm text-slate-600">—</div>
              ) : (
                <div className="space-y-5">
                  {groups.map((g) => (
                    <div key={g.day} className="space-y-3">
                      <div className="flex justify-center">
                        <span className="badge">{g.day}</span>
                      </div>

                      {g.items.map((m) => {
                        const mine = !!me && m.senderId === me.id;
                        const bubble = mine
                          ? 'bg-gradient-to-r from-olea-800 to-olea-700 text-white'
                          : 'bg-white/70 text-slate-900';
                        const meta = mine ? 'text-white/70' : 'text-slate-500';

                        const previewImg =
                          m.type === 'IMAGE' &&
                          m.mediaUrl &&
                          isPreviewableImage(m.mimeType ?? null, m.fileName ?? m.content);
                        const pdf = !!m.mediaUrl && isPdf(m.mimeType ?? null, m.fileName ?? m.content);

                        const statusLabel = (() => {
                          if (!mine) return null;
                          if (m.failed) return 'Échec';
                          if (m.optimistic) return '…';
                          if (m.seenAt) return '✓✓ Vu';
                          if (m.deliveredAt) return '✓✓ Livré';
                          return '✓ Envoyé';
                        })();

                        return (
                          <div key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                            <div className={['max-w-[92%] rounded-3xl px-4 py-3 text-sm shadow-sm', bubble].join(' ')}>
                              {/* Content */}
                              {m.type === 'TEXT' ? (
                                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                              ) : previewImg ? (
                                <div className="space-y-2">
                                  <button
                                    type="button"
                                    onClick={() => openAttachmentPreview(m.mediaUrl!, { fileName: m.fileName ?? m.content ?? 'image', mimeType: m.mimeType ?? 'image/*', title: m.fileName ?? m.content ?? 'Image' })}
                                    className="block cursor-zoom-in"
                                    style={{ background: 'transparent', border: 'none', padding: 0 }}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={m.mediaUrl!}
                                      alt={m.fileName ?? m.content ?? 'image'}
                                      className="max-h-[260px] rounded-2xl ring-1 ring-white/10"
                                      loading="lazy"
                                    />
                                  </button>
                                  <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
                                    <div className="truncate">{m.fileName ?? m.content}</div>
                                    {m.fileSize ? <span>• {formatBytes(m.fileSize)}</span> : null}
                                  </div>
                                </div>
                              ) : m.mediaUrl ? (
                                <button
                                  type="button"
                                  onClick={() => openAttachmentPreview(m.mediaUrl!, { fileName: m.fileName ?? m.content, mimeType: m.mimeType ?? null, title: m.fileName ?? m.content ?? 'Fichier' })}
                                  className={
                                    mine
                                      ? 'inline-flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15'
                                      : 'inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200'
                                  }
                                  style={{ border: 'none', cursor: 'pointer' }}
                                >
                                  {pdf ? (
                                    <span className={mine ? 'badge bg-white/15 text-white' : 'badge'}>PDF</span>
                                  ) : (
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                                      <path
                                        d="M12 3v10m0 0 4-4m-4 4-4-4"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  )}
                                  <span className="truncate">{m.fileName ?? m.content ?? 'Ouvrir'}</span>
                                  {m.fileSize ? (
                                    <span className={mine ? 'text-white/70' : 'text-slate-500'}>({formatBytes(m.fileSize)})</span>
                                  ) : null}
                                </button>
                              ) : (
                                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                              )}

                              {/* Meta */}
                              <div className={['mt-2 flex items-center justify-end gap-2 text-xs', meta].join(' ')}>
                                {statusLabel ? <span className="font-bold">{statusLabel}</span> : null}
                                <span>{safeTime(m.sentAt)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <AttachmentPreviewModal
              open={!!attachmentPreview}
              onClose={() => setAttachmentPreview(null)}
              url={attachmentPreview?.url ?? null}
              fileName={attachmentPreview?.fileName}
              mimeType={attachmentPreview?.mimeType}
              title={attachmentPreview?.title}
            />

            <div className="border-t border-slate-200/70 bg-white/60 p-3">
              <div className="relative flex items-end gap-2">
                {emojiOpen ? (
                  <div className="absolute bottom-[56px] left-0 z-20 w-[min(320px,90vw)] rounded-3xl border border-slate-200/70 bg-white p-3 shadow-soft">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-black text-slate-700">Emojis</div>
                      <button className="btn !px-2 !py-1" onClick={() => setEmojiOpen(false)}>
                        Fermer
                      </button>
                    </div>
                    <div className="grid grid-cols-10 gap-1">
                      {EMOJIS.map((e) => (
                        <button
                          key={e}
                          className="h-8 w-8 rounded-2xl hover:bg-slate-100"
                          onClick={() => insertEmoji(e)}
                          type="button"
                          title={e}
                        >
                          <span className="text-lg">{e}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <textarea
                  ref={textareaRef}
                  className="input min-h-[44px] resize-none"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={wsState === 'connected' ? 'Écrire un message…' : 'Hors ligne — vérifiez la connexion'}
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendText();
                    }
                  }}
                />

                <button
                  className="btn"
                  type="button"
                  onClick={() => setEmojiOpen((v) => !v)}
                  title="Emojis"
                  aria-label="Emojis"
                >
                  😊
                </button>

                <button className="btn primary" onClick={sendText} disabled={!text.trim() || wsState !== 'connected'}>
                  Envoyer
                </button>
              </div>
              <div className="mt-2 text-xs text-slate-500">Entrée pour envoyer • Shift+Entrée pour aller à la ligne</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
