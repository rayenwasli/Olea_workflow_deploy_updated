const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Op, QueryTypes } = require('sequelize');
const {
  Bordereau, BordereauStatusHistory, BordereauDepositInfo, BordereauDepositDocumentType,
  Client, User, UndoRequest, RoleAllowedDocumentType, sequelize,
} = require('../models');
const { RoleName, BordereauStatus, UndoRequestStatus } = require('../utils/constants');
const { isBlank, hasResponsableClientLikeRole, refToken, queueOrder, WORKFLOW } = require('../utils/helpers');
const { parsePaging, shouldPaginate, pageResponse } = require('../utils/pagination');
const { emitBordereauStatusChanged } = require('../socket');
const { generateBonRemisePdf } = require('../utils/bonRemisePdf');

const router = express.Router();

function workflowIndex(status) {
  const i = WORKFLOW.indexOf(status);
  return i >= 0 ? i : 1e9;
}

function leafWhereLiteral() {
  // A "leaf" bordereau is either a sub-bordereau (parent_id is not null)
  // OR a bordereau that has no children.
  // We exclude parent groups from workload/todo counts.
  return sequelize.literal(`(parent_id IS NOT NULL OR id NOT IN (SELECT DISTINCT parent_id FROM bordereaux WHERE parent_id IS NOT NULL))`);
}

async function computeParentAggregateStatusTx(t, parentId) {
  const kids = await Bordereau.findAll({
    where: { parent_id: parentId },
    attributes: ['current_status'],
    transaction: t,
    lock: t.LOCK.SHARE,
  });
  if (!kids.length) return null;
  let minIdx = 1e9;
  for (const k of kids) minIdx = Math.min(minIdx, workflowIndex(k.current_status));
  if (!Number.isFinite(minIdx) || minIdx === 1e9) return BordereauStatus.CREE;
  return WORKFLOW[minIdx] || BordereauStatus.CREE;
}

async function syncParentStatusTx(t, parentId, actorUserId, actorRole, changedAt, comment) {
  if (!parentId) return;
  const parent = await Bordereau.findByPk(parentId, { transaction: t, lock: t.LOCK.UPDATE });
  if (!parent) return;

  const agg = await computeParentAggregateStatusTx(t, parentId);
  if (!agg) return;
  if (parent.current_status === agg) return;

  const from = parent.current_status;
  await parent.update({ current_status: agg, updated_at: changedAt }, { transaction: t });
  await BordereauStatusHistory.create({
    bordereau_id: parentId,
    from_status: from,
    to_status: agg,
    changed_by_user_id: actorUserId,
    changed_by_role: actorRole,
    changed_at: changedAt,
    comment: comment || 'Synchronisation automatique depuis sous-bordereaux',
    attachment_url: null,
  }, { transaction: t });
}

async function uniqueReferenceTx(t, baseRef) {
  let ref = baseRef;
  let i = 2;
  while (true) {
    const exists = await Bordereau.findOne({ where: { reference: ref }, transaction: t, lock: t.LOCK.SHARE });
    if (!exists) return ref;
    ref = `${baseRef}_${i}`;
    i += 1;
    if (i > 999) throw Object.assign(new Error('Unable to generate unique reference'), { status: 500 });
  }
}

function buildScannerReference(baseReference, scannerNumber, documentType) {
  const base = String(baseReference || '').trim();
  const num = refToken(scannerNumber, { maxLen: 20 });
  const doc = refToken(documentType, { maxLen: 30 });
  if (!base) return '';
  if (num && doc) return `${base}_${num}_${doc}`;
  if (num) return `${base}_${num}`;
  if (doc) return `${base}_${doc}`;
  return base;
}

async function ensureSubBordereauxTx(t, parentBordereau, actorUserId, actorRole, changedAt) {
  // Create sub-bordereaux from deposit document types.
  // Only split when the parent has multiple types.
  const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: parentBordereau.id }, transaction: t, lock: t.LOCK.UPDATE });
  if (!info) return [];

  const docs = await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: info.id }, transaction: t });
  if (!docs || docs.length <= 1) return [];

  // group by type (sum nombre)
  const grouped = new Map();
  for (const d of docs) {
    const k = String(d.type_document || '').trim();
    if (!k) continue;
    grouped.set(k, (grouped.get(k) || 0) + (Number(d.nombre) || 0));
  }
  const entries = Array.from(grouped.entries());
  if (entries.length <= 1) return [];

  // existing children (by document_type)
  const existing = await Bordereau.findAll({ where: { parent_id: parentBordereau.id }, transaction: t, lock: t.LOCK.UPDATE });
  const byType = new Map(existing.map(c => [String(c.document_type || '').trim(), c]));

  const created = [];

  for (const [docType, nombre] of entries) {
    const existingChild = byType.get(String(docType).trim());
    if (existingChild) {
      // Keep deposit info in sync (single type)
      await upsertDepositInfoTx(t, existingChild.id, {
        assureur: info.assureur,
        depotReference: info.depot_reference,
        responsable: info.responsable,
        documentTypes: [{ typeDocument: docType, nombre }],
      });
      continue;
    }

    const base = String(parentBordereau.reference || '').trim().slice(0, 240);
    const childRef = await uniqueReferenceTx(t, base);

    const child = await Bordereau.create({
      reference: childRef,
      base_reference: childRef,
      parent_id: parentBordereau.id,
      document_type: docType,
      client_id: parentBordereau.client_id ?? null,
      client_name: parentBordereau.client_name ?? null,
      description: parentBordereau.description ?? null,
      current_status: BordereauStatus.DEPOSE_SCAN,
      priority: !!parentBordereau.priority,
      priority_rank: parentBordereau.priority_rank ?? null,
      created_at: changedAt,
      updated_at: changedAt,
    }, { transaction: t });

    await BordereauStatusHistory.create({
      bordereau_id: child.id,
      from_status: null,
      to_status: BordereauStatus.DEPOSE_SCAN,
      changed_by_user_id: actorUserId,
      changed_by_role: actorRole,
      changed_at: changedAt,
      comment: `Création sous-bordereau (type: ${docType})`,
      attachment_url: null,
    }, { transaction: t });

    await upsertDepositInfoTx(t, child.id, {
      assureur: info.assureur,
      depotReference: info.depot_reference,
      responsable: info.responsable,
      documentTypes: [{ typeDocument: docType, nombre }],
    });

    created.push(child);
  }

  // After split, parent status becomes the aggregate of children (usually DEPOSE_SCAN)
  await syncParentStatusTx(t, parentBordereau.id, actorUserId, actorRole, changedAt, 'Synchronisation automatique (création sous-bordereaux)');

  return created;
}


function requireBusinessRole(req, role) {
  if (!req.user || !req.user.roles || !req.user.roles.includes(role)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

function userHasRole(req, role) {
  return !!(req.user && Array.isArray(req.user.roles) && req.user.roles.includes(role));
}

function userHasResponsableClientLikeRole(req) {
  return hasResponsableClientLikeRole(req.user?.roles || []);
}

async function getAllowedDocumentTypesForRole(roleName) {
  const rows = await RoleAllowedDocumentType.findAll({ where: { role_name: roleName } });
  return rows.map((r) => String(r.type_document || '').trim()).filter(Boolean);
}

function resolveEffectiveDocumentTypeFromData(bordereau, docTypes = []) {
  if (!bordereau) return '';
  const direct = String(bordereau.document_type || '').trim();
  if (direct) return direct;

  const unique = Array.from(new Set((docTypes || []).map((row) => String(row.type_document || row.typeDocument || '').trim()).filter(Boolean)));
  return unique.length === 1 ? unique[0] : '';
}

function isResponsableClientProdFlowForType(documentType, allowedTypes = []) {
  const type = String(documentType || '').trim();
  return !!type && (allowedTypes || []).includes(type);
}

async function resolveBordereauDocumentType(bordereau) {
  const fromData = resolveEffectiveDocumentTypeFromData(bordereau);
  if (fromData) return fromData;

  const bordereauId = Number(bordereau?.id || bordereau?.bordereau_id || 0);
  if (!bordereauId) return '';

  const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: bordereauId } });
  const legacy = String(info?.type_document || '').trim();
  if (legacy && legacy !== 'MULTI') return legacy;

  if (!info) return '';
  const docs = await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: info.id }, order: [['id', 'ASC']] });
  return resolveEffectiveDocumentTypeFromData(null, docs);
}

