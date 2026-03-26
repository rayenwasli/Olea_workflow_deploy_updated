import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../api/http';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import type { BordereauDto, Page } from '../types';

const FLOW = ['CREE','RECUPERE_BO','DEPOSE_SCAN','SCANNE','VERIFIE','PRET_A_ENVOYER','RECU_DU_RESPONSABLE','DONNE_AU_COURSIER','FINALISE','VALIDE'] as const;
function sortStatusCounts(items: { status: string; count: number }[]) {
  const idx = new Map(FLOW.map((s, i) => [s, i]));
  return [...items].sort((a, b) => (idx.get(a.status as any) ?? 999) - (idx.get(b.status as any) ?? 999));
}

export function AdminBordereaux() {
  const [rows, setRows] = useState<BordereauDto[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, 350);
  const [status, setStatus] = useState<'ALL' | BordereauDto['currentStatus']>('ALL');
  const [priority, setPriority] = useState<'ALL' | 'YES' | 'NO'>('ALL');

  const exportColumns = useMemo(() => ([
    { header: 'ID', value: (b: BordereauDto) => b.id, align: 'right' as const },
    { header: 'Référence', value: (b: BordereauDto) => b.reference },
    { header: 'Client', value: (b: BordereauDto) => b.clientName ?? '' },
    { header: 'Type', value: (b: BordereauDto) => b.documentType ?? '' },
    { header: 'Statut', value: (b: BordereauDto) => (b.childrenStatusCounts?.length ? b.childrenStatusCounts.map(s => `${s.status}:${s.count}`).join(' | ') : b.currentStatus) },
    { header: 'Priorité', value: (b: BordereauDto) => (b.priority ? `Oui (${b.priorityRank ?? 1})` : 'Non') },
    { header: 'Créé le', value: (b: BordereauDto) => b.createdAt },
  ]), []);

  const exportFilters = useMemo(() => ({
    Recherche: q?.trim() ? q.trim() : '—',
    Statut: status === 'ALL' ? 'Tous' : status,
    Priorité: priority === 'ALL' ? 'Toutes' : priority === 'YES' ? 'Prioritaires' : 'Non prioritaires',
  }), [q, status, priority]);

  const fetchAllForExport = async () => {
    const items: BordereauDto[] = [];
    let p = 1;
    const pageSize = 200;
    while (true) {
      const params: any = { page: p, size: pageSize };
      if (q?.trim()) params.q = q.trim();
      if (status !== 'ALL') params.status = status;
      if (priority !== 'ALL') params.priority = priority === 'YES';
      const r = await http.get<Page<BordereauDto>>('/bordereaux', { params });
      items.push(...r.data.items);
      if (p >= r.data.pages) break;
      p += 1;
      if (items.length >= 10000) break;
    }
    return items;
  };

  const [prioritizeOpen, setPrioritizeOpen] = useState(false);
  const [prioId, setPrioId] = useState<number | null>(null);
  const [prioOn, setPrioOn] = useState(false);
  const [prioRank, setPrioRank] = useState<number | ''>('');

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page, size };
      if (q.trim()) params.q = q.trim();
      if (status !== 'ALL') params.status = status;
      if (priority !== 'ALL') params.priority = priority === 'YES';
      const r = await http.get<Page<BordereauDto>>('/bordereaux', { params });
      setRows(r.data.items);
      setTotal(r.data.total);
      setPages(r.data.pages);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [page, size, q, status, priority]);

  const openPrioritize = (b: BordereauDto) => {
    setPrioId(b.id);
    setPrioOn(!!b.priority);
    setPrioRank((b.priorityRank ?? 1) as any);
    setPrioritizeOpen(true);
  };

  const submitPrioritize = async () => {
    if (!prioId) return;
    setLoading(true);
    setError(null);
    try {
      if (prioOn && (prioRank === '' || prioRank == null)) {
        throw new Error('Veuillez saisir un rang de priorité (>= 1)');
      }
      await http.post(`/bordereaux/${prioId}/prioritize`, {
        priority: prioOn,
        priorityRank: prioOn ? prioRank : null,
      });
      setPrioritizeOpen(false);
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const del = async (id: number, ref: string) => {
    if (!confirm(`Supprimer bordereau ${ref} (#${id}) ?`)) return;
    setLoading(true);
    setError(null);
    try {
      await http.delete(`/admin/bordereaux/${id}`);
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
            <div className="h1">Bordereaux</div>
            <div className="muted">Vue admin (liste + suppression).</div>
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
              placeholder="Réf, client, description, #id…"
            />
          </div>
          <div style={{ width: 220 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Statut</label>
            <select
              className="input"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="ALL">Tous</option>
              <option value="CREE">CREE</option>
              <option value="RECUPERE_BO">RECUPERE_BO</option>
              <option value="DEPOSE_SCAN">DEPOSE_SCAN</option>
              <option value="SCANNE">SCANNE</option>
              <option value="VERIFIE">VERIFIE</option>
              <option value="PRET_A_ENVOYER">PRET_A_ENVOYER</option>
              <option value="RECU_DU_RESPONSABLE">RECU_DU_RESPONSABLE</option>
              <option value="DONNE_AU_COURSIER">DONNE_AU_COURSIER</option>
              <option value="FINALISE">FINALISE</option>
              <option value="VALIDE">VALIDE</option>
            </select>
          </div>
          <div style={{ width: 200 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Priorité</label>
            <select
              className="input"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="ALL">Toutes</option>
              <option value="YES">Prioritaires</option>
              <option value="NO">Non prioritaires</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={reload} disabled={loading}>Appliquer</button>
            <button
              className="btn"
              onClick={() => {
                setQInput('');
                setStatus('ALL');
                setPriority('ALL');
                setPage(1);
              }}
              disabled={loading}
            >
              Réinitialiser
            </button>
          </div>

          <div className="ml-auto">
            <ExportButtons
              title="Bordereaux"
              filenameBase="bordereaux"
              columns={exportColumns}
              rows={rows}
              filters={exportFilters}
              totalCount={total}
              totalLabel="Tous les bordereaux"
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
                <th>Réf</th>
                <th>Client</th>
                <th>Statut</th>
                <th>Priorité</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div style={{ fontWeight: 900 }}>{b.reference}</div>
                    <div className="muted" style={{ fontSize: 12 }}>#{b.id}</div>
                  </td>
                  <td>{b.clientName ?? '—'}</td>
                  <td>
                    {!b.parentId && (b.childrenCount || 0) > 0 && b.childrenStatusCounts?.length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {sortStatusCounts(b.childrenStatusCounts as any).map((x) => (
                          <span key={x.status} className="badge">{x.status}{x.count > 1 ? ` (${x.count})` : ''}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="badge">{b.currentStatus}</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${b.priority ? 'warn' : ''}`}>
                      {b.priority ? `Oui${b.priorityRank != null ? ` (#${b.priorityRank})` : ''}` : 'Non'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <Link className="btn" to={`/bordereaux/${b.id}`}>Détails</Link>
                      <button className="btn warn" onClick={() => openPrioritize(b)} disabled={loading}>Priorité</button>
                      <button className="btn danger" onClick={() => del(b.id, b.reference)} disabled={loading}>Supprimer</button>
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

      {/* Priority modal */}
      <Modal
        open={prioritizeOpen}
        onClose={() => setPrioritizeOpen(false)}
        title="Priorité (Admin)"
        width={520}
        footer={
          <>
            <button className="btn" onClick={() => setPrioritizeOpen(false)}>Annuler</button>
            <button className="btn warn" onClick={submitPrioritize} disabled={loading}>Enregistrer</button>
          </>
        }
      >
        <div className="muted">Définir un rang de priorité pour trier la file.</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <label style={{ margin: 0 }}>Prioritaire</label>
          <input type="checkbox" checked={prioOn} onChange={(e) => setPrioOn(e.target.checked)} />
        </div>
        {prioOn ? (
          <>
            <label>Rang (obligatoire)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={prioRank}
              onChange={(e) => setPrioRank(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <div className="help">1 = plus urgent. (Ex: 1, 2, 3…)</div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
