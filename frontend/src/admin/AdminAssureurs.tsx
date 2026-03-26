import React, { useEffect, useMemo, useState } from 'react';
import { http } from '../api/http';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import type { AssureurDto, Page } from '../types';

export function AdminAssureurs() {
  const [rows, setRows] = useState<AssureurDto[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ id?: number; name: string; enabled: boolean }>({ name: '', enabled: true });

  // filters
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, 350);

  const exportColumns = useMemo(() => ([
    { header: 'ID', value: (a: AssureurDto) => a.id, align: 'right' as const },
    { header: 'Assureur', value: (a: AssureurDto) => a.name },
    { header: 'Actif', value: (a: AssureurDto) => (a.enabled !== false ? 'Oui' : 'Non') },
  ]), []);

  const exportFilters = useMemo(() => ({
    Recherche: q?.trim() ? q.trim() : '—',
  }), [q]);

  const fetchAllForExport = async () => {
    const items: AssureurDto[] = [];
    let p = 1;
    const pageSize = 200;
    while (true) {
      const params: any = { page: p, size: pageSize };
      if (q?.trim()) params.q = q.trim();
      const r = await http.get<Page<AssureurDto>>('/admin/assureurs', { params });
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
      if (q.trim()) params.q = q.trim();
      const r = await http.get<Page<AssureurDto>>('/admin/assureurs', { params });
      setRows(r.data.items);
      setTotal(r.data.total);
      setPages(r.data.pages);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, q]);

  const openCreate = () => {
    setDraft({ name: '', enabled: true });
    setOpen(true);
  };

  const openEdit = (a: AssureurDto) => {
    setDraft({ id: a.id, name: a.name, enabled: a.enabled !== false });
    setOpen(true);
  };

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!draft.name.trim()) throw new Error('Nom requis');
      if (draft.id) {
        await http.put(`/admin/assureurs/${draft.id}`, { name: draft.name, enabled: draft.enabled });
      } else {
        await http.post('/admin/assureurs', { name: draft.name });
      }
      setOpen(false);
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const del = async (a: AssureurDto) => {
    if (!confirm(`Supprimer ${a.name} ?`)) return;
    setLoading(true);
    setError(null);
    try {
      await http.delete(`/admin/assureurs/${a.id}`);
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
            <div className="h1">Assureurs</div>
            <div className="muted">Référentiel assureurs (liste déroulante dans le formulaire dépôt).</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={reload} disabled={loading}>
              Recharger
            </button>
            <button className="btn primary" onClick={openCreate} disabled={loading}>
              + Créer
            </button>
          </div>
        </div>
        {error ? <div className="mt-3 badge danger">{error}</div> : null}
      </div>

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
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
              placeholder="Nom, #id…"
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={reload} disabled={loading}>
              Appliquer
            </button>
            <button
              className="btn"
              onClick={() => {
                setQInput('');
                setPage(1);
              }}
              disabled={loading}
            >
              Réinitialiser
            </button>
          </div>

          <ExportButtons
            title="Assureurs"
            filenameBase="assureurs"
            columns={exportColumns}
            rows={rows}
            filters={exportFilters}
            totalCount={total}
            totalLabel="Tous les assureurs"
            fetchAll={fetchAllForExport}
            disabled={loading}
          />
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nom</th>
                <th>Actif</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td style={{ fontWeight: 800 }}>{a.name}</td>
                  <td>{a.enabled === false ? <span className="badge">Non</span> : <span className="badge success">Oui</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn" onClick={() => openEdit(a)} disabled={loading}>
                        Éditer
                      </button>
                      <button className="btn danger" onClick={() => del(a)} disabled={loading}>
                        Supprimer
                      </button>
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
        title={draft.id ? 'Modifier assureur' : 'Créer assureur'}
        width={560}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button className="btn primary" onClick={save} disabled={loading}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label>Nom</label>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          {draft.id ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Actif
            </label>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