async function isBordereauResponsableClientProdFlow(bordereau, allowedTypes = []) {
  const documentType = await resolveBordereauDocumentType(bordereau);
  return isResponsableClientProdFlowForType(documentType, allowedTypes);
}

async function canResponsableLikeAccessBordereau(user, bordereau) {
  if (!user || !bordereau || !hasResponsableClientLikeRole(user.roles || [])) return false;

  const client = bordereau.client_id ? await Client.findByPk(bordereau.client_id, {
    include: [{ model: User, as: 'responsables', required: true, where: { id: user.id }, through: { attributes: [] } }],
  }) : null;
  if (!client) return false;

  const effectiveDocumentType = await resolveBordereauDocumentType(bordereau);

  if ((user.roles || []).includes(RoleName.RESPONSABLE_CLIENT_PROD)) {
    const allowed = await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT_PROD);
    if (!allowed.length) return false;
    return !!effectiveDocumentType && allowed.includes(effectiveDocumentType);
  }

  if ((user.roles || []).includes(RoleName.RESPONSABLE_CLIENT)) {
    const allowed = await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT);
    if (!allowed.length) return false;
    return !!effectiveDocumentType && allowed.includes(effectiveDocumentType);
  }

  return true;
}

function effectiveRoleForRollback(userRoles) {
  if (userRoles.includes(RoleName.ADMIN)) {
    const nonAdmin = userRoles.find(r => r !== RoleName.ADMIN);
    return nonAdmin || RoleName.ADMIN;
  }
  return userRoles[0];
}

function effectiveRoleForHistory(userRoles, actorRole) {
  // mirrors Spring: if COORDINATEUR exists, pick it (even if admin). else use actorRole passed.
  if (userRoles.includes(RoleName.COORDINATEUR)) return RoleName.COORDINATEUR;
  return actorRole;
}

function resolveRoleForTransition(userRoles, toStatus, options = {}) {
  const preferResponsableClientProd = options.preferResponsableClientProd !== false;
  const needed = (() => {
    switch (toStatus) {
      case BordereauStatus.RECUPERE_BO:
      case BordereauStatus.RECU_DU_RESPONSABLE:
      case BordereauStatus.DONNE_AU_COURSIER:
      case BordereauStatus.FINALISE:
      case BordereauStatus.CREE:
        return RoleName.BUREAU_ORDRE;
      case BordereauStatus.DEPOSE_SCAN:
        return RoleName.COORDINATEUR;
      case BordereauStatus.SCANNE:
        return RoleName.SCANNER;
      case BordereauStatus.VERIFIE:
        return RoleName.VERIFICATEUR;
      case BordereauStatus.PRET_A_ENVOYER:
      case BordereauStatus.VALIDE:
        return hasResponsableClientLikeRole(userRoles)
          ? ((preferResponsableClientProd && userRoles.includes(RoleName.RESPONSABLE_CLIENT_PROD)) ? RoleName.RESPONSABLE_CLIENT_PROD : RoleName.RESPONSABLE_CLIENT)
          : userRoles[0];
      default:
        return userRoles[0];
    }
  })();

  if (userRoles.includes(needed)) return needed;
  return userRoles[0];
}

const uploadDir = process.env.BORDEREAU_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'bordereaux');
const uploadUrlPrefix = (process.env.BORDEREAU_UPLOAD_URL_PREFIX || '/uploads/bordereaux/').endsWith('/')
  ? (process.env.BORDEREAU_UPLOAD_URL_PREFIX || '/uploads/bordereaux/')
  : (process.env.BORDEREAU_UPLOAD_URL_PREFIX || '/uploads/bordereaux/') + '/';

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const id = req.params.id || 'x';
    const ext = path.extname(file.originalname || '');
    const safeExt = ext && ext.length <= 10 ? ext.replace(/[^a-zA-Z0-9.]/g, '') : '';
    cb(null, `bordereau_${id}_${Date.now()}${safeExt}`);
  },
});

const upload = multer({ storage });

// DTO mappers
function depositInfoDto(info, documentTypes) {
  if (!info) return null;
  const docs = (documentTypes || []).map(d => ({ typeDocument: d.type_document, nombre: d.nombre }));
  // backward compatibility
  let typeDocument = undefined;
  let nombre = undefined;
  if (docs.length === 1) {
    typeDocument = docs[0].typeDocument;
    nombre = docs[0].nombre;
  } else if (docs.length > 1) {
    typeDocument = 'MULTI';
    nombre = docs.reduce((a, x) => a + (x.nombre || 0), 0);
  }

  return {
    assureur: info.assureur,
    depotReference: info.depot_reference,
    documentTypes: docs,
    responsable: info.responsable,
    matricule: info.matricule ?? null,
    nomPrenomPrestataire: info.nom_prenom_prestataire ?? null,
    natureDemande: info.nature_demande ?? null,
    documentsEnvoyes: info.documents_envoyes ?? null,
    dateAdhesionEffet: info.date_adhesion_effet ?? null,
    dateReceptionClient: info.date_reception_client ?? null,
    dateEnvoiAssureurDecharge: info.date_envoi_assureur_decharge ?? null,
    execution: info.execution ?? null,
    dateExecution: info.date_execution ?? null,
    remarque: info.remarque ?? null,
    createdAt: info.created_at,
    typeDocument,
    nombre,
  };
}

function bordereauDto(b, depositInfo, docTypes, finaliseEvent, receiptEvent, extra = {}) {
  const showBonRemise = workflowIndex(b.current_status) >= workflowIndex(BordereauStatus.RECU_DU_RESPONSABLE);
  const showFinalDecharge = workflowIndex(b.current_status) >= workflowIndex(BordereauStatus.FINALISE);
  return {
    id: b.id,
    reference: b.reference,
    parentId: b.parent_id ?? null,
    parentReference: extra.parentReference ?? (b.parent ? b.parent.reference : null),
    documentType: b.document_type ?? null,
    childrenCount: extra.childrenCount ?? 0,
    children: extra.children ?? undefined,
    clientId: b.client_id ?? null,
    clientName: (b.client ? b.client.name : b.client_name) ?? null,
    description: b.description ?? null,
    currentStatus: b.current_status,
    // For a parent group, surface the statuses of its sub-bordereaux so the UI can display a multi-status view.
    // Shape: [{ status: 'DEPOSE_SCAN', count: 2 }, ...]
    childrenStatusCounts: extra.childrenStatusCounts ?? undefined,
    priority: !!b.priority,
    priorityRank: b.priority_rank ?? null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    finalDechargeUrl: showFinalDecharge ? (finaliseEvent?.attachment_url ?? null) : null,
    finalDechargeAt: showFinalDecharge ? (finaliseEvent?.changed_at ?? null) : null,
    bonRemiseUrl: showBonRemise ? (receiptEvent?.attachment_url ?? null) : null,
    bonRemiseAt: showBonRemise ? (receiptEvent?.changed_at ?? null) : null,
    depositInfo: depositInfoDto(depositInfo, docTypes),
    isResponsableClientProdFlow: !!extra.isResponsableClientProdFlow,
  };
}

function historyDto(h) {
  return {
    id: h.id,
    fromStatus: h.from_status ?? null,
    toStatus: h.to_status,
    changedByEmail: h.changedBy?.email ?? '',
    changedByName: h.changedBy?.email ?? '',
    changedByRole: h.changed_by_role,
    changedAt: h.changed_at,
    comment: h.comment ?? null,
    attachmentUrl: h.attachment_url ?? null,
  };
}

async function getLatestStatusEvents(bordereauIds, status) {
  if (!bordereauIds || bordereauIds.length === 0) return new Map();

  const rows = await sequelize.query(
    `
    SELECT h.*
    FROM bordereau_status_history h
    JOIN (
      SELECT bordereau_id, MAX(changed_at) AS max_changed
      FROM bordereau_status_history
      WHERE bordereau_id IN (:ids) AND to_status = :status
      GROUP BY bordereau_id
    ) t
      ON t.bordereau_id = h.bordereau_id AND t.max_changed = h.changed_at
    WHERE h.to_status = :status
    `,
    { replacements: { ids: bordereauIds, status }, type: QueryTypes.SELECT }
  );

  const map = new Map();
  for (const r of rows) map.set(Number(r.bordereau_id), r);
  return map;
}

