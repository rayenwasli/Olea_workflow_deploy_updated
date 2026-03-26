import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { AttachmentPreviewModal } from '../components/AttachmentPreviewModal';
import { DepositInfoForm } from '../components/DepositInfoForm';
import { ResponsableClientProdForm } from '../components/ResponsableClientProdForm';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import type {
  AssureurDto,
  BordereauDto,
  BordereauStatus,
  ClientDto,
  DepositDocumentType,
  RoleName,
  ResponsableDto,
  Page,

} from '../types';

const STATUS_LABEL: Record<BordereauStatus, string> = {
  CREE: 'Créé',
  RECUPERE_BO: 'Récupéré (BO)',
  DEPOSE_SCAN: 'Déposé au scan',
  SCANNE: 'Scanné',
  VERIFIE: 'Vérifié',
  A_RENVOYER_AU_CLIENT: 'À renvoyer au client',
  RENVOYE_AU_CLIENT: 'Renvoyé au client',
  RECU_DU_CLIENT: 'Reçu du client (à confirmer)',
  PRET_A_ENVOYER: 'Prêt à envoyer',
  RECU_DU_RESPONSABLE: 'Reçu du responsable client',
  DONNE_AU_COURSIER: 'Donné au coursier',
  FINALISE: 'Finalisé',
  VALIDE: 'Validé',
};

const BASE_FLOW: BordereauStatus[] = ['CREE','RECUPERE_BO','DEPOSE_SCAN','SCANNE','VERIFIE','PRET_A_ENVOYER','RECU_DU_RESPONSABLE','DONNE_AU_COURSIER','FINALISE','VALIDE'];
const RC_PROD_FLOW: BordereauStatus[] = ['CREE','RECUPERE_BO','DEPOSE_SCAN','SCANNE','VERIFIE','A_RENVOYER_AU_CLIENT','RENVOYE_AU_CLIENT','RECU_DU_CLIENT','PRET_A_ENVOYER','RECU_DU_RESPONSABLE','DONNE_AU_COURSIER','FINALISE','VALIDE'];

function getFlow(isResponsableClientProdFlow?: boolean | null) {
  return isResponsableClientProdFlow ? RC_PROD_FLOW : BASE_FLOW;
}

function sortStatusCounts(items: { status: BordereauStatus; count: number }[], isResponsableClientProdFlow?: boolean | null) {
  const idx = new Map(getFlow(isResponsableClientProdFlow).map((s, i) => [s, i]));
  return [...items].sort((a, b) => (idx.get(a.status) ?? 999) - (idx.get(b.status) ?? 999));
}

