import React, { useEffect, useMemo, useState } from 'react';
import { http } from '../api/http';
import type { AdminDocumentTypeConfigDto, RoleName } from '../types';

const ROLE_LABEL: Record<string, string> = {
  RESPONSABLE_CLIENT: 'Responsable client',
  RESPONSABLE_CLIENT_PROD: 'Responsable client prod',
};

const PAGE_SIZE = 8;

export function AdminDocumentTypes() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newType, setNewType] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [config, setConfig] = useState<AdminDocumentTypeConfigDto | null>(null);
  const [draftAssignments, setDraftAssignments] = useState<Partial<Record<RoleName, string[]>>>({});
  const [typePage, setTypePage] = useState(1);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredDocumentTypes = useMemo(() => {
    const rows = config?.documentTypes || [];
    if (!normalizedSearch) return rows;
    return rows.filter((x) => x.name.toLowerCase().includes(normalizedSearch));
  }, [config, normalizedSearch]);

  const allTypes = useMemo(() => (config?.documentTypes || []).map((x) => x.name), [config]);
  const totalPages = Math.max(1, Math.ceil(filteredDocumentTypes.length / PAGE_SIZE));
  const paginatedDocumentTypes = useMemo(() => {
    const start = (typePage - 1) * PAGE_SIZE;
    return filteredDocumentTypes.slice(start, start + PAGE_SIZE);
  }, [filteredDocumentTypes, typePage]);
  const visibleTypeNames = useMemo(() => paginatedDocumentTypes.map((x) => x.name), [paginatedDocumentTypes]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await http.get<AdminDocumentTypeConfigDto>('/admin/document-types');
      setConfig(r.data);
      setDraftAssignments(r.data.assignments || {});
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    setTypePage(1);
  }, [search]);
  useEffect(() => {
    setTypePage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const createType = async () => {
    if (!newType.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await http.post('/admin/document-types', { name: newType.trim() });
      setNewType('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
      setLoading(false);
    }
  };

  const startEdit = (id: number, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await http.put(`/admin/document-types/${editingId}`, { name: editingName.trim() });
      cancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
      setLoading(false);
    }
  };

  const removeType = async (id: number) => {
    if (!confirm('Supprimer ce type de document ?')) return;
    setLoading(true);
    setError(null);
    try {
      await http.delete(`/admin/document-types/${id}`);
      if (editingId === id) cancelEdit();
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
      setLoading(false);
    }
  };

  const toggle = (role: RoleName, typeName: string) => {
    setDraftAssignments((prev) => {
      const current = new Set(prev[role] || []);
      if (current.has(typeName)) current.delete(typeName);
      else current.add(typeName);
      return { ...prev, [role]: Array.from(current).sort((a, b) => a.localeCompare(b)) };
    });
  };

  const saveAssignments = async () => {
    setLoading(true);
    setError(null);
    try {
      await http.put('/admin/document-types/assignments', { assignments: draftAssignments });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="h1">Types de documents</div>
            <div className="muted">L’admin gère la liste globale, peut rechercher, modifier, supprimer et donne les accès par rôle. Tous les utilisateurs ayant ce rôle héritent automatiquement des types cochés.</div>
          </div>
          <button className="btn" onClick={load} disabled={loading}>Recharger</button>
        </div>
        {error ? <div className="mt-3 badge danger">{error}</div> : null}
      </div>

      <div className="card p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div className="space-y-3">
            <div className="field">
              <label>Nouveau type</label>
              <div className="flex gap-2">
                <input className="input" value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Ex: CARTE VERTE" />
                <button className="btn primary" onClick={createType} disabled={loading}>Ajouter</button>
              </div>
            </div>

            <div className="field">
              <label>Rechercher un type</label>
              <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tape un nom de type" />
            </div>

            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>{filteredDocumentTypes.length} résultat{filteredDocumentTypes.length > 1 ? 's' : ''}{normalizedSearch ? ` sur ${allTypes.length}` : ''}</span>
              {filteredDocumentTypes.length > PAGE_SIZE ? <span>Page {typePage} / {totalPages}</span> : null}
            </div>

            <div className="space-y-2">
              {paginatedDocumentTypes.map((t) => {
                const isEditing = editingId === t.id;
                return (
                  <div key={t.id} className="rounded-2xl border border-slate-200/70 px-4 py-3">
                    {isEditing ? (
                      <div className="space-y-3">
                        <input className="input" value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                        <div className="flex flex-wrap justify-end gap-2">
                          <button className="btn" onClick={cancelEdit} disabled={loading}>Annuler</button>
                          <button className="btn primary" onClick={saveEdit} disabled={loading || !editingName.trim()}>Enregistrer</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold break-all">{t.name}</span>
                        <div className="flex flex-wrap gap-2">
                          <button className="btn" onClick={() => startEdit(t.id, t.name)} disabled={loading}>Modifier</button>
                          <button className="btn danger" onClick={() => removeType(t.id)} disabled={loading}>Supprimer</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!filteredDocumentTypes.length ? <div className="muted">{normalizedSearch ? 'Aucun type ne correspond à la recherche.' : 'Aucun type configuré.'}</div> : null}
            </div>

            {filteredDocumentTypes.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 pt-2">
                <button className="btn" onClick={() => setTypePage((p) => Math.max(1, p - 1))} disabled={loading || typePage <= 1}>Précédent</button>
                <button className="btn" onClick={() => setTypePage((p) => Math.min(totalPages, p + 1))} disabled={loading || typePage >= totalPages}>Suivant</button>
              </div>
            ) : null}
          </div>

          <div className="space-y-5">
            {(config?.managedRoles || []).map((role) => {
              const selected = new Set(draftAssignments[role] || []);
              return (
                <div key={role} className="rounded-3xl border border-slate-200/70 p-4">
                  <div className="mb-2 text-lg font-black tracking-tight">{ROLE_LABEL[role] || role}</div>
                  <div className="mb-3 text-sm text-slate-600">Tous les utilisateurs ayant ce rôle auront accès aux types cochés.</div>
                  <div className="mb-3 text-sm text-slate-500">{Array.from(selected).length} type{Array.from(selected).length > 1 ? 's' : ''} sélectionné{Array.from(selected).length > 1 ? 's' : ''}</div>
                  <div className="flex flex-wrap gap-2">
                    {visibleTypeNames.map((typeName) => {
                      const checked = selected.has(typeName);
                      return (
                        <label key={`${role}-${typeName}`} className={[
                          'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm',
                          checked ? 'border-olea-700 bg-olea-50 text-olea-900' : 'border-slate-200 bg-white text-slate-700'
                        ].join(' ')}>
                          <input type="checkbox" checked={checked} onChange={() => toggle(role, typeName)} />
                          <span>{typeName}</span>
                        </label>
                      );
                    })}
                    {!allTypes.length ? <div className="muted">Ajoute d’abord des types de documents.</div> : null}
                    {!!allTypes.length && !visibleTypeNames.length ? <div className="muted">Aucun type ne correspond à la recherche.</div> : null}
                  </div>
                </div>
              );
            })}

            <div className="flex justify-end">
              <button className="btn primary" onClick={saveAssignments} disabled={loading}>Enregistrer les affectations</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