async function getLatestFinaliseEvents(bordereauIds) {
  return getLatestStatusEvents(bordereauIds, BordereauStatus.FINALISE);
}

async function getLatestReceiptEvents(bordereauIds) {
  return getLatestStatusEvents(bordereauIds, BordereauStatus.RECU_DU_RESPONSABLE);
}

function normalizeOptionalDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error('Invalid date value'), { status: 400 });
  }
  return d;
}

async function upsertDepositInfoTx(t, bordereauId, reqData) {
  const assureur = String(reqData.assureur || '').trim();
  const depotReference = String(reqData.depotReference || '').trim();
  const responsable = String(reqData.responsable || '').trim();
  const matricule = String(reqData.matricule || '').trim() || null;
  const nomPrenomPrestataire = String(reqData.nomPrenomPrestataire || '').trim() || null;
  const natureDemande = String(reqData.natureDemande || '').trim() || null;
  const documentsEnvoyes = String(reqData.documentsEnvoyes || '').trim() || null;
  const execution = String(reqData.execution || '').trim() || null;
  const remarque = String(reqData.remarque || '').trim() || null;
  const dateAdhesionEffet = normalizeOptionalDate(reqData.dateAdhesionEffet);
  const dateReceptionClient = normalizeOptionalDate(reqData.dateReceptionClient);
  const dateEnvoiAssureurDecharge = normalizeOptionalDate(reqData.dateEnvoiAssureurDecharge);
  const dateExecution = normalizeOptionalDate(reqData.dateExecution);

  let documentTypes = reqData.documentTypes;
  if (!Array.isArray(documentTypes) || documentTypes.length === 0) {
    // backward compat
    documentTypes = [{ typeDocument: reqData.typeDocument, nombre: reqData.nombre }];
  }

  // validate
  if (isBlank(assureur)) throw Object.assign(new Error('Assureur is required'), { status: 400 });
  if (isBlank(depotReference)) throw Object.assign(new Error('Référence is required'), { status: 400 });
  if (isBlank(responsable)) throw Object.assign(new Error('Responsable is required'), { status: 400 });

  for (const item of documentTypes) {
    if (!item) throw Object.assign(new Error('Document type item is required'), { status: 400 });
    if (isBlank(item.typeDocument)) throw Object.assign(new Error('Type document is required'), { status: 400 });
    const nb = Number(item.nombre);
    if (!Number.isFinite(nb) || nb <= 0) throw Object.assign(new Error('Nombre must be > 0'), { status: 400 });
  }

  if (reqData.requireResponsableClientProdFields) {
    if (isBlank(matricule)) throw Object.assign(new Error('Matricule is required'), { status: 400 });
    if (isBlank(nomPrenomPrestataire)) throw Object.assign(new Error('Nom prénom prestataire is required'), { status: 400 });
    if (isBlank(natureDemande)) throw Object.assign(new Error('Nature de la demande is required'), { status: 400 });
    if (isBlank(documentsEnvoyes)) throw Object.assign(new Error('Documents envoyés is required'), { status: 400 });
  }

  let info = await BordereauDepositInfo.findOne({ where: { bordereau_id: bordereauId }, transaction: t });
  if (!info) {
    info = await BordereauDepositInfo.create({
      bordereau_id: bordereauId,
      assureur,
      depot_reference: depotReference,
      responsable,
      matricule,
      nom_prenom_prestataire: nomPrenomPrestataire,
      nature_demande: natureDemande,
      documents_envoyes: documentsEnvoyes,
      date_adhesion_effet: dateAdhesionEffet,
      date_reception_client: dateReceptionClient,
      date_envoi_assureur_decharge: dateEnvoiAssureurDecharge,
      execution,
      date_execution: dateExecution,
      remarque,
      type_document: '',
      nombre: 0,
      created_at: new Date(),
    }, { transaction: t });
  } else {
    await info.update({
      assureur,
      depot_reference: depotReference,
      responsable,
      matricule,
      nom_prenom_prestataire: nomPrenomPrestataire,
      nature_demande: natureDemande,
      documents_envoyes: documentsEnvoyes,
      date_adhesion_effet: dateAdhesionEffet,
      date_reception_client: dateReceptionClient,
      date_envoi_assureur_decharge: dateEnvoiAssureurDecharge,
      execution,
      date_execution: dateExecution,
      remarque,
    }, { transaction: t });
  }

  // replace doc types
  await BordereauDepositDocumentType.destroy({ where: { deposit_info_id: info.id }, transaction: t });

  const docs = [];
  for (const item of documentTypes) {
    docs.push({
      deposit_info_id: info.id,
      type_document: String(item.typeDocument).trim(),
      nombre: Number(item.nombre),
    });
  }
  await BordereauDepositDocumentType.bulkCreate(docs, { transaction: t });

  const nombreSum = docs.reduce((a, d) => a + (d.nombre || 0), 0);
  const typeDocLegacy = docs.length === 1 ? docs[0].type_document : 'MULTI';

  await info.update({ type_document: typeDocLegacy, nombre: nombreSum }, { transaction: t });

  const bordereauType = docs.length === 1 ? docs[0].type_document : null;
  await Bordereau.update(
    { document_type: bordereauType, updated_at: new Date() },
    { where: { id: bordereauId }, transaction: t }
  );

  return info;
}