function toInputDate(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

type NextAction = { to: BordereauStatus; needsAttachment?: boolean; needsDeposit?: boolean; label: string };

function nextForRole(role: RoleName, status: BordereauStatus, isResponsableClientProdFlow: boolean): NextAction[] {
  const out: NextAction[] = [];
  if (role === 'BUREAU_ORDRE') {
    if (status === 'CREE') out.push({ to: 'RECUPERE_BO', label: 'Marquer récupéré' });
    if (status === 'A_RENVOYER_AU_CLIENT') out.push({ to: 'RENVOYE_AU_CLIENT', label: 'Renvoyer au client (coursier)' });
    if (status === 'RENVOYE_AU_CLIENT') out.push({ to: 'RECU_DU_CLIENT', label: 'Marquer reçu du client' });
    if (status === 'PRET_A_ENVOYER') out.push({ to: 'RECU_DU_RESPONSABLE', label: 'Réceptionner du responsable client' });
    if (status === 'RECU_DU_RESPONSABLE') out.push({ to: 'DONNE_AU_COURSIER', label: 'Donner au coursier' });
    if (status === 'DONNE_AU_COURSIER') out.push({ to: 'FINALISE', label: 'Finaliser (décharge)', needsAttachment: true });
  }
  if (role === 'COURSIER') {
    if (status === 'A_RENVOYER_AU_CLIENT') out.push({ to: 'RENVOYE_AU_CLIENT', label: 'Renvoyer au client' });
  }
  if (role === 'COORDINATEUR') {
    if (status === 'RECUPERE_BO') out.push({ to: 'DEPOSE_SCAN', label: 'Déposer au scan', needsDeposit: true });
  }
  if (role === 'SCANNER') {
    if (status === 'DEPOSE_SCAN') out.push({ to: 'SCANNE', label: 'Marquer scanné' });
  }
  if (role === 'VERIFICATEUR') {
    if (status === 'SCANNE') out.push({ to: 'VERIFIE', label: 'Marquer vérifié' });
  }
  if (role === 'RESPONSABLE_CLIENT' || role === 'RESPONSABLE_CLIENT_PROD') {
    if (status === 'VERIFIE') out.push({ to: 'PRET_A_ENVOYER', label: 'Marquer prêt à envoyer' });
    if (isResponsableClientProdFlow && role === 'RESPONSABLE_CLIENT_PROD' && status === 'VERIFIE') out.push({ to: 'A_RENVOYER_AU_CLIENT', label: 'Demander modifications (retour client)' });
    if (isResponsableClientProdFlow && role === 'RESPONSABLE_CLIENT_PROD' && status === 'RECU_DU_CLIENT') out.push({ to: 'RECUPERE_BO', label: 'Confirmer modifications (reprendre)' });
    if (isResponsableClientProdFlow && role === 'RESPONSABLE_CLIENT_PROD' && status === 'RECU_DU_CLIENT') out.push({ to: 'A_RENVOYER_AU_CLIENT', label: 'Modifs insuffisantes (renvoyer au client)' });
    if (status === 'FINALISE') out.push({ to: 'VALIDE', label: 'Valider' });
  }
  return out;
}

type TransitionDraft = {
  bordereau: BordereauDto;
  to: BordereauStatus;
  needsAttachment?: boolean;
  needsDeposit?: boolean;
};

export function QueuePage({ role, title }: { role: RoleName; title: string }) {
  const auth = useAuth();
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
  const [status, setStatus] = useState<'ALL' | BordereauStatus>('ALL');
  const [priority, setPriority] = useState<'ALL' | 'YES' | 'NO'>('ALL');

  const exportColumns = useMemo(() => ([
    { header: 'ID', value: (b: BordereauDto) => b.id, align: 'right' as const },
    { header: 'Référence', value: (b: BordereauDto) => b.reference },
    { header: 'Client', value: (b: BordereauDto) => b.clientName ?? '' },
    { header: 'Type', value: (b: BordereauDto) => b.documentType ?? '' },
    { header: 'Statut', value: (b: BordereauDto) => (b.childrenStatusCounts?.length ? b.childrenStatusCounts.map(s => `${s.status}:${s.count}`).join(' | ') : STATUS_LABEL[b.currentStatus] ?? b.currentStatus) },
    { header: 'Priorité', value: (b: BordereauDto) => (b.priority ? `Oui (${b.priorityRank ?? 1})` : 'Non') },
    { header: 'Dépot', value: (b: BordereauDto) => b.depositInfo?.depotReference ?? '' },
  ]), []);

  const exportFilters = useMemo(() => ({
    Recherche: q?.trim() ? q.trim() : '—',
    Statut: status === 'ALL' ? 'Tous' : (STATUS_LABEL[status] ?? status),
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

  const [clients, setClients] = useState<ClientDto[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createClientId, setCreateClientId] = useState<number | ''>('');
  const [createClientName, setCreateClientName] = useState('');
  const [createDesc, setCreateDesc] = useState('');

  const [transition, setTransition] = useState<TransitionDraft | null>(null);
  const [comment, setComment] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  // deposit fields
  const [assureur, setAssureur] = useState('');
  const [depotRef, setDepotRef] = useState('');
  const [responsable, setResponsable] = useState('');
  const [assureurOptions, setAssureurOptions] = useState<AssureurDto[]>([]);
  const [responsableOptions, setResponsableOptions] = useState<ResponsableDto[]>([]);
  const [documentTypeOptions, setDocumentTypeOptions] = useState<string[]>([]);
  const [docTypes, setDocTypes] = useState<DepositDocumentType[]>([{ typeDocument: '', nombre: 1 }]);
  const [scannerNumber, setScannerNumber] = useState('');
  const [matricule, setMatricule] = useState('');
  const [nomPrenomPrestataire, setNomPrenomPrestataire] = useState('');
  const [natureDemande, setNatureDemande] = useState('');
  const [documentsEnvoyes, setDocumentsEnvoyes] = useState('');
  const [dateAdhesionEffet, setDateAdhesionEffet] = useState('');
  const [dateReceptionClient, setDateReceptionClient] = useState('');
  const [dateEnvoiAssureurDecharge, setDateEnvoiAssureurDecharge] = useState('');
  const [execution, setExecution] = useState('');
  const [dateExecution, setDateExecution] = useState('');
  const [remarque, setRemarque] = useState('');

  const [prioritizeOpen, setPrioritizeOpen] = useState(false);
  const [prioId, setPrioId] = useState<number | null>(null);
  const [prioOn, setPrioOn] = useState(true);
  const [prioRank, setPrioRank] = useState<number | ''>('');
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; fileName?: string | null; mimeType?: string | null; title?: string } | null>(null);

  const canCreate = role === 'BUREAU_ORDRE';

  const openAttachmentPreview = (url: string, options?: { fileName?: string | null; mimeType?: string | null; title?: string }) => {
    setAttachmentPreview({ url, ...options });
  };

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
      setError(e?.response?.data?.message ?? 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!auth.token) return;
    reload();
  }, [auth.token, page, size, q, status, priority]);

  useEffect(() => {
    if (!auth.token) return;
    http
      .get<ClientDto[]>('/clients')
      .then((r) => setClients(r.data))
      .catch(() => setClients([]));
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token) return;
    http
      .get<AssureurDto[]>('/assureurs')
      .then((r) => setAssureurOptions(r.data || []))
      .catch(() => setAssureurOptions([]));
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token) return;
    http
      .get<string[]>('/document-types/options')
      .then((r) => setDocumentTypeOptions(r.data || []))
      .catch(() => setDocumentTypeOptions([]));
  }, [auth.token]);

  const actionsById = useMemo(() => {
    const m = new Map<number, NextAction[]>();
    for (const b of rows) {
      const isGroup = !b.parentId && (b.childrenCount || 0) > 0;
      m.set(b.id, isGroup ? [] : nextForRole(role, b.currentStatus, !!b.isResponsableClientProdFlow));
    }
    return m;
  }, [rows, role]);

  const openTransition = (b: BordereauDto, act: NextAction) => {
    if (!act) return;

    setTransition({ bordereau: b, to: act.to, needsAttachment: act.needsAttachment, needsDeposit: act.needsDeposit });
    setComment('');
    setAttachment(null);
    setScannerNumber('');
    setMatricule(b.depositInfo?.matricule ?? '');
    setNomPrenomPrestataire(b.depositInfo?.nomPrenomPrestataire ?? '');
    setNatureDemande(b.depositInfo?.natureDemande ?? '');
    setDocumentsEnvoyes(b.depositInfo?.documentsEnvoyes ?? '');
    setDateAdhesionEffet(toInputDate(b.depositInfo?.dateAdhesionEffet));
    setDateReceptionClient(toInputDate(b.depositInfo?.dateReceptionClient));
    setDateEnvoiAssureurDecharge(toInputDate(b.depositInfo?.dateEnvoiAssureurDecharge));
    setExecution(b.depositInfo?.execution ?? '');
    setDateExecution(toInputDate(b.depositInfo?.dateExecution));
    setRemarque(b.depositInfo?.remarque ?? '');

    // init deposit info from existing if any
    if (act.needsDeposit) {
      const info = b.depositInfo;
      setAssureur(info?.assureur ?? '');
      // For COORDINATEUR: auto-fill from the bordereau reference if not already set by BO.
      setDepotRef(info?.depotReference ?? b.reference ?? '');
      // Do NOT prefill responsable by default (requested).
      setResponsable(info?.responsable ?? '');

      // If this bordereau has a client, offer the list of assigned responsables.
      // Only used for COORDINATEUR (deposit form).
      if (role === 'COORDINATEUR' && b.clientId) {
        http
          .get<ResponsableDto[]>(`/clients/${b.clientId}/responsables`)
          .then((r) => setResponsableOptions(r.data || []))
          .catch(() => setResponsableOptions([]));
      } else {
        setResponsableOptions([]);
      }

      const docs = (info?.documentTypes && info.documentTypes.length)
        ? info.documentTypes
        : (info?.typeDocument && info.typeDocument !== 'MULTI')
          ? [{ typeDocument: info.typeDocument, nombre: info?.nombre ?? 1 }]
          : [{ typeDocument: '', nombre: 1 }];
      setDocTypes(docs as DepositDocumentType[]);
    }
  };

  const submitTransition = async () => {
    if (!transition) return;
    setLoading(true);
    setError(null);

    try {
      const b = transition.bordereau;
      const form = new FormData();
      const payload: any = {
        toStatus: transition.to,
        comment: comment.trim() || undefined,
      };

      if (transition.needsDeposit) {
        payload.assureur = assureur;
        payload.depotReference = depotRef;
        payload.responsable = responsable;
        payload.documentTypes = docTypes;
      }

      if (b.isResponsableClientProdFlow && role === 'RESPONSABLE_CLIENT_PROD' && (transition.to === 'PRET_A_ENVOYER' || transition.to === 'VALIDE')) {
        payload.matricule = matricule.trim();
        payload.nomPrenomPrestataire = nomPrenomPrestataire.trim();
        payload.natureDemande = natureDemande;
        payload.documentsEnvoyes = documentsEnvoyes.trim();
        payload.dateAdhesionEffet = dateAdhesionEffet || undefined;
        payload.dateReceptionClient = dateReceptionClient || undefined;
        payload.dateEnvoiAssureurDecharge = dateEnvoiAssureurDecharge || undefined;
        payload.execution = execution || undefined;
        payload.dateExecution = dateExecution || undefined;
        payload.remarque = remarque.trim() || undefined;
      }

      if (role === 'SCANNER' && transition.to === 'SCANNE') {
        payload.scannerNumber = scannerNumber.trim();
      }

      // IMPORTANT: send as a plain string field.
      // If we send a Blob, Multer may treat it as an extra *file* field ("Unexpected field")
      // because the backend only accepts one file field named "attachment".
      form.append('data', JSON.stringify(payload));
      if (transition.needsAttachment) {
        if (!attachment) throw new Error('Veuillez joindre un fichier');
        form.append('attachment', attachment, attachment.name);
      }

      // Let the browser/axios set the correct multipart boundary automatically.
      await http.post(`/bordereaux/${b.id}/transition`, form);

      setTransition(null);
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const submitCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      await http.post('/bordereaux', {
        clientId: createClientId === '' ? null : createClientId,
        clientName: createClientId === '' ? createClientName : null,
        description: createDesc,
      });
      setCreateClientId('');
      setCreateClientName('');
      setCreateDesc('');
      setCreateOpen(false);
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur création');
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="h1">{title}</div>
            <div className="muted">File d’attente ({total} bordereaux)</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={reload} disabled={loading}>Recharger</button>
            {canCreate ? (
              <button className="btn primary" onClick={() => setCreateOpen(true)} disabled={loading}>+ Nouveau bordereau</button>
            ) : null}
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
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
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
              filenameBase="bordereaux_queue"
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
                <th>Référence</th>
                <th>Client</th>
                <th>Statut</th>
                <th>Priorité</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const acts = actionsById.get(b.id) || [];
                return (
                  <tr key={b.id}>
                    <td>
                      <div style={{ fontWeight: 900 }}>{b.reference}</div>
                      <div className="muted" style={{ fontSize: 12 }}>#{b.id}</div>
                      {!b.parentId && (b.childrenCount || 0) > 0 ? (
                        <div className="muted" style={{ fontSize: 12 }}>Groupe • Sous-bordereaux: {b.childrenCount}</div>
                      ) : null}
                      {b.parentId ? (
                        <div className="muted" style={{ fontSize: 12 }}>Parent: {b.parentReference ?? '—'}{b.documentType ? ` • Type: ${b.documentType}` : ''}</div>
                      ) : null}
                    </td>
                    <td>
                      <div>{b.clientName ?? '—'}</div>
                      {b.depositInfo?.depotReference ? (
                        <div className="muted" style={{ fontSize: 12 }}>Depot: {b.depositInfo.depotReference}</div>
                      ) : null}
                    </td>
                    <td>
                      {!b.parentId && (b.childrenCount || 0) > 0 && b.childrenStatusCounts?.length ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {sortStatusCounts(b.childrenStatusCounts, b.isResponsableClientProdFlow).map((x) => (
                            <span key={x.status} className="badge">
                              {STATUS_LABEL[x.status]}{x.count > 1 ? ` (${x.count})` : ''}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="badge">{STATUS_LABEL[b.currentStatus]}</span>
                      )}
                      {b.bonRemiseUrl ? (
                        <div style={{ marginTop: 6 }}>
                          <button className="badge" onClick={() => openAttachmentPreview(b.bonRemiseUrl!, { title: 'Bon de remise' })}>Bon de remise</button>
                        </div>
                      ) : null}
                      {b.finalDechargeUrl ? (
                        <div style={{ marginTop: 6 }}>
                          <button className="badge ok" onClick={() => openAttachmentPreview(b.finalDechargeUrl!, { title: 'Décharge finale' })}>Décharge</button>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`badge ${b.priority ? 'warn' : ''}`}>{b.priority ? `Oui${b.priorityRank != null ? ` (#${b.priorityRank})` : ''}` : 'Non'}</span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link className="btn" to={`/bordereaux/${b.id}`}>Détails</Link>
                        {auth.hasRole('ADMIN') ? (
                          <button className="btn warn" onClick={() => openPrioritize(b)} disabled={loading}>Priorité</button>
                        ) : null}
                        {acts.length ? (
                          acts.map((a) => (
                            <button key={`${b.id}:${a.to}`} className="btn primary" onClick={() => openTransition(b, a)} disabled={loading}>
                              {a.label}
                            </button>
                          ))
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && !loading ? <div className="muted">Aucun bordereau.</div> : null}
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

      <AttachmentPreviewModal
        open={!!attachmentPreview}
        onClose={() => setAttachmentPreview(null)}
        url={attachmentPreview?.url ?? null}
        fileName={attachmentPreview?.fileName}
        mimeType={attachmentPreview?.mimeType}
        title={attachmentPreview?.title}
      />

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Créer un bordereau"
        width={640}
        footer={
          <>
            <button className="btn" onClick={() => setCreateOpen(false)}>Annuler</button>
            <button
              className="btn primary"
              onClick={submitCreate}
              disabled={loading || (createClientId === '' && !createClientName.trim())}
            >
              Créer
            </button>
          </>
        }
      >
        <div className="form">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="field sm:col-span-2">
              <label>Client</label>
              <select className="input" value={createClientId} onChange={(e) => setCreateClientId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">(autre / saisie libre)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="help">La référence est générée automatiquement: <b>AAAA_CLIENT</b>.</div>
            </div>

            {createClientId === '' ? (
              <div className="field sm:col-span-2">
                <label>Nom client (si non listé)</label>
                <input className="input" value={createClientName} onChange={(e) => setCreateClientName(e.target.value)} placeholder="Saisir le nom du client" />
              </div>
            ) : null}

            <div className="field sm:col-span-2">
              <label>Description (optionnel)</label>
              <textarea className="input" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="Notes, détails…" />
            </div>
          </div>
        </div>
      </Modal>

      {/* Transition modal */}
      <Modal
        open={!!transition}
        onClose={() => setTransition(null)}
        title={transition ? `Transition → ${STATUS_LABEL[transition.to]}` : ''}
        width={720}
        footer={
          <>
            <button className="btn" onClick={() => setTransition(null)}>Annuler</button>
            <button className="btn primary" onClick={submitTransition} disabled={loading || (role === 'SCANNER' && transition?.to === 'SCANNE' && !scannerNumber.trim())}>
              Valider
            </button>
          </>
        }
      >
        {transition ? (
          <>
            <div className="muted" style={{ marginBottom: 10 }}>
              Bordereau <b>{transition.bordereau.reference}</b> • {STATUS_LABEL[transition.bordereau.currentStatus]} → {STATUS_LABEL[transition.to]}
            </div>

            {transition.needsDeposit ? (
              <DepositInfoForm
                role={role}
                bordereauReference={transition.bordereau.reference}
                assureur={assureur}
                setAssureur={setAssureur}
                assureurOptions={assureurOptions}
                depotRef={depotRef}
                setDepotRef={setDepotRef}
                responsable={responsable}
                setResponsable={setResponsable}
                responsableOptions={responsableOptions}
                docTypes={docTypes}
                setDocTypes={setDocTypes}
                documentTypeOptions={documentTypeOptions}
              />
            ) : null}

            {transition.bordereau.isResponsableClientProdFlow && role === 'RESPONSABLE_CLIENT_PROD' && (transition.to === 'PRET_A_ENVOYER' || transition.to === 'VALIDE') ? (
              <ResponsableClientProdForm
                mode={transition.to === 'VALIDE' ? 'FOLLOW_UP' : 'INITIAL'}
                clientName={transition.bordereau.clientName}
                matricule={matricule}
                setMatricule={setMatricule}
                nomPrenomPrestataire={nomPrenomPrestataire}
                setNomPrenomPrestataire={setNomPrenomPrestataire}
                natureDemande={natureDemande}
                setNatureDemande={setNatureDemande}
                documentsEnvoyes={documentsEnvoyes}
                setDocumentsEnvoyes={setDocumentsEnvoyes}
                dateAdhesionEffet={dateAdhesionEffet}
                setDateAdhesionEffet={setDateAdhesionEffet}
                dateReceptionClient={dateReceptionClient}
                setDateReceptionClient={setDateReceptionClient}
                dateEnvoiAssureurDecharge={dateEnvoiAssureurDecharge}
                setDateEnvoiAssureurDecharge={setDateEnvoiAssureurDecharge}
                execution={execution}
                setExecution={setExecution}
                dateExecution={dateExecution}
                setDateExecution={setDateExecution}
                remarque={remarque}
                setRemarque={setRemarque}
              />
            ) : null}

            {role === 'SCANNER' && transition.to === 'SCANNE' ? (
              <div className="form" style={{ marginTop: 12 }}>
                <div className="field">
                  <label>Numéro scanner</label>
                  <input
                    className="input"
                    value={scannerNumber}
                    onChange={(e) => setScannerNumber(e.target.value)}
                    placeholder="Ex: 20"
                  />
                  <div className="help">
                    Référence finale: <b>{[transition.bordereau.parentReference ?? transition.bordereau.reference, scannerNumber.trim() || 'XXX', transition.bordereau.documentType || 'TYPE_DOCUMENT'].join('_')}</b>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="form" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Commentaire (optionnel)</label>
                <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ajouter un commentaire…" />
              </div>
            </div>

            {transition.needsAttachment ? (
              <div className="form" style={{ marginTop: 12 }}>
                <div className="field">
                  <label>Décharge (fichier obligatoire)</label>
                  <input
                    className="input"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                  />
                  <div className="help">Formats acceptés: images ou PDF.</div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      {/* Priority modal */}
      <Modal
        open={prioritizeOpen}
        onClose={() => setPrioritizeOpen(false)}
        title="Priorité"
        width={520}
        footer={
          <>
            <button className="btn" onClick={() => setPrioritizeOpen(false)}>Annuler</button>
            <button className="btn warn" onClick={submitPrioritize} disabled={loading}>Enregistrer</button>
          </>
        }
      >
        <div className="muted">Seul l’admin peut prioriser. Les bordereaux sont triés par rang.</div>
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
