import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { http } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { AttachmentPreviewModal } from '../components/AttachmentPreviewModal';
import { Pagination } from '../components/Pagination';
import { ExportButtons } from '../components/ExportButtons';
import { DepositInfoForm } from '../components/DepositInfoForm';
import { ResponsableClientProdForm } from '../components/ResponsableClientProdForm';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import { BordereauChatCard } from '../chat/BordereauChatCard';
import type { AssureurDto, BordereauDto, BordereauHistoryDto, BordereauStatus, DepositDocumentType, Page, ResponsableDto, RoleName } from '../types';

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

function nextActions(roles: RoleName[], status: BordereauStatus, isResponsableClientProdFlow: boolean): { to: BordereauStatus; label: string; needsAttachment?: boolean; needsDeposit?: boolean; }[] {
  const out: any[] = [];
  if (roles.includes('BUREAU_ORDRE')) {
    if (status === 'CREE') out.push({ to: 'RECUPERE_BO', label: 'Marquer récupéré' });
    if (status === 'A_RENVOYER_AU_CLIENT') out.push({ to: 'RENVOYE_AU_CLIENT', label: 'Renvoyer au client (coursier)' });
    if (status === 'RENVOYE_AU_CLIENT') out.push({ to: 'RECU_DU_CLIENT', label: 'Marquer reçu du client' });
    if (status === 'PRET_A_ENVOYER') out.push({ to: 'RECU_DU_RESPONSABLE', label: 'Réceptionner du responsable client' });
    if (status === 'RECU_DU_RESPONSABLE') out.push({ to: 'DONNE_AU_COURSIER', label: 'Donner au coursier' });
    if (status === 'DONNE_AU_COURSIER') out.push({ to: 'FINALISE', label: 'Finaliser (décharge)', needsAttachment: true });
  }
  if (roles.includes('COURSIER')) {
    if (status === 'A_RENVOYER_AU_CLIENT') out.push({ to: 'RENVOYE_AU_CLIENT', label: 'Renvoyer au client' });
  }
  if (roles.includes('COORDINATEUR')) {
    if (status === 'RECUPERE_BO') out.push({ to: 'DEPOSE_SCAN', label: 'Déposer au scan', needsDeposit: true });
  }
  if (roles.includes('SCANNER')) {
    if (status === 'DEPOSE_SCAN') out.push({ to: 'SCANNE', label: 'Marquer scanné' });
  }
  if (roles.includes('VERIFICATEUR')) {
    if (status === 'SCANNE') out.push({ to: 'VERIFIE', label: 'Marquer vérifié' });
  }
  if ((roles.includes('RESPONSABLE_CLIENT') || roles.includes('RESPONSABLE_CLIENT_PROD'))) {
    if (status === 'VERIFIE') out.push({ to: 'PRET_A_ENVOYER', label: 'Marquer prêt à envoyer' });
    if (isResponsableClientProdFlow && roles.includes('RESPONSABLE_CLIENT_PROD') && status === 'VERIFIE') out.push({ to: 'A_RENVOYER_AU_CLIENT', label: 'Demander modifications (retour client)' });
    if (isResponsableClientProdFlow && roles.includes('RESPONSABLE_CLIENT_PROD') && status === 'RECU_DU_CLIENT') out.push({ to: 'RECUPERE_BO', label: 'Confirmer modifications (reprendre)' });
    if (isResponsableClientProdFlow && roles.includes('RESPONSABLE_CLIENT_PROD') && status === 'RECU_DU_CLIENT') out.push({ to: 'A_RENVOYER_AU_CLIENT', label: 'Modifs insuffisantes (renvoyer au client)' });
    if (status === 'FINALISE') out.push({ to: 'VALIDE', label: 'Valider' });
  }
  return out;
}

type TransitionModalState = {
  to: BordereauStatus;
  needsAttachment?: boolean;
  needsDeposit?: boolean;
};