function validateTransition(from, to, userRoles, attachmentProvided, data, options = {}) {
  const isResponsableClientProdFlow = !!options.isResponsableClientProdFlow;
  const actorRole = options.actorRole;
  const rules = [
    { from: BordereauStatus.CREE, to: BordereauStatus.RECUPERE_BO, role: RoleName.BUREAU_ORDRE, attachmentRequired: false },
    { from: BordereauStatus.RECUPERE_BO, to: BordereauStatus.DEPOSE_SCAN, role: RoleName.COORDINATEUR, attachmentRequired: false },
    { from: BordereauStatus.DEPOSE_SCAN, to: BordereauStatus.SCANNE, role: RoleName.SCANNER, attachmentRequired: false },
    { from: BordereauStatus.SCANNE, to: BordereauStatus.VERIFIE, role: RoleName.VERIFICATEUR, attachmentRequired: false },
    // Responsable client: plus d'upload de décharge ici
    { from: BordereauStatus.VERIFIE, to: BordereauStatus.PRET_A_ENVOYER, role: 'RESPONSABLE_CLIENT_LIKE', attachmentRequired: false },
    // Responsable demande des modifications -> BO/coursier renvoie au client
    { from: BordereauStatus.VERIFIE, to: BordereauStatus.A_RENVOYER_AU_CLIENT, role: RoleName.RESPONSABLE_CLIENT_PROD, attachmentRequired: false, commentRequired: true },
    // Si le client a renvoyé mais que les modifications sont encore insuffisantes, le responsable peut redemander des modifications
    { from: BordereauStatus.RECU_DU_CLIENT, to: BordereauStatus.A_RENVOYER_AU_CLIENT, role: RoleName.RESPONSABLE_CLIENT_PROD, attachmentRequired: false, commentRequired: true },
    // BO/coursier confirme que le bordereau est renvoyé au client
    { from: BordereauStatus.A_RENVOYER_AU_CLIENT, to: BordereauStatus.RENVOYE_AU_CLIENT, role: [RoleName.BUREAU_ORDRE, RoleName.COURSIER], attachmentRequired: false },
    // Client renvoie le bordereau: le BO marque la réception
    { from: BordereauStatus.RENVOYE_AU_CLIENT, to: BordereauStatus.RECU_DU_CLIENT, role: RoleName.BUREAU_ORDRE, attachmentRequired: false },
    // Responsable confirme que les modifications sont OK -> redémarre le workflow à RECUPERE_BO
    { from: BordereauStatus.RECU_DU_CLIENT, to: BordereauStatus.RECUPERE_BO, role: RoleName.RESPONSABLE_CLIENT_PROD, attachmentRequired: false },
    // Bureau d'ordre confirme la réception puis remet au coursier
    { from: BordereauStatus.PRET_A_ENVOYER, to: BordereauStatus.RECU_DU_RESPONSABLE, role: RoleName.BUREAU_ORDRE, attachmentRequired: false },
    { from: BordereauStatus.RECU_DU_RESPONSABLE, to: BordereauStatus.DONNE_AU_COURSIER, role: RoleName.BUREAU_ORDRE, attachmentRequired: false },
    { from: BordereauStatus.DONNE_AU_COURSIER, to: BordereauStatus.FINALISE, role: RoleName.BUREAU_ORDRE, attachmentRequired: true },
    { from: BordereauStatus.FINALISE, to: BordereauStatus.VALIDE, role: 'RESPONSABLE_CLIENT_LIKE', attachmentRequired: false },
  ];

  const rule = rules.find(r => r.from === from && r.to === to);
  if (!rule) throw Object.assign(new Error(`Transition not allowed: ${from} -> ${to}`), { status: 400 });
  if (rule.role === 'RESPONSABLE_CLIENT_LIKE') {
    if (!hasResponsableClientLikeRole(userRoles)) throw Object.assign(new Error('Role not allowed for this transition'), { status: 403 });
  } else if (Array.isArray(rule.role)) {
    const ok = rule.role.some(r => userRoles.includes(r));
    if (!ok) throw Object.assign(new Error('Role not allowed for this transition'), { status: 403 });
  } else if (!userRoles.includes(rule.role)) throw Object.assign(new Error('Role not allowed for this transition'), { status: 403 });
  if (rule.attachmentRequired && !attachmentProvided) throw Object.assign(new Error('Attachment required for this transition'), { status: 400 });
  if (rule.commentRequired && isBlank(data?.comment)) throw Object.assign(new Error('Un commentaire (motif) est obligatoire'), { status: 400 });

  const rcProdOnlyStatuses = [
    BordereauStatus.A_RENVOYER_AU_CLIENT,
    BordereauStatus.RENVOYE_AU_CLIENT,
    BordereauStatus.RECU_DU_CLIENT,
  ];
  if (!isResponsableClientProdFlow && (rcProdOnlyStatuses.includes(from) || rcProdOnlyStatuses.includes(to))) {
    throw Object.assign(new Error('Cette démarche de retour client est réservée aux bordereaux Responsable Client Prod'), { status: 400 });
  }

  if (to === BordereauStatus.DEPOSE_SCAN) {
    // Validate deposit info here (upsertDepositInfoTx re-validates)
    if (isBlank(data.assureur)) throw Object.assign(new Error('Assureur is required'), { status: 400 });
    if (isBlank(data.depotReference)) throw Object.assign(new Error('Référence is required'), { status: 400 });
    if (isBlank(data.responsable)) throw Object.assign(new Error('Responsable is required'), { status: 400 });
  }

  if (to === BordereauStatus.SCANNE) {
    if (isBlank(data.scannerNumber)) throw Object.assign(new Error('Numéro scanner is required'), { status: 400 });
  }

  if (to === BordereauStatus.PRET_A_ENVOYER && actorRole === RoleName.RESPONSABLE_CLIENT_PROD && isResponsableClientProdFlow) {
    if (isBlank(data.matricule)) throw Object.assign(new Error('Matricule is required'), { status: 400 });
    if (isBlank(data.nomPrenomPrestataire)) throw Object.assign(new Error('Nom prénom prestataire is required'), { status: 400 });
    if (isBlank(data.natureDemande)) throw Object.assign(new Error('Nature de la demande is required'), { status: 400 });
    if (isBlank(data.documentsEnvoyes)) throw Object.assign(new Error('Documents envoyés is required'), { status: 400 });
  }

  if (to === BordereauStatus.VALIDE && actorRole === RoleName.RESPONSABLE_CLIENT_PROD && isResponsableClientProdFlow) {
    if (isBlank(data.dateEnvoiAssureurDecharge)) throw Object.assign(new Error("Date d'envoi à l'assureur// Décharge is required"), { status: 400 });
    if (isBlank(data.execution)) throw Object.assign(new Error('Exécution is required'), { status: 400 });
    if (isBlank(data.dateExecution)) throw Object.assign(new Error("Date d'exécution is required"), { status: 400 });
  }
}

// POST /api/bordereaux
router.post('/', async (req, res) => {
  requireBusinessRole(req, RoleName.BUREAU_ORDRE);

  const { reference, clientId, clientName, description } = req.body || {};

  // If a reference is provided explicitly, keep it as-is.
  // Otherwise generate: YYYY_<CLIENT>.
  // Duplicate initial references are allowed: multiple bordereaux can share the
  // same client-based reference until one of them is renamed later in the flow.
  let ref = String(reference || '').trim();

  const created = await sequelize.transaction(async (t) => {
    let client = null;
    let legacyClientName = clientName;

    if (clientId != null) {
      client = await Client.findByPk(clientId, { transaction: t });
      if (!client) throw Object.assign(new Error('Client not found'), { status: 400 });
      legacyClientName = client.name;
    }

    if (!ref) {
      if (isBlank(legacyClientName)) throw Object.assign(new Error('Client is required to generate a reference'), { status: 400 });

      let year = new Date().getFullYear();
      try {
        const tz = process.env.APP_TIMEZONE || 'Africa/Tunis';
        year = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(new Date()));
      } catch (_e) {
        // fallback to server local year
      }
      const token = refToken(legacyClientName, { maxLen: 40 }) || 'CLIENT';

      ref = `${year}_${token}`;
    }

    const b = await Bordereau.create({
      reference: ref,
      base_reference: ref,
      client_id: client ? client.id : null,
      client_name: legacyClientName ?? null,
      description: description ?? null,
      current_status: BordereauStatus.CREE,
      priority: false,
      priority_rank: null,
      created_at: new Date(),
      updated_at: new Date(),
    }, { transaction: t });

    await BordereauStatusHistory.create({
      bordereau_id: b.id,
      from_status: null,
      to_status: BordereauStatus.CREE,
      changed_by_user_id: req.user.id,
      changed_by_role: RoleName.BUREAU_ORDRE,
      changed_at: new Date(),
      comment: 'Création du bordereau',
      attachment_url: null,
    }, { transaction: t });

    return b;
  });

  const full = await Bordereau.findByPk(created.id, { include: [{ model: Client, as: 'client' }] });
  res.json(bordereauDto(full, null, [], null, null));
});

