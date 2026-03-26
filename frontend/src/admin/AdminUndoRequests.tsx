import React, { useEffect, useMemo, useState } from 'react';
import { http } from '../api/http';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import type { Page, UndoRequestDto } from '../types';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

export function AdminUndoRequests() {
  const [rows, setRows] = useState<UndoRequestDto[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState<Status>('ALL');
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, 350);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const exportColumns = useMemo(() => ([
    { header: 'ID', value: (r: UndoRequestDto) => r.id, align: 'right' as const },
    { header: 'Bordereau', value: (r: UndoRequestDto) => r.bordereauReference },
    { header: 'Bordereau ID', value: (r: UndoRequestDto) => r.bordereauId, align: 'right' as const },
    { header: 'History ID', value: (r: UndoRequestDto) => r.targetHistoryId, align: 'right' as const },
    { header: 'Demandeur', value: (r: UndoRequestDto) => r.requestedByEmail },
    { header: 'Statut', value: (r: UndoRequestDto) => r.status },
    { header: 'Raison', value: (r: UndoRequestDto) => r.reason ?? '' },
    { header: 'Demandé le', value: (r: UndoRequestDto) => r.requestedAt ? new Date(r.requestedAt).toLocaleString('fr-FR') : '' },
    { header: 'Décidé le', value: (r: UndoRequestDto) => r.decidedAt ? new Date(r.decidedAt).toLocaleString('fr-FR') : '' },
    { header: 'Décidé par', value: (r: UndoRequestDto) => r.decidedByEmail ?? '' },
  ]), []);

  const exportFilters = useMemo(() => ({
    Recherche: q?.trim() ? q.trim() : '—',
    Statut: status === 'ALL' ? 'Tous' : status,
  }), [q, status]);

  const fetchAllForExport = async () => {
    const items: UndoRequestDto[] = [];
    let p = 1;
    const pageSize = 200;
    while (true) {
      const params: any = { page: p, size: pageSize };
      if (status !== 'ALL') params.status = status;
      if (q?.trim()) params.q = q.trim();
      const r = await http.get<Page<UndoRequestDto>>('/admin/undo-requests', { params });
      items.push(...r.data.items);
      if (p >= r.data.pages) break;
      p += 1;
      if (items.length >= 10000) break;
    }
    return items;
  };

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page, size };
      if (status !== 'ALL') params.status = status;
      if (q.trim()) params.q = q.trim();
      const r = await http.get<Page<UndoRequestDto>>('/admin/undo-requests', { params });
      setRows(r.data.items);
      setTotal(r.data.total);
      setPages(r.data.pages);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [status, page, size, q]);

  const approve = async (id: number) => {
    if (!confirm('Approuver et exécuter le undo ?')) return;
    setLoading(true);
    setError(null);
    try {
      await http.post(`/admin/undo-requests/${id}/approve`);
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const reject = async (id: number) => {
    if (!confirm('Rejeter la demande ?')) return;
    setLoading(true);
    setError(null);
    try {
      await http.post(`/admin/undo-requests/${id}/reject`);
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="h1">Demandes d’undo</div>
            <div className="muted">Audit + validation admin.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input"
              style={{ width: 260 }}
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                setPage(1);
              }}
              placeholder="Recherche: ref bordereau, email, raison…"
            />
            <select className="input" style={{ width: 180 }} value={status} onChange={(e) => {
                setStatus(e.target.value as Status);
                setPage(1);
              }}>
              <option value="ALL">Tous</option>
              <option value="PENDING">En attente</option>
              <option value="APPROVED">Approuvés</option>
              <option value="REJECTED">Rejetés</option>
            </select>
            <button className="btn" onClick={reload} disabled={loading}>Recharger</button>
            <button
              className="btn"
              onClick={() => {
                setQInput('');
                setStatus('ALL');
                setPage(1);
              }}
              disabled={loading}
            >
              Réinitialiser
            </button>

            <ExportButtons
              title="Demandes d’undo"
              filenameBase="undo_requests"
              columns={exportColumns}
              rows={rows}
              filters={exportFilters}
              totalCount={total}
              totalLabel="Toutes les demandes"
              fetchAll={fetchAllForExport}
              disabled={loading}
              orientation="landscape"
            />
          </div>
        </div>
        {error ? <div className="mt-3 badge danger">{error}</div> : null}
      </div>

      <div className="card p-5">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bordereau</th>
                <th>Demandeur</th>
                <th>Statut</th>
                <th>Raison</th>
                <th>Décision</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 900 }}>{r.bordereauReference}</div>
                    <div className="muted" style={{ fontSize: 12 }}>#{r.bordereauId} • history #{r.targetHistoryId}</div>
                  </td>
                  <td className="muted">{r.requestedByEmail}</td>
                  <td>
                    <span className={`badge ${r.status === 'APPROVED' ? 'ok' : r.status === 'REJECTED' ? 'danger' : 'warn'}`}>{r.status}</span>
                    <div className="muted" style={{ fontSize: 12 }}>{r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '—'}</div>
                  </td>
                  <td className="muted">{r.reason ?? '—'}</td>
                  <td>
                    <div className="muted">{r.decidedAt ? new Date(r.decidedAt).toLocaleString() : '—'}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.decidedByEmail ?? '—'}</div>
                  </td>
                  <td>
                    <div className="row-actions">
                      {r.status === 'PENDING' ? (
                        <>
                          <button className="btn ok" onClick={() => approve(r.id)} disabled={loading}>Approuver</button>
                          <button className="btn danger" onClick={() => reject(r.id)} disabled={loading}>Rejeter</button>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && !loading ? <div className="muted">Aucun élément.</div> : null}
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
