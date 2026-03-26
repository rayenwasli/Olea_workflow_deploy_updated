import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { http } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { AttachmentPreviewModal } from '../components/AttachmentPreviewModal';
import type { BordereauChatMessage } from '../types';

type MeDto = { id: number; email: string; roles?: string[] };

type SidebarUser = { id: number; email: string };

type UiMessage = BordereauChatMessage & {
  optimistic?: boolean;
  failed?: boolean;
};

function uid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function localPart(email: string) {
  const i = email.indexOf('@');
  return i > 0 ? email.slice(0, i) : email;
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

function safeTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function shortPreview(m: BordereauChatMessage) {
  if (m.type === 'TEXT') {
    const t = (m.content ?? '').trim();
    return t.length > 80 ? t.slice(0, 80) + '…' : t;
  }
  if (m.type === 'IMAGE') return '📷 Image';
  if (m.type === 'VOICE') return '🎤 Message vocal';
  const pdf = isPdf(m.mimeType ?? null, m.fileName ?? m.content ?? null);
  return pdf ? '📄 PDF' : '📎 Fichier';
}

export function BordereauChatCard({ bordereauId }: { bordereauId: number }) {
  const auth = useAuth();

  const [me, setMe] = useState<MeDto | null>(null);
  const [users, setUsers] = useState<SidebarUser[]>([]);
  const emailById = useMemo(() => new Map(users.map((u) => [u.id, u.email])), [users]);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pins, setPins] = useState<BordereauChatMessage[]>([]);

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wsState, setWsState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; fileName?: string | null; mimeType?: string | null; title?: string } | null>(null);

  const mentionMatches = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.trim().toLowerCase();
    const base = users
      .map((u) => ({ ...u, lp: localPart(u.email).toLowerCase() }))
      .filter((u) => (q ? u.lp.startsWith(q) : true));
    return base.slice(0, 8);
  }, [mentionOpen, mentionQuery, users]);

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

      const usersRes = await http.get<SidebarUser[]>('/chat/users');
      setUsers(usersRes.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await http.get<BordereauChatMessage[]>(`/bordereaux/${bordereauId}/chat/history`);
      setMessages(res.data as UiMessage[]);
      setTimeout(scrollToBottom, 0);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const loadPins = async () => {
    try {
      const res = await http.get<BordereauChatMessage[]>(`/bordereaux/${bordereauId}/chat/pins`);
      setPins(res.data || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!auth.token) return;
    void loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token || !bordereauId) return;
    void loadHistory();
    void loadPins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, bordereauId]);

  // Socket connection
  useEffect(() => {
    if (!auth.token || !bordereauId) return;

    setWsState('connecting');
    const s = io('/', {
      path: '/ws',
      auth: { token: auth.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 800,
    });

    socketRef.current = s;

    s.on('connect', () => {
      setWsState('connected');
      s.emit('bordereau.chat.join', { bordereauId }, () => undefined);
    });
    s.on('disconnect', () => setWsState('disconnected'));

    s.on('bordereau.chat.message', (m: BordereauChatMessage) => {
      if (!m || Number(m.bordereauId) !== Number(bordereauId)) return;
      setMessages((prev) => {
        const cid = m.clientMessageId ?? null;
        const filtered = cid ? prev.filter((x) => x.clientMessageId !== cid) : prev;
        return [...filtered, m];
      });
      if (m.pinnedAt) void loadPins();
      setTimeout(scrollToBottom, 0);
    });

    s.on('bordereau.chat.pin', (_p: any) => {
      void loadPins();
      // Also update message list badges if present
      setMessages((prev) => prev.map((x) => {
        if (Number(x.id) !== Number(_p?.messageId)) return x;
        return { ...x, pinnedAt: _p?.pinnedAt ?? null, pinnedByUserId: _p?.pinnedByUserId ?? null };
      }));
    });

    return () => {
      s.emit('bordereau.chat.leave', { bordereauId }, () => undefined);
      s.disconnect();
      socketRef.current = null;
    };
  }, [auth.token, bordereauId]);

  const updateMentionState = (next: string) => {
    setText(next);
    const m = /(^|\s)@([a-zA-Z0-9._-]{0,80})$/.exec(next);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[2] || '');
    } else {
      setMentionOpen(false);
      setMentionQuery('');
    }
  };

  const applyMention = (email: string) => {
    const lp = localPart(email);
    const next = text.replace(/(^|\s)@([a-zA-Z0-9._-]{0,80})$/, `$1@${lp} `);
    setText(next);
    setMentionOpen(false);
    setMentionQuery('');
  };

  const sendText = () => {
    if (!me || !bordereauId) return;
    const t = text.trim();
    if (!t) return;

    const clientMessageId = uid();
    setText('');
    setMentionOpen(false);
    setError(null);

    const optimistic: UiMessage = {
      id: -Date.now(),
      bordereauId,
      senderId: me.id,
      content: t,
      type: 'TEXT',
      sentAt: new Date().toISOString(),
      clientMessageId,
      optimistic: true,
    };

    setMessages((prev) => [...prev, optimistic]);
    setTimeout(scrollToBottom, 0);

    socketRef.current?.emit(
      'bordereau.chat.send',
      { bordereauId, type: 'TEXT', content: t, clientMessageId },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok) {
          setMessages((prev) => prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, failed: true, optimistic: false } : m)));
          setError(ack?.error ?? 'Envoi impossible');
        }
      }
    );
  };

  const onUploadOne = async (file: File) => {
    if (!me || !bordereauId) return;
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

      const msgType: BordereauChatMessage['type'] = isPreviewableImage(mimeType, originalName) ? 'IMAGE' : 'FILE';
      const clientMessageId = uid();

      const optimistic: UiMessage = {
        id: -Date.now(),
        bordereauId,
        senderId: me.id,
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
      setTimeout(scrollToBottom, 0);

      socketRef.current?.emit(
        'bordereau.chat.send',
        {
          bordereauId,
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
            setMessages((prev) => prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, failed: true, optimistic: false } : m)));
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
    for (const f of Array.from(files)) {
      // eslint-disable-next-line no-await-in-loop
      await onUploadOne(f);
    }
  };

  const togglePin = (m: BordereauChatMessage) => {
    const pinned = !m.pinnedAt;
    socketRef.current?.emit(
      'bordereau.chat.pin',
      { bordereauId, messageId: m.id, pinned },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack?.ok) setError(ack?.error ?? 'Action impossible');
      }
    );
  };

  const canPin = useMemo(() => wsState === 'connected', [wsState]);

  return (
    <div className="card p-5" id="chat">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-black text-slate-900">Discussion</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Thread du bordereau • {wsState === 'connected' ? '🟢 connecté' : wsState === 'connecting' ? '🟠 connexion…' : '🔴 hors ligne'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => { void loadHistory(); void loadPins(); }} disabled={loading}>Recharger</button>
          <label className="btn">
            <input type="file" multiple style={{ display: 'none' }} onChange={(e) => void onUploadMany(e.target.files)} />
            📎 Joindre
          </label>
        </div>
      </div>

      {error ? <div className="badge danger" style={{ marginBottom: 10 }}>{error}</div> : null}

      {pins.length ? (
        <div style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>📌 Messages épinglés</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {pins.map((p) => (
              <button
                key={p.id}
                className="badge"
                style={{ textAlign: 'left' }}
                onClick={() => {
                  const el = document.getElementById(`msg-${p.id}`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                title="Aller au message"
              >
                <b>{emailById.get(p.senderId) ?? `User#${p.senderId}`}</b> • {shortPreview(p)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        {messages.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {messages.map((m) => {
              const mine = me ? m.senderId === me.id : false;
              const sender = emailById.get(m.senderId) ?? `User#${m.senderId}`;
              const mentionedMe = me && (m.mentions || []).includes(me.id);

              return (
                <div key={`${m.id}_${m.clientMessageId ?? ''}`} id={`msg-${m.id}`} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: 680,
                      width: 'fit-content',
                      borderRadius: 14,
                      padding: 10,
                      border: mentionedMe ? '2px solid #f59e0b' : '1px solid #e5e7eb',
                      background: mine ? '#f8fafc' : 'white',
                      opacity: m.failed ? 0.55 : 1,
                    }}
                  >
                    <div className="muted" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span><b>{sender}</b>{m.pinnedAt ? ' • 📌' : ''}</span>
                      <span>{safeTime(m.sentAt)}</span>
                    </div>

                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {m.type === 'TEXT' ? (
                        m.content
                      ) : m.type === 'IMAGE' && m.mediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <button
                          type="button"
                          onClick={() => openAttachmentPreview(m.mediaUrl, { fileName: m.fileName ?? m.content ?? 'image', mimeType: m.mimeType ?? 'image/*', title: m.fileName ?? m.content ?? 'Image' })}
                          style={{ display: 'block', cursor: 'zoom-in', background: 'transparent', border: 'none', padding: 0 }}
                        >
                          <img src={m.mediaUrl} alt={m.fileName ?? m.content ?? 'image'} style={{ maxWidth: 360, borderRadius: 10 }} />
                        </button>
                      ) : (
                        <div>
                          <button
                            type="button"
                            className="underline"
                            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                            onClick={() => m.mediaUrl ? openAttachmentPreview(m.mediaUrl, { fileName: m.fileName ?? m.content, mimeType: m.mimeType ?? null, title: m.fileName ?? m.content ?? 'Fichier' }) : undefined}
                          >
                            {m.fileName ?? m.content ?? 'Fichier'}
                          </button>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {(isPdf(m.mimeType ?? null, m.fileName ?? null) ? 'PDF' : (m.mimeType ?? '')) || 'Fichier'}
                            {m.fileSize ? ` • ${formatBytes(m.fileSize)}` : ''}
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      {canPin ? (
                        <button className="btn" onClick={() => togglePin(m)} title={m.pinnedAt ? 'Désépingler' : 'Épingler'}>
                          📌
                        </button>
                      ) : null}
                      {m.optimistic ? <span className="badge">…</span> : null}
                      {m.failed ? <span className="badge danger">Échec</span> : null}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="muted">Aucun message pour ce bordereau.</div>
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

      <div style={{ marginTop: 12, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            className="input"
            value={text}
            onChange={(e) => updateMentionState(e.target.value)}
            placeholder="Écrire un message… (tape @ pour mentionner)"
            rows={2}
            style={{ resize: 'vertical' }}
            onKeyDown={(e) => {
              if (mentionOpen && e.key === 'Escape') {
                setMentionOpen(false);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
          />
          <button className="btn primary" onClick={sendText} disabled={!text.trim() || wsState !== 'connected'}>
            Envoyer
          </button>
        </div>

        {mentionOpen && mentionMatches.length ? (
          <div
            className="card"
            style={{
              position: 'absolute',
              left: 0,
              bottom: 58,
              width: 320,
              padding: 8,
              zIndex: 10,
              border: '1px solid #e5e7eb',
            }}
          >
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Mentions</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {mentionMatches.map((u) => (
                <button key={u.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => applyMention(u.email)}>
                  @{localPart(u.email)} <span className="muted" style={{ marginLeft: 8 }}>{u.email}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="help" style={{ marginTop: 8 }}>
          Astuce: mentionne quelqu'un avec <b>@prenom.nom</b> (la partie avant @ de son email). La notification part seulement si le match est unique.
        </div>
      </div>
    </div>
  );
}