// GET /api/bordereaux
router.get('/', async (req, res) => {
  const isAdmin = userHasRole(req, RoleName.ADMIN);
  const isResponsable = userHasResponsableClientLikeRole(req);
  const isResponsableProd = userHasRole(req, RoleName.RESPONSABLE_CLIENT_PROD);
  const paginate = shouldPaginate(req.query);

  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const priorityRaw = req.query.priority;
  const priority = (() => {
    if (priorityRaw == null || String(priorityRaw).trim() === '') return null;
    const v = String(priorityRaw).toLowerCase().trim();
    if (['1','true','yes','y','on'].includes(v)) return true;
    if (['0','false','no','n','off'].includes(v)) return false;
    return null;
  })();

  const where = {};
  if (status) where.current_status = status;
  if (priority !== null) where.priority = priority;
  if (q) {
    const matchedClients = await Client.findAll({
      where: { name: { [Op.like]: `%${q}%` } },
      attributes: ['id'],
    });
    const clientIds = matchedClients.map(c => Number(c.id)).filter(Boolean);

    const or = [];
    or.push({ reference: { [Op.like]: `%${q}%` } });
    or.push({ description: { [Op.like]: `%${q}%` } });
    or.push({ client_name: { [Op.like]: `%${q}%` } });
    if (clientIds.length) or.push({ client_id: { [Op.in]: clientIds } });
    const n = Number(q);
    if (Number.isFinite(n) && String(n) === q) or.push({ id: n });
    where[Op.or] = or;
  }

  const include = (!isAdmin && isResponsable)
    ? [{
        model: Client, as: 'client', required: true,
        include: [{ model: User, as: 'responsables', required: true, where: { id: req.user.id }, through: { attributes: [] } }],
      }]
    : [{ model: Client, as: 'client', required: false }];

  const initialItems = await Bordereau.findAll({
    include,
    where,
    order: queueOrder(),
    distinct: true,
  });

  let items = initialItems;

  if (!isAdmin && isResponsable) {
    const allowed = isResponsableProd
      ? await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT_PROD)
      : await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT);

    if (!allowed.length) {
      items = [];
    } else {
      const filtered = [];
      for (const item of initialItems) {
        const effectiveType = await resolveBordereauDocumentType(item);
        if (effectiveType && allowed.includes(effectiveType)) filtered.push(item);
      }
      items = filtered;
    }
  }

  const total = items.length;
  let page = 1;
  let size = 0;

  if (paginate) {
    const paging = parsePaging(req.query, { defaultSize: 25, maxSize: 200 });
    page = paging.page;
    size = paging.size;
    items = items.slice(paging.offset, paging.offset + paging.limit);
  }

  const ids = items.map(b => b.id);
  const finaliseMap = await getLatestFinaliseEvents(ids);
  const receiptMap = await getLatestReceiptEvents(ids);

  const childCountsRows = ids.length ? await Bordereau.findAll({
    attributes: ['parent_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
    where: { parent_id: { [Op.in]: ids } },
    group: ['parent_id'],
    raw: true,
  }) : [];
  const childCountById = new Map(childCountsRows.map(r => [Number(r.parent_id), Number(r.cnt)]));

  const childStatusRows = ids.length ? await Bordereau.findAll({
    attributes: ['parent_id', 'current_status', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
    where: { parent_id: { [Op.in]: ids } },
    group: ['parent_id', 'current_status'],
    raw: true,
  }) : [];
  const childStatusesByParentId = new Map();
  for (const r of childStatusRows) {
    const pid = Number(r.parent_id);
    if (!childStatusesByParentId.has(pid)) childStatusesByParentId.set(pid, []);
    childStatusesByParentId.get(pid).push({ status: String(r.current_status), count: Number(r.cnt) });
  }

  const parentIds = Array.from(new Set(items.map(x => Number(x.parent_id)).filter(Boolean)));
  const parentRows = parentIds.length ? await Bordereau.findAll({ where: { id: { [Op.in]: parentIds } }, attributes: ['id','reference'], raw: true }) : [];
  const parentRefById = new Map(parentRows.map(r => [Number(r.id), String(r.reference)]));

  const depositInfos = await BordereauDepositInfo.findAll({ where: { bordereau_id: { [Op.in]: ids } } });
  const infoByBordId = new Map(depositInfos.map(i => [Number(i.bordereau_id), i]));

  const infoIds = depositInfos.map(i => i.id);
  const docTypes = infoIds.length
    ? await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: { [Op.in]: infoIds } } })
    : [];

  const docByInfoId = new Map();
  for (const d of docTypes) {
    const k = Number(d.deposit_info_id);
    if (!docByInfoId.has(k)) docByInfoId.set(k, []);
    docByInfoId.get(k).push(d);
  }

  const responsableProdAllowedTypes = await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT_PROD);
  const dtos = items.map(b => {
    const info = infoByBordId.get(Number(b.id)) || null;
    const docs = info ? (docByInfoId.get(Number(info.id)) || []) : [];
    return bordereauDto(b, info, docs, finaliseMap.get(Number(b.id)), receiptMap.get(Number(b.id)), {
      childrenCount: childCountById.get(Number(b.id)) || 0,
      parentReference: b.parent_id ? (parentRefById.get(Number(b.parent_id)) || null) : null,
      isResponsableClientProdFlow: isResponsableClientProdFlowForType(resolveEffectiveDocumentTypeFromData(b, docs), responsableProdAllowedTypes),
    });
  });

  for (const dto of dtos) {
    if (!dto.parentId && (dto.childrenCount || 0) > 0) {
      dto.childrenStatusCounts = childStatusesByParentId.get(dto.id) || [];
    }
  }

  if (!paginate) return res.json(dtos);

  return res.json(pageResponse({ items: dtos, page, size, total }));
});

router.get('/todo-count', async (req, res) => {
  const roles = req.user.roles;

  const isAdmin = roles.includes(RoleName.ADMIN);
  const effectiveRole = isAdmin ? RoleName.ADMIN : roles[0];

  if (effectiveRole === RoleName.ADMIN) {
    const c = await Bordereau.count({ where: { [Op.and]: [leafWhereLiteral(), { current_status: { [Op.ne]: BordereauStatus.VALIDE } }] } });
    return res.json(c);
  }

  const statuses = (() => {
    switch (effectiveRole) {
      case RoleName.BUREAU_ORDRE: return [BordereauStatus.CREE, BordereauStatus.PRET_A_ENVOYER, BordereauStatus.A_RENVOYER_AU_CLIENT, BordereauStatus.RENVOYE_AU_CLIENT, BordereauStatus.RECU_DU_RESPONSABLE, BordereauStatus.DONNE_AU_COURSIER];
      case RoleName.COORDINATEUR: return [BordereauStatus.RECUPERE_BO];
      case RoleName.SCANNER: return [BordereauStatus.DEPOSE_SCAN];
      case RoleName.VERIFICATEUR: return [BordereauStatus.SCANNE];
      case RoleName.RESPONSABLE_CLIENT: return [BordereauStatus.VERIFIE, BordereauStatus.FINALISE];
      case RoleName.RESPONSABLE_CLIENT_PROD: return [BordereauStatus.VERIFIE, BordereauStatus.RECU_DU_CLIENT, BordereauStatus.FINALISE];
      default: return [];
    }
  })();

  if (!statuses.length) return res.json(0);
  const c = await Bordereau.count({ where: { [Op.and]: [leafWhereLiteral(), { current_status: { [Op.in]: statuses } }] } });
  return res.json(c);
});

