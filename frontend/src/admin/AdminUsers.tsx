import React, { useEffect, useMemo, useState } from 'react';
import { http } from '../api/http';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import type { Page, RoleName, UserDto } from '../types';

const ALL_ROLES: RoleName[] = ['ADMIN','RESPONSABLE_CLIENT','RESPONSABLE_CLIENT_PROD','COURSIER','BUREAU_ORDRE','COORDINATEUR','VERIFICATEUR','SCANNER'];

type Draft = {
  id?: number;
  email: string;
  password?: string;
  enabled: boolean;
  roles: RoleName[];
};

export function AdminUsers() {
  const [rows, setRows] = useState<UserDto[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ email: '', password: '', enabled: true, roles: [] });

  // filters
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, 350);
  const [enabledFilter, setEnabledFilter] = useState<'ALL' | 'YES' | 'NO'>('ALL');
  const [roleFilter, setRoleFilter] = useState<'ALL' | RoleName>('ALL');

  const exportColumns = useMemo(() => ([
    { header: 'ID', value: (u: UserDto) => u.id, align: 'right' as const },
    { header: 'Email', value: (u: UserDto) => u.email },
    { header: 'Actif', value: (u: UserDto) => (u.enabled ? 'Oui' : 'Non') },
    { header: 'Rôles', value: (u: UserDto) => (u.roles || []).join(', ') },
  ]), []);

  const exportFilters = useMemo(() => ({
    Recherche: q?.trim() ? q.trim() : '—',
    Actif: enabledFilter === 'ALL' ? 'Tous' : enabledFilter === 'YES' ? 'Oui' : 'Non',
    Rôle: roleFilter === 'ALL' ? 'Tous' : roleFilter,
  }), [q, enabledFilter, roleFilter]);

  const fetchAllForExport = async () => {
    const items: UserDto[] = [];
    let p = 1;
    const pageSize = 200;
    while (true) {
      const params: any = { page: p, size: pageSize };
      if (q?.trim()) params.q = q.trim();
      if (enabledFilter !== 'ALL') params.enabled = enabledFilter === 'YES';
      if (roleFilter !== 'ALL') params.role = roleFilter;
      const r = await http.get<Page<UserDto>>('/admin/users', { params });
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
      if (enabledFilter !== 'ALL') params.enabled = enabledFilter === 'YES';
      if (roleFilter !== 'ALL') params.role = roleFilter;
      const r = await http.get<Page<UserDto>>('/admin/users', { params });
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
  }, [page, size, q, enabledFilter, roleFilter]);

  const openCreate = () => {
    // No default role: admin must choose (requested).
    setDraft({ email: '', password: '', enabled: true, roles: [] });
    setOpen(true);
  };

  const openEdit = (u: UserDto) => {
    setDraft({ id: u.id, email: u.email, enabled: u.enabled, roles: u.roles, password: '' });
    setOpen(true);
  };

  const toggleRole = (r: RoleName) => {
    setDraft((d) => {
      const has = d.roles.includes(r);
      const next = has ? d.roles.filter(x => x !== r) : [...d.roles, r];
      return { ...d, roles: next };
    });
  };

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!draft.email.trim()) throw new Error('Email requis');
      if (!draft.roles.length) throw new Error('Au moins un rôle');

      if (draft.id) {
        await http.put(`/admin/users/${draft.id}`, {
          email: draft.email,
          password: draft.password?.trim() ? draft.password : undefined,
          enabled: draft.enabled,
          roles: draft.roles,
        });
      } else {
        if (!draft.password || draft.password.length < 8) throw new Error('Mot de passe (min 8)');
        await http.post('/admin/users', {
          email: draft.email,
          password: draft.password,
          enabled: draft.enabled,
          roles: draft.roles,
        });
      }
      setOpen(false);
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const del = async (u: UserDto) => {
    if (!confirm(`Supprimer ${u.email} ?`)) return;
    setLoading(true);
    setError(null);
    try {
      await http.delete(`/admin/users/${u.id}`);
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
            <div className="h1">Utilisateurs</div>
            <div className="muted">Gestion des comptes et rôles.</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={reload} disabled={loading}>Recharger</button>
            <button className="btn primary" onClick={openCreate} disabled={loading}>+ Créer</button>
          </div>
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
              placeholder="Email, #id…"
            />
          </div>

          <div style={{ width: 200 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Actif</label>
            <select
              className="input"
              value={enabledFilter}
              onChange={(e) => {
                setEnabledFilter(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="ALL">Tous</option>
              <option value="YES">Oui</option>
              <option value="NO">Non</option>
            </select>
          </div>

          <div style={{ width: 240 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Rôle</label>
            <select
              className="input"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="ALL">Tous</option>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button className="btn" onClick={reload} disabled={loading}>Appliquer</button>
            <button
              className="btn"
              onClick={() => {
                setQInput('');
                setEnabledFilter('ALL');
                setRoleFilter('ALL');
                setPage(1);
              }}
              disabled={loading}
            >
              Réinitialiser
            </button>
          </div>


          <div className="ml-auto">
            <ExportButtons
              title="Utilisateurs"
              filenameBase="utilisateurs"
              columns={exportColumns}
              rows={rows}
              filters={exportFilters}
              totalCount={total}
              totalLabel="Tous les utilisateurs"
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
                <th>ID</th>
                <th>Email</th>
                <th>Actif</th>
                <th>Rôles</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td style={{ fontWeight: 800 }}>{u.email}</td>
                  <td>{u.enabled ? <span className="badge ok">Oui</span> : <span className="badge danger">Non</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {u.roles.map((r) => (
                        <span key={r} className="badge">{r}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn" onClick={() => openEdit(u)} disabled={loading}>Éditer</button>
                      <button className="btn danger" onClick={() => del(u)} disabled={loading}>Supprimer</button>
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
        title={draft.id ? 'Modifier utilisateur' : 'Créer utilisateur'}
        width={680}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Annuler</button>
            <button className="btn primary" onClick={save} disabled={loading}>Enregistrer</button>
          </>
        }
      >
        <div className="form">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="field sm:col-span-2">
              <label>Email</label>
              <input className="input" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="ex: user@domaine.tn" />
            </div>

            <div className="field sm:col-span-2">
              <label>Mot de passe {draft.id ? '(laisser vide pour ne pas changer)' : '(min 8)'} </label>
              <input
                className="input"
                type="password"
                value={draft.password ?? ''}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                placeholder={draft.id ? '••••••••' : 'Au moins 8 caractères'}
              />
            </div>

            <div className="field sm:col-span-2">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                <span>Actif</span>
              </label>
            </div>

            <div className="field sm:col-span-2">
              <label>Rôles</label>
              <div className="help">Choisissez au moins un rôle.</div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ALL_ROLES.map((r) => (
                  <label
                    key={r}
                    className={[
                      'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold',
                      draft.roles.includes(r) ? 'border-olea-800 bg-olea-50/60 text-olea-900' : 'border-slate-200/70 bg-white/60 text-slate-700',
                    ].join(' ')}
                  >
                    <input type="checkbox" checked={draft.roles.includes(r)} onChange={() => toggleRole(r)} />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
