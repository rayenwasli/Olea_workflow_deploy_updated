import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { http } from '../api/http';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { useNotifications } from '../notifications/NotificationCenter';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import type { Page } from '../types';

type NotifKind = 'chat' | 'bordereau' | 'system';

type NotifDto = {
  id: string;
  kind: NotifKind;
  title: string;
  message?: string | null;
  href?: string | null;
  read: boolean;
  createdAt: number;
};

function fmt(ts: number) {
  try {
    return new Date(ts).toLocaleString('fr-FR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function kindLabel(k: NotifKind) {
  if (k === 'chat') return 'Chat';
  if (k === 'bordereau') return 'Bordereau';
  return 'Système';
}

export function NotificationsPage() {
  const nav = useNavigate();
  const { markRead, markAllRead, clear } = useNotifications();

  const [rows, setRows] = useState<NotifDto[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, 350);
  const [kind, setKind] = useState<'ALL' | NotifKind>('ALL');
  const [read, setRead] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');


  const exportColumns = useMemo(() => ([
    { header: 'Date', value: (n: NotifDto) => fmt(n.createdAt) },
    { header: 'Type', value: (n: NotifDto) => kindLabel(n.kind) },
    { header: 'Titre', value: (n: NotifDto) => n.title },
    { header: 'Message', value: (n: NotifDto) => n.message ?? '' },
    { header: 'Lu', value: (n: NotifDto) => (n.read ? 'Oui' : 'Non') },
    { header: 'Lien', value: (n: NotifDto) => n.href ?? '' },
  ]), []);

  const exportFilters = useMemo(() => ({
    Recherche: q?.trim() ? q.trim() : '—',
    Type: kind === 'ALL' ? 'Tous' : kindLabel(kind as any),
    Statut: read === 'ALL' ? 'Tous' : read === 'UNREAD' ? 'Non lus' : 'Lus',
  }), [q, kind, read]);

  const fetchAllForExport = async () => {
    const items: NotifDto[] = [];
    let p = 1;
    const pageSize = 200;
    while (true) {
      const params: any = { page: p, size: pageSize, paginate: 1 };
      if (q?.trim()) params.q = q.trim();
      if (kind !== 'ALL') params.kind = kind;
      if (read === 'UNREAD') params.read = false;
      if (read === 'READ') params.read = true;
      const r = await http.get<Page<NotifDto>>('/notifications', { params });
      items.push(...(r.data.items || []));
      const pages = r.data.pages || 1;
      if (p >= pages) break;
      p += 1;
      if (items.length >= 10000) break;
    }
    return items;
  };

  const params = useMemo(() => {
    const p: any = { page, size, paginate: 1 };
    if (q.trim()) p.q = q.trim();
    if (kind !== 'ALL') p.kind = kind;
    if (read === 'UNREAD') p.read = false;
    if (read === 'READ') p.read = true;
    return p;
  }, [page, size, q, kind, read]);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await http.get<Page<NotifDto>>('/notifications', { params });
      setRows(r.data.items || []);
      setTotal(r.data.total || 0);
      setPages(r.data.pages || 1);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const onOpen = (n: NotifDto) => {
    // mark as read in global center + backend
    if (!n.read) markRead(n.id);

    if (n.href) nav(n.href);
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="h1">Notifications</div>
            <div className="muted">Historique (persistant) + filtres + pagination.</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={markAllRead} disabled={loading}>
              Tout lu
            </button>
            <button className="btn danger" onClick={clear} disabled={loading}>
              Vider
            </button>
            <button className="btn" onClick={reload} disabled={loading}>
              Recharger
            </button>
          </div>
        </div>
        {error ? <div className="mt-3 badge danger">{error}</div> : null}
      </div>

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div style={{ minWidth: 260 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
              Recherche
            </label>
            <input
              className="input"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                setPage(1);
              }}
              placeholder="Titre, message…"
            />
          </div>

          <div style={{ width: 220 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
              Type
            </label>
            <select
              className="input"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="ALL">Tous</option>
              <option value="chat">Chat</option>
              <option value="bordereau">Bordereau</option>
              <option value="system">Système</option>
            </select>
          </div>

          <div style={{ width: 220 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
              Statut
            </label>
            <select
              className="input"
              value={read}
              onChange={(e) => {
                setRead(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="ALL">Tous</option>
              <option value="UNREAD">Non lus</option>
              <option value="READ">Lus</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button className="btn" onClick={reload} disabled={loading}>
              Appliquer
            </button>
            <button
              className="btn"
              onClick={() => {
                setQInput('');
                setKind('ALL');
                setRead('ALL');
                setPage(1);
              }}
              disabled={loading}
            >
              Réinitialiser
            </button>
          </div>

          <div className="ml-auto">
            <ExportButtons
              title="Notifications"
              filenameBase="notifications"
              columns={exportColumns}
              rows={rows}
              filters={exportFilters}
              totalCount={total}
              totalLabel="Toutes les notifications"
              fetchAll={fetchAllForExport}
              disabled={loading}
              orientation="landscape"
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Titre</th>
                <th>Message</th>
                <th>Lu</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const clickable = !!n.href;
                return (
                  <tr
                    key={n.id}
                    className={clickable ? 'cursor-pointer' : ''}
                    onClick={() => clickable && onOpen(n)}
                    title={clickable ? 'Ouvrir' : ''}
                  >
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div className="flex items-center gap-2">
                        {!n.read ? <span className="h-2 w-2 rounded-full bg-olea-800" /> : null}
                        <span>{fmt(n.createdAt)}</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge">{kindLabel(n.kind)}</span>
                    </td>
                    <td style={{ maxWidth: 360 }}>
                      <div className="truncate font-semibold">{n.title}</div>
                    </td>
                    <td style={{ maxWidth: 520 }}>
                      <div className="truncate text-sm text-slate-600">{n.message ?? ''}</div>
                    </td>
                    <td>{n.read ? <span className="badge ok">Oui</span> : <span className="badge">Non</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex justify-end gap-2">
                        {!n.read ? (
                          <button
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              markRead(n.id);
                              // optimistically update the current list
                              setRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                            }}
                          >
                            Marquer lu
                          </button>
                        ) : null}
                        {n.href ? (
                          <button
                            className="btn primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(n);
                            }}
                          >
                            Ouvrir
                          </button>
                        ) : (
                          <button className="btn" disabled>
                            —
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 18 }}>
                    {loading ? 'Chargement…' : 'Aucune notification.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pages={pages}
          size={size}
          total={total}
          onPageChange={(p) => setPage(p)}
          onSizeChange={(s) => {
            setSize(s);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