router.get('/workload', async (req, res) => {
  const roles = Array.from(new Set(req.user.roles)).sort();

  const hasAdmin = roles.includes(RoleName.ADMIN);
  const effective = roles.filter(r => r !== RoleName.ADMIN);

  if (hasAdmin && effective.length === 0) {
    const c = await Bordereau.count({ where: { [Op.and]: [leafWhereLiteral(), { current_status: { [Op.ne]: BordereauStatus.VALIDE } }] } });
    return res.json({ total: c, buckets: [{ role: RoleName.ADMIN, status: null, count: c }] });
  }

  let total = 0;
  const buckets = [];

  for (const role of effective) {
    const statuses = (() => {
      switch (role) {
        case RoleName.BUREAU_ORDRE: return [BordereauStatus.CREE, BordereauStatus.PRET_A_ENVOYER, BordereauStatus.A_RENVOYER_AU_CLIENT, BordereauStatus.RENVOYE_AU_CLIENT, BordereauStatus.RECU_DU_RESPONSABLE, BordereauStatus.DONNE_AU_COURSIER];
        case RoleName.COORDINATEUR: return [BordereauStatus.RECUPERE_BO];
        case RoleName.SCANNER: return [BordereauStatus.DEPOSE_SCAN];
        case RoleName.VERIFICATEUR: return [BordereauStatus.SCANNE];
        case RoleName.RESPONSABLE_CLIENT: return [BordereauStatus.VERIFIE, BordereauStatus.FINALISE];
      case RoleName.RESPONSABLE_CLIENT_PROD: return [BordereauStatus.VERIFIE, BordereauStatus.RECU_DU_CLIENT, BordereauStatus.FINALISE];
        default: return [];
      }
    })();

    for (const st of statuses) {
      const c = await Bordereau.count({ where: { [Op.and]: [leafWhereLiteral(), { current_status: st }] } });
      buckets.push({ role, status: st, count: c });
      total += c;
    }
  }

  res.json({ total, buckets });
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = await Bordereau.findByPk(id, {
    include: [
      { model: Client, as: 'client', required: false },
      { model: Bordereau, as: 'parent', required: false, attributes: ['id','reference'] },
    ],
  });
  if (!b) return res.status(404).json({ message: 'Bordereau not found' });
  if (!userHasRole(req, RoleName.ADMIN) && userHasResponsableClientLikeRole(req)) {
    const ok = await canResponsableLikeAccessBordereau(req.user, b);
    if (!ok) return res.status(404).json({ message: 'Bordereau not found' });
  }

  const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: id } });
  const docs = info ? await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: info.id } }) : [];
  const responsableProdAllowedTypes = await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT_PROD);
  const isResponsableClientProdFlow = isResponsableClientProdFlowForType(resolveEffectiveDocumentTypeFromData(b, docs), responsableProdAllowedTypes);

  // children (sub-bordereaux)
  const children = await Bordereau.findAll({
    where: { parent_id: id },
    include: [{ model: Client, as: 'client', required: false }],
    order: [['reference','ASC']],
  });

  const childIds = children.map(c => Number(c.id));
  const childFinaliseMap = await getLatestFinaliseEvents(childIds);
  const childReceiptMap = await getLatestReceiptEvents(childIds);

  const childInfos = childIds.length ? await BordereauDepositInfo.findAll({ where: { bordereau_id: { [Op.in]: childIds } } }) : [];
  const infoByChildId = new Map(childInfos.map(i => [Number(i.bordereau_id), i]));
  const infoIds = childInfos.map(i => Number(i.id));
  const childDocTypes = infoIds.length ? await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: { [Op.in]: infoIds } } }) : [];

  const docByInfoId = new Map();
  for (const d of childDocTypes) {
    const k = Number(d.deposit_info_id);
    if (!docByInfoId.has(k)) docByInfoId.set(k, []);
    docByInfoId.get(k).push(d);
  }

  const childrenDtos = children.map(c => {
    const ci = infoByChildId.get(Number(c.id)) || null;
    const cd = ci ? (docByInfoId.get(Number(ci.id)) || []) : [];
    return bordereauDto(c, ci, cd, childFinaliseMap.get(Number(c.id)), childReceiptMap.get(Number(c.id)), { parentReference: b.reference, childrenCount: 0, isResponsableClientProdFlow: isResponsableClientProdFlowForType(resolveEffectiveDocumentTypeFromData(c, cd), responsableProdAllowedTypes) });
  });

  // status breakdown for children
  const childrenStatusCounts = (() => {
    const m = new Map();
    for (const c of children) {
      const s = String(c.current_status);
      m.set(s, (m.get(s) || 0) + 1);
    }
    return Array.from(m.entries()).map(([status, count]) => ({ status, count }));
  })();

  const finaliseMap = await getLatestFinaliseEvents([id]);
  const receiptMap = await getLatestReceiptEvents([id]);
  res.json(bordereauDto(b, info, docs, finaliseMap.get(id), receiptMap.get(id), {
    parentReference: b.parent ? b.parent.reference : null,
    childrenCount: childrenDtos.length,
    children: childrenDtos,
    childrenStatusCounts: childrenStatusCounts.length ? childrenStatusCounts : undefined,
    isResponsableClientProdFlow,
  }));
});

router.get('/:id/history', async (req, res) => {
  const id = Number(req.params.id);
  const paginate = shouldPaginate(req.query);

  const q = String(req.query.q || '').trim();
  const toStatus = String(req.query.toStatus || '').trim();
  const fromStatus = String(req.query.fromStatus || '').trim();

  const where = { bordereau_id: id };
  if (toStatus) where.to_status = toStatus;
  if (fromStatus) where.from_status = fromStatus;
  if (q) {
    const or = [];
    or.push({ comment: { [Op.like]: `%${q}%` } });
    or.push({ changed_by_role: { [Op.like]: `%${q}%` } });
    or.push({ to_status: { [Op.like]: `%${q}%` } });
    or.push({ from_status: { [Op.like]: `%${q}%` } });
    or.push({ '$changedBy.email$': { [Op.like]: `%${q}%` } });
    where[Op.or] = or;
  }

  if (!paginate) {
    const items = await BordereauStatusHistory.findAll({
      where,
      include: [{ model: User, as: 'changedBy', required: false }],
      order: [['changed_at','ASC'], ['id','ASC']],
      subQuery: false,
    });
    return res.json(items.map(historyDto));
  }

  const sort = String(req.query.sort || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const { page, size, limit, offset } = parsePaging(req.query, { defaultSize: 10, maxSize: 200 });

  const result = await BordereauStatusHistory.findAndCountAll({
    where,
    include: [{ model: User, as: 'changedBy', required: false }],
    order: [['changed_at', sort], ['id', sort]],
    limit,
    offset,
    subQuery: false,
  });

  const total = typeof result.count === 'number' ? result.count : (Array.isArray(result.count) ? result.count.length : Number(result.count || 0));

  return res.json(pageResponse({ items: result.rows.map(historyDto), page, size, total }));
});

router.post('/:id/transition', upload.single('attachment'), async (req, res) => {
  const id = Number(req.params.id);

  let data = null;
  try {
    data = req.body && req.body.data ? JSON.parse(req.body.data) : null;
  } catch (e) {
    return res.status(400).json({ message: 'Invalid data JSON' });
  }
  if (!data || !data.toStatus) return res.status(400).json({ message: 'toStatus is required' });

  const b = await Bordereau.findByPk(id, { include: [{ model: Client, as: 'client', required: false }] });
  const existingChildrenCount = await Bordereau.count({ where: { parent_id: id } });
  if (!b.parent_id && existingChildrenCount > 0) {
    return res.status(400).json({ message: 'Ce bordereau est un bordereau mère. Veuillez traiter les sous-bordereaux.' });
  }
  if (!b) return res.status(404).json({ message: 'Bordereau not found' });
  if (!userHasRole(req, RoleName.ADMIN) && userHasResponsableClientLikeRole(req)) {
    const ok = await canResponsableLikeAccessBordereau(req.user, b);
    if (!ok) return res.status(404).json({ message: 'Bordereau not found' });
  }

  const from = b.current_status;
  const to = data.toStatus;
  const userRoles = req.user.roles;
  const responsableProdAllowedTypes = await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT_PROD);
  const isResponsableClientProdFlow = await isBordereauResponsableClientProdFlow(b, responsableProdAllowedTypes);
  const actorRole = resolveRoleForTransition(userRoles, to, { preferResponsableClientProd: isResponsableClientProdFlow });
  const attachmentProvided = !!req.file;

  const changedAt = new Date();

  try {
    validateTransition(from, to, userRoles, attachmentProvided, data, { isResponsableClientProdFlow, actorRole });
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }

  let attachmentUrl = req.file ? (uploadUrlPrefix + req.file.filename) : null;

  const updated = await sequelize.transaction(async (t) => {
    // Backfill base_reference for older DB rows (best-effort)
    if (!String(b.base_reference || '').trim()) {
      await b.update({ base_reference: b.reference }, { transaction: t });
    }

    if (to === BordereauStatus.DEPOSE_SCAN) {
      await upsertDepositInfoTx(t, id, data);
    }

    if (to === BordereauStatus.PRET_A_ENVOYER && actorRole === RoleName.RESPONSABLE_CLIENT_PROD && isResponsableClientProdFlow) {
      await upsertDepositInfoTx(t, id, {
        ...data,
        assureur: data.assureur || b.client_name || b.client?.name || 'N/A',
        depotReference: data.depotReference || b.reference,
        responsable: data.responsable || req.user.email,
        documentTypes: data.documentTypes || (b.document_type ? [{ typeDocument: b.document_type, nombre: 1 }] : [{ typeDocument: 'N/A', nombre: 1 }]),
        requireResponsableClientProdFields: true,
      });
    }

    if (to === BordereauStatus.VALIDE && actorRole === RoleName.RESPONSABLE_CLIENT_PROD && isResponsableClientProdFlow) {
      const existingInfo = await BordereauDepositInfo.findOne({ where: { bordereau_id: id }, transaction: t });
      if (!existingInfo) throw Object.assign(new Error('Informations initiales introuvables pour compléter le formulaire'), { status: 400 });
      const rawDocTypes = await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: existingInfo.id }, transaction: t });
      await upsertDepositInfoTx(t, id, {
        assureur: existingInfo.assureur,
        depotReference: existingInfo.depot_reference,
        responsable: existingInfo.responsable,
        matricule: data.matricule ?? existingInfo.matricule,
        nomPrenomPrestataire: data.nomPrenomPrestataire ?? existingInfo.nom_prenom_prestataire,
        natureDemande: data.natureDemande ?? existingInfo.nature_demande,
        documentsEnvoyes: data.documentsEnvoyes ?? existingInfo.documents_envoyes,
        dateAdhesionEffet: data.dateAdhesionEffet ?? existingInfo.date_adhesion_effet,
        dateReceptionClient: data.dateReceptionClient ?? existingInfo.date_reception_client,
        dateEnvoiAssureurDecharge: data.dateEnvoiAssureurDecharge,
        execution: data.execution,
        dateExecution: data.dateExecution,
        remarque: data.remarque,
        documentTypes: rawDocTypes.map((d) => ({ typeDocument: d.type_document, nombre: d.nombre })),
      });
    }

    if (to === BordereauStatus.SCANNE) {
      let baseReference = b.base_reference || b.reference;
      if (b.parent_id) {
        const parent = await Bordereau.findByPk(Number(b.parent_id), { transaction: t, lock: t.LOCK.SHARE });
        if (parent?.base_reference || parent?.reference) baseReference = parent.base_reference || parent.reference;
      }
      const nextReference = buildScannerReference(baseReference, data.scannerNumber, b.document_type);
      if (!nextReference) throw Object.assign(new Error('Unable to generate scanner reference'), { status: 400 });
      const exists = await Bordereau.findOne({ where: { reference: nextReference, id: { [Op.ne]: id } }, transaction: t, lock: t.LOCK.SHARE });
      if (exists) throw Object.assign(new Error('Reference already exists'), { status: 400 });
      await b.update({ reference: nextReference, updated_at: changedAt }, { transaction: t });
    }

    if (to === BordereauStatus.RECU_DU_RESPONSABLE) {
      const infoForPdf = await BordereauDepositInfo.findOne({ where: { bordereau_id: id }, transaction: t });
      if (!infoForPdf) throw Object.assign(new Error('Informations de dépôt introuvables pour générer le bon de remise'), { status: 400 });
      const rawDocTypes = await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: infoForPdf.id }, transaction: t });
      const pdfResult = await generateBonRemisePdf({
        bordereau: b,
        depositInfo: {
          assureur: infoForPdf.assureur,
          depotReference: infoForPdf.depot_reference,
          responsable: infoForPdf.responsable,
          documentTypes: rawDocTypes.map((d) => ({ typeDocument: d.type_document, nombre: d.nombre })),
        },
        generatedByEmail: req.user.email,
        generatedAt: changedAt,
        comment: data.comment ?? null,
      });
      attachmentUrl = pdfResult.publicUrl;
    }

    // Restart workflow after client modifications:
    // RECU_DU_CLIENT -> RECUPERE_BO
    if (from === BordereauStatus.RECU_DU_CLIENT && to === BordereauStatus.RECUPERE_BO) {
      // Reset displayed reference back to the stable base reference (avoid accumulating scanner suffixes)
      const baseRef = (b.base_reference || b.reference || '').trim();
      if (baseRef) {
        await b.update({ reference: baseRef, updated_at: changedAt }, { transaction: t });
      }

      // Clear deposit info so the new cycle starts cleanly
      const info0 = await BordereauDepositInfo.findOne({ where: { bordereau_id: id }, transaction: t, lock: t.LOCK.UPDATE });
      if (info0) {
        await BordereauDepositDocumentType.destroy({ where: { deposit_info_id: info0.id }, transaction: t });
        await BordereauDepositInfo.destroy({ where: { id: info0.id }, transaction: t });
      }
    }

    await b.update({ current_status: to, updated_at: changedAt }, { transaction: t });

    const effectiveRole = effectiveRoleForHistory(userRoles, actorRole);

    await BordereauStatusHistory.create({
      bordereau_id: id,
      from_status: from,
      to_status: to,
      changed_by_user_id: req.user.id,
      changed_by_role: effectiveRole,
      changed_at: changedAt,
      comment: data.comment ?? null,
      attachment_url: attachmentUrl,
    }, { transaction: t });

    // If this is the DEPOSE_SCAN transition on a parent, create sub-bordereaux (one per document type)
    if (!b.parent_id && to === BordereauStatus.DEPOSE_SCAN) {
      await ensureSubBordereauxTx(t, b, req.user.id, effectiveRole, changedAt);
    }

    // If this is a sub-bordereau, keep parent status in sync
    if (b.parent_id) {
      await syncParentStatusTx(t, Number(b.parent_id), req.user.id, effectiveRole, changedAt, `Synchronisation automatique (sous-bordereau: ${b.reference})`);
    }

    return b;
  });

  const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: id } });
  const docs = info ? await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: info.id } }) : [];
  const finaliseMap = await getLatestFinaliseEvents([id]);
  const receiptMap = await getLatestReceiptEvents([id]);

  // realtime toast notification
  try {
    emitBordereauStatusChanged({
      bordereauId: id,
      reference: b.reference,
      clientId: b.client_id ?? null,
      clientName: (b.client ? b.client.name : b.client_name) ?? null,
      fromStatus: from,
      toStatus: to,
      changedByUserId: req.user.id,
      changedByEmail: req.user.email,
      changedAt: changedAt.toISOString(),
    });
  } catch {
    // ignore socket errors (API response should still succeed)
  }

  res.json(bordereauDto(updated, info, docs, finaliseMap.get(id), receiptMap.get(id), { isResponsableClientProdFlow: isResponsableClientProdFlowForType(resolveEffectiveDocumentTypeFromData(updated, docs), responsableProdAllowedTypes) }));
});