export function BordereauDetails() {
  const { id } = useParams();
  const auth = useAuth();
  const [b, setB] = useState<BordereauDto | null>(null);
  const [history, setHistory] = useState<BordereauHistoryDto[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historySize, setHistorySize] = useState(10);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPages, setHistoryPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // history filters
  const [historyQInput, setHistoryQInput] = useState('');
  const historyQ = useDebouncedValue(historyQInput, 350);
  const [historyToStatus, setHistoryToStatus] = useState<'ALL' | BordereauStatus>('ALL');


  const childExportColumns = useMemo(() => ([
    { header: 'ID', value: (c: BordereauDto) => c.id, align: 'right' as const },
    { header: 'Référence', value: (c: BordereauDto) => c.reference },
    { header: 'Type', value: (c: BordereauDto) => c.documentType ?? c.depositInfo?.typeDocument ?? '' },
    { header: 'Statut', value: (c: BordereauDto) => STATUS_LABEL[c.currentStatus] ?? c.currentStatus },
    { header: 'Lien', value: (c: BordereauDto) => `/bordereaux/${c.id}` },
  ]), []);

  const historyExportColumns = useMemo(() => ([
    { header: 'ID', value: (h: BordereauHistoryDto) => h.id, align: 'right' as const },
    { header: 'Date', value: (h: BordereauHistoryDto) => new Date(h.changedAt).toLocaleString('fr-FR') },
    { header: 'De', value: (h: BordereauHistoryDto) => (h.fromStatus ? STATUS_LABEL[h.fromStatus] : '—') },
    { header: 'Vers', value: (h: BordereauHistoryDto) => STATUS_LABEL[h.toStatus] ?? h.toStatus },
    { header: 'Rôle', value: (h: BordereauHistoryDto) => h.changedByRole },
    { header: 'Acteur', value: (h: BordereauHistoryDto) => h.changedByEmail },
    { header: 'Commentaire', value: (h: BordereauHistoryDto) => h.comment ?? '' },
    { header: 'Pièce', value: (h: BordereauHistoryDto) => h.attachmentUrl ?? '' },
  ]), []);

  const historyExportFilters = useMemo(() => ({
    Bordereau: b?.reference ?? `#${id ?? ''}` ,
    Recherche: historyQ?.trim() ? historyQ.trim() : '—',
    Statut_arrivee: historyToStatus === 'ALL' ? 'Tous' : STATUS_LABEL[historyToStatus],
    Total: historyTotal,
  }), [b?.reference, id, historyQ, historyToStatus, historyTotal]);

  const fetchAllHistoryForExport = async () => {
    if (!id) return [] as BordereauHistoryDto[];
    const items: BordereauHistoryDto[] = [];
    let p = 1;
    const pageSize = 200;
    while (true) {
      const params: any = { page: p, size: pageSize, sort: 'DESC' };
      if (historyQ?.trim()) params.q = historyQ.trim();
      if (historyToStatus !== 'ALL') params.toStatus = historyToStatus;
      const rh = await http.get<Page<BordereauHistoryDto>>(`/bordereaux/${id}/history`, { params });
      items.push(...(rh.data.items || []));
      if (p >= (rh.data.pages || 1)) break;
      p += 1;
      if (items.length >= 10000) break;
    }
    return items;
  };

  const [transition, setTransition] = useState<TransitionModalState | null>(null);
  const [comment, setComment] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [scannerNumber, setScannerNumber] = useState('');

  // deposit
  const [assureur, setAssureur] = useState('');
  const [depotRef, setDepotRef] = useState('');
  const [responsable, setResponsable] = useState('');
  const [assureurOptions, setAssureurOptions] = useState<AssureurDto[]>([]);
  const [responsableOptions, setResponsableOptions] = useState<ResponsableDto[]>([]);
  const [docTypes, setDocTypes] = useState<DepositDocumentType[]>([{ typeDocument: '', nombre: 1 }]);
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

  const [undoOpen, setUndoOpen] = useState(false);
  const [undoReason, setUndoReason] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; fileName?: string | null; mimeType?: string | null; title?: string } | null>(null);

  const roles = useMemo<RoleName[]>(() => auth.roles.map(r => r.replace('ROLE_','') as RoleName), [auth.roles]);

  const openAttachmentPreview = (url: string, options?: { fileName?: string | null; mimeType?: string | null; title?: string }) => {
    setAttachmentPreview({ url, ...options });
  };

  useEffect(() => {
    if (!auth.token) return;
    http
      .get<AssureurDto[]>('/assureurs')
      .then((r) => setAssureurOptions(r.data || []))
      .catch(() => setAssureurOptions([]));
  }, [auth.token]);

  const loadBordereau = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const rb = await http.get<BordereauDto>(`/bordereaux/${id}`);
      setB(rb.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const params: any = { page: historyPage, size: historySize, sort: 'DESC' };
      if (historyQ.trim()) params.q = historyQ.trim();
      if (historyToStatus !== 'ALL') params.toStatus = historyToStatus;
      const rh = await http.get<Page<BordereauHistoryDto>>(`/bordereaux/${id}/history`, { params });
      setHistory(rh.data.items);
      setHistoryTotal(rh.data.total);
      setHistoryPages(rh.data.pages);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const reloadAll = async () => {
    await Promise.all([loadBordereau(), loadHistory()]);
  };

  useEffect(() => {
    // when id changes, refresh everything
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    // history changes only
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyPage, historySize, historyQ, historyToStatus]);

  const workflowFlow = useMemo(() => getFlow(b?.isResponsableClientProdFlow), [b?.isResponsableClientProdFlow]);

  const actions = useMemo(() => {
    if (!b) return [];
    const isGroup = !b.parentId && (b.childrenCount || 0) > 0;
    if (isGroup) return [];
    return nextActions(roles, b.currentStatus, !!b.isResponsableClientProdFlow);
  }, [b, roles]);

  const isGroup = useMemo(() => !!(b && !b.parentId && (b.childrenCount || 0) > 0), [b]);

  const groupStatusCounts = useMemo(() => {
    if (!b || !isGroup) return [] as { status: BordereauStatus; count: number }[];

    // Prefer backend aggregate, but fallback to computing from children if needed.
    if (b.childrenStatusCounts?.length) return sortStatusCounts(b.childrenStatusCounts, b.isResponsableClientProdFlow);

    const m = new Map<BordereauStatus, number>();
    for (const c of b.children || []) {
      const s = c.currentStatus;
      m.set(s, (m.get(s) || 0) + 1);
    }
    return sortStatusCounts(Array.from(m.entries()).map(([status, count]) => ({ status, count })), b.isResponsableClientProdFlow);
  }, [b, isGroup]);

  const openTransition = (a: TransitionModalState) => {
    setTransition(a);
    setComment('');
    setAttachment(null);
    setScannerNumber('');
    setMatricule(b?.depositInfo?.matricule ?? '');
    setNomPrenomPrestataire(b?.depositInfo?.nomPrenomPrestataire ?? '');
    setNatureDemande(b?.depositInfo?.natureDemande ?? '');
    setDocumentsEnvoyes(b?.depositInfo?.documentsEnvoyes ?? '');
    setDateAdhesionEffet(toInputDate(b?.depositInfo?.dateAdhesionEffet));
    setDateReceptionClient(toInputDate(b?.depositInfo?.dateReceptionClient));
    setDateEnvoiAssureurDecharge(toInputDate(b?.depositInfo?.dateEnvoiAssureurDecharge));
    setExecution(b?.depositInfo?.execution ?? '');
    setDateExecution(toInputDate(b?.depositInfo?.dateExecution));
    setRemarque(b?.depositInfo?.remarque ?? '');
    if (a.needsDeposit && b) {
      const info = b.depositInfo;
      setAssureur(info?.assureur ?? '');
      // For COORDINATEUR: auto-fill from the bordereau reference if not already set.
      setDepotRef(info?.depotReference ?? b.reference ?? '');
      // Do NOT prefill responsable by default (requested).
      setResponsable(info?.responsable ?? '');

      // Offer the list of responsables assigned to this client (for COORDINATEUR).
      if (roles.includes('COORDINATEUR') && b.clientId) {
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
    if (!transition || !b) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      const payload: any = { toStatus: transition.to, comment: comment.trim() || undefined };
      if (transition.needsDeposit) {
        payload.assureur = assureur;
        payload.depotReference = depotRef;
        payload.responsable = responsable;
        payload.documentTypes = docTypes;
      }

      if (roles.includes('SCANNER') && transition.to === 'SCANNE') {
        payload.scannerNumber = scannerNumber.trim();
      }

      if (b.isResponsableClientProdFlow && roles.includes('RESPONSABLE_CLIENT_PROD') && (transition.to === 'PRET_A_ENVOYER' || transition.to === 'VALIDE')) {
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
      await reloadAll();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const rollbackLast = async () => {
    if (!b) return;
    if (!confirm('Annuler la dernière action ? (fenêtre 60s)')) return;
    setLoading(true);
    setError(null);
    try {
      await http.post(`/bordereaux/${b.id}/rollback-last`);
      await reloadAll();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Rollback impossible');
    } finally {
      setLoading(false);
    }
  };

  const lastHistory = history.length ? history[0] : null;
  const canRequestUndo = !!(b && lastHistory && auth.email && lastHistory.changedByEmail === auth.email && lastHistory.fromStatus);

  const submitUndo = async () => {
    if (!b || !lastHistory) return;
    setLoading(true);
    setError(null);
    try {
      await http.post(`/bordereaux/${b.id}/undo-requests`, {
        targetHistoryId: lastHistory.id,
        reason: undoReason.trim() || null,
      });
      setUndoOpen(false);
      setUndoReason('');
      alert('Demande envoyée. Un admin doit approuver.');
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
            <div className="h1">Bordereau {b ? b.reference : ''}</div>
            <div className="muted">
              {b ? (
                <>#{b.id} • {b.clientName ?? '—'} • {isGroup ? (
                  <>Statuts sous-bordereaux:
                    <span style={{ marginLeft: 6, display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      {groupStatusCounts.length ? groupStatusCounts.map((x) => (
                        <span key={x.status} className="badge">
                          {STATUS_LABEL[x.status]}{x.count > 1 ? ` (${x.count})` : ''}
                        </span>
                      )) : <span className="badge">—</span>}
                    </span>
                  </>
                ) : (
                  <>Statut: <b>{STATUS_LABEL[b.currentStatus]}</b></>
                )}
                  {b.parentId ? <> • Parent: <Link to={`/bordereaux/${b.parentId}`} className="underline">{b.parentReference ?? String(b.parentId)}</Link></> : null}
                  {!b.parentId && (b.childrenCount || 0) > 0 ? <> • Groupe ({b.childrenCount} sous-bordereaux)</> : null}
                </>
              ) : '—'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="btn" to="/">Accueil</Link>
            <button className="btn" onClick={reloadAll} disabled={loading}>Recharger</button>
            <button className="btn warn" onClick={rollbackLast} disabled={loading || !b || (!b.parentId && (b.childrenCount || 0) > 0)}>Rollback</button>
            {canRequestUndo ? (
              <button className="btn" onClick={() => setUndoOpen(true)} disabled={loading}>Demander undo</button>
            ) : null}
          </div>
        </div>
        {error ? <div className="mt-3 badge danger">{error}</div> : null}
      </div>

      {/* pipeline */}
      <div className="card p-5">
        <div className="text-sm font-black text-slate-900 mb-2">Pipeline</div>
        {isGroup ? (
          <div className="flex flex-wrap gap-2">
            {groupStatusCounts.length ? groupStatusCounts.map((x) => (
              <span key={x.status} className="badge">
                {STATUS_LABEL[x.status]}{x.count > 1 ? ` (${x.count})` : ''}
              </span>
            )) : <span className="badge">—</span>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {workflowFlow.map((s) => {
              const active = b?.currentStatus === s;
              const done = b ? workflowFlow.indexOf(s) < workflowFlow.indexOf(b.currentStatus) : false;
              return (
                <span
                  key={s}
                  className={`badge ${active ? 'warn' : done ? 'ok' : ''}`}
                >
                  {STATUS_LABEL[s]}
                </span>
              );
            })}
          </div>
        )}

        {b && actions.length ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {actions.map((a) => (
              <button
                key={a.to}
                className="btn primary"
                onClick={() => openTransition(a)}
                disabled={loading}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 12 }} className="muted">Aucune action disponible pour vos rôles sur ce statut.</div>
        )}

        {(b?.bonRemiseUrl || b?.finalDechargeUrl) ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {b?.bonRemiseUrl ? (
              <button className="btn" onClick={() => openAttachmentPreview(b.bonRemiseUrl!, { title: 'Bon de remise' })}>Ouvrir bon de remise</button>
            ) : null}
            {b?.finalDechargeUrl ? (
              <button className="btn ok" onClick={() => openAttachmentPreview(b.finalDechargeUrl!, { title: 'Décharge finale' })}>Ouvrir décharge finale</button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* chat thread */}
      {id ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-slate-900">Threads par bordereau</div>
              <div className="muted">Le canal auto de ce bordereau s’ouvre dans une popup.</div>
            </div>
            <button className="btn primary" onClick={() => setChatOpen(true)}>Ouvrir le thread</button>
          </div>
        </div>
      ) : null}

      <Modal
        title={b ? `Thread • ${b.reference}` : 'Thread du bordereau'}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        width={1200}
      >
        {id ? <BordereauChatCard bordereauId={Number(id)} /> : null}
      </Modal>

      <AttachmentPreviewModal
        open={!!attachmentPreview}
        onClose={() => setAttachmentPreview(null)}
        url={attachmentPreview?.url ?? null}
        fileName={attachmentPreview?.fileName}
        mimeType={attachmentPreview?.mimeType}
        title={attachmentPreview?.title}
      />

      {/* Sous-bordereaux */}
      {b && (b.childrenCount || 0) > 0 ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-sm font-black text-slate-900">Sous-bordereaux</div>
            <ExportButtons
              title="Sous-bordereaux"
              filenameBase={`sous_bordereaux_${b.reference}`}
              columns={childExportColumns}
              rows={b.children || []}
              filters={{ Bordereau: b.reference, Total: b.childrenCount || (b.children?.length || 0) }}
              disabled={loading}
              orientation="landscape"
            />
          </div>
          {b.children && b.children.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Type</th>
                    <th>Statut</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {b.children.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div style={{ fontWeight: 900 }}>{c.reference}</div>
                        <div className="muted" style={{ fontSize: 12 }}>#{c.id}</div>
                      </td>
                      <td className="muted">{c.documentType ?? c.depositInfo?.typeDocument ?? '—'}</td>
                      <td>
                        <span className="badge">{STATUS_LABEL[c.currentStatus]}</span>
                      </td>
                      <td>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <Link className="btn" to={`/bordereaux/${c.id}`}>Ouvrir</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">Aucun sous-bordereau.</div>
          )}
          <div className="help" style={{ marginTop: 10 }}>
            Le bordereau mère affiche un résumé des statuts de ses sous-bordereaux.
          </div>
        </div>
      ) : null}
      {/* deposit info */}
      {b?.depositInfo ? (
        <div className="card p-5">
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Dépôt</div>
          <div className="muted">
            Assureur: <b>{b.depositInfo.assureur}</b> • Réf: <b>{b.depositInfo.depotReference}</b> • Responsable: <b>{b.depositInfo.responsable}</b>
          </div>
          {b.depositInfo.documentTypes?.length ? (
            <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              {b.depositInfo.documentTypes.map((d, idx) => (
                <div key={idx} className="badge">{d.typeDocument} • {d.nombre}</div>
              ))}
            </div>
          ) : null}

          {(b.depositInfo.matricule || b.depositInfo.nomPrenomPrestataire || b.depositInfo.natureDemande || b.depositInfo.execution || b.depositInfo.remarque) ? (
            <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
              <div className="muted">Matricule: <b>{b.depositInfo.matricule ?? '—'}</b></div>
              <div className="muted">Nom prénom prestataire: <b>{b.depositInfo.nomPrenomPrestataire ?? '—'}</b></div>
              <div className="muted">Nature de la demande: <b>{b.depositInfo.natureDemande ?? '—'}</b></div>
              <div className="muted">Documents envoyés: <b>{b.depositInfo.documentsEnvoyes ?? '—'}</b></div>
              <div className="muted">Date d'adhésion / d'effet: <b>{b.depositInfo.dateAdhesionEffet ? new Date(b.depositInfo.dateAdhesionEffet).toLocaleDateString('fr-FR') : '—'}</b></div>
              <div className="muted">Date de réception client: <b>{b.depositInfo.dateReceptionClient ? new Date(b.depositInfo.dateReceptionClient).toLocaleDateString('fr-FR') : '—'}</b></div>
              <div className="muted">Date d'envoi à l'assureur// Décharge: <b>{b.depositInfo.dateEnvoiAssureurDecharge ? new Date(b.depositInfo.dateEnvoiAssureurDecharge).toLocaleDateString('fr-FR') : '—'}</b></div>
              <div className="muted">Exécution: <b>{b.depositInfo.execution ?? '—'}</b></div>
              <div className="muted">Date d'exécution: <b>{b.depositInfo.dateExecution ? new Date(b.depositInfo.dateExecution).toLocaleDateString('fr-FR') : '—'}</b></div>
              <div className="muted">Remarque: <b>{b.depositInfo.remarque ?? '—'}</b></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* history */}
      <div className="card p-5">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Historique ({historyTotal})</div>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div style={{ minWidth: 260 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Recherche</label>
            <input
              className="input"
              value={historyQInput}
              onChange={(e) => {
                setHistoryQInput(e.target.value);
                setHistoryPage(1);
              }}
              placeholder="Email acteur, commentaire…"
            />
          </div>
          <div style={{ width: 240 }}>
            <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Statut (arrivée)</label>
            <select
              className="input"
              value={historyToStatus}
              onChange={(e) => {
                setHistoryToStatus(e.target.value as any);
                setHistoryPage(1);
              }}
            >
              <option value="ALL">Tous</option>
              {workflowFlow.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={loadHistory} disabled={loading}>Appliquer</button>
            <button
              className="btn"
              onClick={() => {
                setHistoryQInput('');
                setHistoryToStatus('ALL');
                setHistoryPage(1);
              }}
              disabled={loading}
            >
              Réinitialiser
            </button>
          </div>
        <div className="ml-auto">
          <ExportButtons
            title="Historique"
            filenameBase={`historique_${b?.reference ?? id ?? 'bordereau'}`}
            columns={historyExportColumns}
            rows={history}
            filters={historyExportFilters}
            totalCount={historyTotal}
            totalLabel="Tout l’historique"
            fetchAll={fetchAllHistoryForExport}
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
                <th>Transition</th>
                <th>Acteur</th>
                <th>Commentaire</th>
                <th>Pièce</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    <div style={{ fontWeight: 800 }}>{new Date(h.changedAt).toLocaleString()}</div>
                    <div className="muted" style={{ fontSize: 12 }}>#{h.id}</div>
                  </td>
                  <td>
                    <div>
                      {h.fromStatus ? STATUS_LABEL[h.fromStatus] : '—'} → <b>{STATUS_LABEL[h.toStatus]}</b>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{h.changedByRole}</div>
                  </td>
                  <td className="muted">{h.changedByEmail}</td>
                  <td className="muted">{h.comment ?? '—'}</td>
                  <td>
                    {h.attachmentUrl ? (
                      <button className="btn" onClick={() => openAttachmentPreview(h.attachmentUrl!, { title: `Pièce jointe #${h.id}` })}>Ouvrir</button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.length === 0 ? <div className="muted">Aucun historique.</div> : null}
        <Pagination
          page={historyPage}
          pages={historyPages}
          size={historySize}
          total={historyTotal}
          onPageChange={(p) => setHistoryPage(p)}
          onSizeChange={(s) => {
            setHistorySize(s);
            setHistoryPage(1);
          }}
        />
      </div>

      {/* Transition modal */}
      <Modal
        open={!!transition}
        onClose={() => setTransition(null)}
        title={transition ? `Transition → ${STATUS_LABEL[transition.to]}` : ''}
        width={720}
        footer={
          <>
            <button className="btn" onClick={() => setTransition(null)}>Annuler</button>
            <button className="btn primary" onClick={submitTransition} disabled={loading || (roles.includes('SCANNER') && transition?.to === 'SCANNE' && !scannerNumber.trim())}>Valider</button>
          </>
        }
      >
        {transition ? (
          <>
            {transition.needsDeposit ? (
              <DepositInfoForm
                role={'COORDINATEUR'}
                bordereauReference={b?.reference}
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
              />
            ) : null}

            {b?.isResponsableClientProdFlow && roles.includes('RESPONSABLE_CLIENT_PROD') && (transition.to === 'PRET_A_ENVOYER' || transition.to === 'VALIDE') ? (
              <ResponsableClientProdForm
                mode={transition.to === 'VALIDE' ? 'FOLLOW_UP' : 'INITIAL'}
                clientName={b?.clientName}
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

            {roles.includes('SCANNER') && transition.to === 'SCANNE' ? (
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
                    Référence finale: <b>{[b?.parentReference ?? b?.reference, scannerNumber.trim() || 'XXX', b?.documentType || 'TYPE_DOCUMENT'].join('_')}</b>
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

      {/* Undo modal */}
      <Modal
        open={undoOpen}
        onClose={() => setUndoOpen(false)}
        title="Demande d'undo"
        width={540}
        footer={
          <>
            <button className="btn" onClick={() => setUndoOpen(false)}>Annuler</button>
            <button className="btn primary" onClick={submitUndo} disabled={loading}>Envoyer</button>
          </>
        }
      >
        <div className="muted">Dernière action: {lastHistory ? `${lastHistory.fromStatus ? STATUS_LABEL[lastHistory.fromStatus] : '—'} → ${STATUS_LABEL[lastHistory.toStatus]}` : '—'}</div>
        <div className="form" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Raison (optionnel)</label>
            <textarea className="input" value={undoReason} onChange={(e) => setUndoReason(e.target.value)} placeholder="Expliquez brièvement…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
