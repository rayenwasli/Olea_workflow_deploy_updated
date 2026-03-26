import React, { useEffect, useMemo, useState } from 'react';
import { http } from '../api/http';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import type { ClientAssignment, Page } from '../types';

type Responsable = { id: number; email: string };

export function AdminAffectations() {
  const [clients, setClients] = useState<ClientAssignment[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [responsables, setResponsables] = useState<Responsable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<ClientAssignment | null>(null);
  const [selected, setSelected] = useState<number[]>([]);

  // filters
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, 350);
  const [responsableId, setResponsableId] = useState<'ALL' | number>('ALL');

  const exportColumns = useMemo(() => ([
    { header: 'Client', value: (c: ClientAssignment) => c.name },
    { header: 'Responsables', value: (c: ClientAssignment) => (c.responsables ?? []).map(r => r.email).join(', ') },
    { header: 'Nb responsables', value: (c: ClientAssignment) => (c.responsables ?? []).length, align: 'right' as const },
  ]), []);

  const exportFilters = useMemo(() => ({
    Recherche: q?.trim() ? q.trim() : '—',
    Responsable: responsableId === 'ALL' ? 'Tous' : (responsables.find(r => r.id === responsableId)?.email ?? `#${responsableId}`),
  }), [q, responsableId, responsables]);

  const fetchAllForExport = async () => {
    const items: ClientAssignment[] = [];
    let p = 1;
    const pageSize = 200;
    while (true) {
      const params: any = { page: p, size: pageSize };
      if (q?.trim()) params.q = q.trim();
      if (responsableId !== 'ALL') params.responsableId = responsableId;
      const r = await http.get<Page<ClientAssignment>>('/admin/assignments/clients', { params });
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
      const [c, r] = await Promise.all([
        http.get<Page<ClientAssignment>>('/admin/assignments/clients', {
          params: {
            page,
            size,
            ...(q.trim() ? { q: q.trim() } : {}),
            ...(responsableId !== 'ALL' ? { responsableId } : {}),
          },
        }),
        http.get<Responsable[]>('/admin/assignments/responsables'),
      ]);
      setClients(c.data.items);
      setTotal(c.data.total);
      setPages(c.data.pages);
      setResponsables(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [page, size, q, responsableId]);

  const edit = (c: ClientAssignment) => {
    setClient(c);
    setSelected((c.responsables ?? []).map(x => x.id));
    setOpen(true);
  };

  const toggle = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const save = async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      await http.put(`/admin/assignments/clients/${client.id}`, { responsableIds: selected });
      setOpen(false);
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="h1">Affectations</div>
            <div className="muted">Affecter des responsables client aux clients.</div>
          </div>
          <button className="btn" onClick={reload} disabled={loading}>Recharger</button>
        </div>
        {error ? <div className="mt-3 badge danger">{error}</div> : null}
      </div>

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div style={{ minWidth: 260 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Recherche</label>
            <input
              className="input"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value);
                setPage(1);
              }}
              placeholder="Client, responsable…"
            />
          </div>
          <div style={{ width: 320 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Responsable</label>
            <select
              className="input"
              value={responsableId}
              onChange={(e) => {
                const v = e.target.value;
                setResponsableId(v === 'ALL' ? 'ALL' : Number(v));
                setPage(1);
              }}
            >
              <option value="ALL">Tous</option>
              {responsables.map((r) => (
                <option key={r.id} value={r.id}>{r.email}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={reload} disabled={loading}>Appliquer</button>
            <button
              className="btn"
              onClick={() => {
                setQInput('');
                setResponsableId('ALL');
                setPage(1);
              }}
              disabled={loading}
            >
              Réinitialiser
            </button>
          </div>

          <div className="ml-auto">
            <ExportButtons
              title="Affectations"
              filenameBase="affectations"
              columns={exportColumns}
              rows={clients}
              filters={exportFilters}
              totalCount={total}
              totalLabel="Tous les clients"
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
                <th>Client</th>
                <th>Responsables</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 900 }}>{c.name}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(c.responsables ?? []).length ? c.responsables.map(r => (
                        <span key={r.id} className="badge">{r.email}</span>
                      )) : <span className="muted">—</span>}
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn primary" onClick={() => edit(c)} disabled={loading}>Éditer</button>
                    </div>
                  </td>
                </tr>
              ))}
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={client ? `Affectations • ${client.name}` : 'Affectations'}
        width={760}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Annuler</button>
            <button className="btn primary" onClick={save} disabled={loading}>Enregistrer</button>
          </>
        }
      >
        <div className="muted">Sélectionnez les responsables client pour ce client.</div>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
          {responsables.map((r) => (
            <label key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--border)', padding: '10px 12px', borderRadius: 14 }}>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              <span>{r.email}</span>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}