router.post('/:id/rollback-last', async (req, res) => {
  const id = Number(req.params.id);
  const b = await Bordereau.findByPk(id);
  const hasChildren = (await Bordereau.count({ where: { parent_id: id } })) > 0;
  if (!b) return res.status(404).json({ message: 'Bordereau not found' });
  if (!userHasRole(req, RoleName.ADMIN) && userHasResponsableClientLikeRole(req)) {
    const ok = await canResponsableLikeAccessBordereau(req.user, b);
    if (!ok) return res.status(404).json({ message: 'Bordereau not found' });
  }

  const last = await BordereauStatusHistory.findOne({
    where: { bordereau_id: id },
    order: [['changed_at','DESC'], ['id','DESC']],
  });
  if (!last) return res.status(400).json({ message: 'No history to rollback' });
  if (!last.from_status) return res.status(400).json({ message: 'Cannot rollback initial state' });

  if (Number(last.changed_by_user_id) !== Number(req.user.id)) return res.status(403).json({ message: 'Only the actor who made the last change can rollback' });

  const now = Date.now();
  const changedAtMs = new Date(last.changed_at).getTime();
  if (changedAtMs < now - 60_000) return res.status(403).json({ message: 'Rollback window expired' });

  const actorRole = effectiveRoleForRollback(req.user.roles);
  if (actorRole !== last.changed_by_role) return res.status(403).json({ message: 'Role not allowed to rollback this change' });

  if (!b.parent_id && hasChildren) {
    // Only allow rollback of the split step (RECUPERE_BO -> DEPOSE_SCAN) within the normal rollback window.
    if (!(last && last.to_status === BordereauStatus.DEPOSE_SCAN && last.from_status === BordereauStatus.RECUPERE_BO)) {
      return res.status(400).json({ message: 'Rollback impossible sur un bordereau mère (géré par sous-bordereaux).' });
    }
  }

  const from = b.current_status;
  const to = last.from_status;

  const changedAt = new Date();

  const updated = await sequelize.transaction(async (t) => {
    // If we are rolling back the split step on a parent, delete created sub-bordereaux + related data
    if (!b.parent_id && hasChildren && last.to_status === BordereauStatus.DEPOSE_SCAN && last.from_status === BordereauStatus.RECUPERE_BO) {
      const kids = await Bordereau.findAll({ where: { parent_id: id }, transaction: t, lock: t.LOCK.UPDATE });
      const kidIds = kids.map(k => Number(k.id));

      if (kidIds.length) {
        const kidInfos = await BordereauDepositInfo.findAll({ where: { bordereau_id: { [Op.in]: kidIds } }, transaction: t });
        const kidInfoIds = kidInfos.map(i => Number(i.id));
        if (kidInfoIds.length) {
          await BordereauDepositDocumentType.destroy({ where: { deposit_info_id: { [Op.in]: kidInfoIds } }, transaction: t });
        }
        await BordereauDepositInfo.destroy({ where: { bordereau_id: { [Op.in]: kidIds } }, transaction: t });
        await BordereauStatusHistory.destroy({ where: { bordereau_id: { [Op.in]: kidIds } }, transaction: t });
        await Bordereau.destroy({ where: { id: { [Op.in]: kidIds } }, transaction: t });
      }

      // Also clear deposit info on the parent (since we're going back before deposit)
      const pInfo = await BordereauDepositInfo.findOne({ where: { bordereau_id: id }, transaction: t });
      if (pInfo) {
        await BordereauDepositDocumentType.destroy({ where: { deposit_info_id: pInfo.id }, transaction: t });
        await BordereauDepositInfo.destroy({ where: { id: pInfo.id }, transaction: t });
      }
    }
    await b.update({ current_status: to, updated_at: changedAt }, { transaction: t });
    await BordereauStatusHistory.create({
      bordereau_id: id,
      from_status: from,
      to_status: to,
      changed_by_user_id: req.user.id,
      changed_by_role: actorRole,
      changed_at: changedAt,
      comment: 'Annulation de la dernière action',
      attachment_url: null,
    }, { transaction: t });

    // Keep parent in sync when rolling back a sub-bordereau
    if (b.parent_id) {
      await syncParentStatusTx(t, Number(b.parent_id), req.user.id, actorRole, changedAt, `Synchronisation automatique (rollback sous-bordereau: ${b.reference})`);
    }

    return b;
  });

  const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: id } });
  const docs = info ? await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: info.id } }) : [];
  const finaliseMap = await getLatestFinaliseEvents([id]);
  const receiptMap = await getLatestReceiptEvents([id]);

  try {
    emitBordereauStatusChanged({
      bordereauId: id,
      reference: b.reference,
      clientId: b.client_id ?? null,
      clientName: null,
      fromStatus: from,
      toStatus: to,
      changedByUserId: req.user.id,
      changedByEmail: req.user.email,
      changedAt: changedAt.toISOString(),
    });
  } catch {
    // ignore
  }

  {
  const responsableProdAllowedTypes = await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT_PROD);
  res.json(bordereauDto(updated, info, docs, finaliseMap.get(id), receiptMap.get(id), { isResponsableClientProdFlow: isResponsableClientProdFlowForType(resolveEffectiveDocumentTypeFromData(updated, docs), responsableProdAllowedTypes) }));
}
});

router.post('/:id/prioritize', async (req, res) => {
  if (!req.user.roles.includes(RoleName.ADMIN)) return res.status(403).json({ message: 'Forbidden' });

  const id = Number(req.params.id);
  const b = await Bordereau.findByPk(id);
  const hasChildren = (await Bordereau.count({ where: { parent_id: id } })) > 0;
  if (!b) return res.status(404).json({ message: 'Bordereau not found' });
  if (!userHasRole(req, RoleName.ADMIN) && userHasResponsableClientLikeRole(req)) {
    const ok = await canResponsableLikeAccessBordereau(req.user, b);
    if (!ok) return res.status(404).json({ message: 'Bordereau not found' });
  }

  const { priority, priorityRank } = req.body || {};
  const p = !!priority;

  let rank = null;
  if (p) {
    if (priorityRank == null || priorityRank === '') {
      return res.status(400).json({ message: 'priorityRank is required when priority=true' });
    }
    const n = Number(priorityRank);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      return res.status(400).json({ message: 'priorityRank must be an integer >= 1' });
    }
    rank = n;
  }

  await b.update({ priority: p, priority_rank: rank, updated_at: new Date() });

  const full = await Bordereau.findByPk(id, { include: [{ model: Client, as: 'client', required: false }] });
  const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: id } });
  const docs = info ? await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: info.id } }) : [];
  const finaliseMap = await getLatestFinaliseEvents([id]);
  const receiptMap = await getLatestReceiptEvents([id]);
  const responsableProdAllowedTypes = await getAllowedDocumentTypesForRole(RoleName.RESPONSABLE_CLIENT_PROD);
  res.json(bordereauDto(full, info, docs, finaliseMap.get(id), receiptMap.get(id), { isResponsableClientProdFlow: isResponsableClientProdFlowForType(resolveEffectiveDocumentTypeFromData(full, docs), responsableProdAllowedTypes) }));
});

router.post('/:id/undo-requests', async (req, res) => {
  const id = Number(req.params.id);
  const { targetHistoryId, reason } = req.body || {};
  if (!targetHistoryId) return res.status(400).json({ message: 'targetHistoryId is required' });

  const b = await Bordereau.findByPk(id);
  const hasChildren = (await Bordereau.count({ where: { parent_id: id } })) > 0;
  if (!b) return res.status(404).json({ message: 'Bordereau not found' });
  if (!userHasRole(req, RoleName.ADMIN) && userHasResponsableClientLikeRole(req)) {
    const ok = await canResponsableLikeAccessBordereau(req.user, b);
    if (!ok) return res.status(404).json({ message: 'Bordereau not found' });
  }

  const target = await BordereauStatusHistory.findByPk(targetHistoryId);
  if (!target) return res.status(404).json({ message: 'History event not found' });
  if (Number(target.bordereau_id) !== id) return res.status(400).json({ message: 'History event does not belong to this bordereau' });
  if (Number(target.changed_by_user_id) !== Number(req.user.id)) return res.status(403).json({ message: 'You can only request undo for your own last action' });
  if (!target.from_status) return res.status(400).json({ message: 'Cannot undo initial creation' });

  const latest = await BordereauStatusHistory.findOne({ where: { bordereau_id: id }, order: [['changed_at','DESC'], ['id','DESC']] });
  if (!latest || Number(latest.id) !== Number(targetHistoryId)) return res.status(409).json({ message: 'Undo not allowed: bordereau has been updated after this action' });

  // block legacy pending
  const pending = await UndoRequest.findOne({ where: { bordereau_id: id, status: UndoRequestStatus.PENDING }, order: [['requested_at','DESC'], ['id','DESC']] });
  if (pending) return res.status(409).json({ message: 'An undo request is already pending for this bordereau' });

  const actorRoles = req.user.roles;
  const effectiveRole = actorRoles.includes(RoleName.COORDINATEUR)
    ? RoleName.COORDINATEUR
    : (actorRoles.includes(RoleName.ADMIN) ? (actorRoles.find(r => r !== RoleName.ADMIN) || RoleName.ADMIN) : actorRoles[0]);

  const from = b.current_status;
  const to = target.from_status;

  const changedAt = new Date();

  const undoReq = await sequelize.transaction(async (t) => {
    const createdReq = await UndoRequest.create({
      bordereau_id: id,
      target_history_id: targetHistoryId,
      requested_by_user_id: req.user.id,
      reason: reason ?? null,
      status: UndoRequestStatus.PENDING,
      requested_at: new Date(),
    }, { transaction: t });

    await b.update({ current_status: to, updated_at: changedAt }, { transaction: t });

    await BordereauStatusHistory.create({
      bordereau_id: id,
      from_status: from,
      to_status: to,
      changed_by_user_id: req.user.id,
      changed_by_role: effectiveRole,
      changed_at: changedAt,
      comment: `UNDO exécuté automatiquement (demande #${createdReq.id})`,
      attachment_url: null,
    }, { transaction: t });

    await createdReq.update({ status: UndoRequestStatus.APPROVED, decided_at: new Date(), decided_by_admin_user_id: null }, { transaction: t });
    return createdReq;
  });

  try {
    emitBordereauStatusChanged({
      bordereauId: id,
      reference: b.reference,
      clientId: b.client_id ?? null,
      clientName: null,
      fromStatus: from,
      toStatus: to,
      changedByUserId: req.user.id,
      changedByEmail: req.user.email,
      changedAt: changedAt.toISOString(),
    });
  } catch {
    // ignore
  }

  res.json({
    id: undoReq.id,
    bordereauId: id,
    targetHistoryId: Number(targetHistoryId),
    requestedByEmail: req.user.email,
    reason: undoReq.reason ?? null,
    status: undoReq.status,
    requestedAt: undoReq.requested_at,
    decidedByEmail: null,
    decidedAt: undoReq.decided_at,
  });
});

module.exports = router;
