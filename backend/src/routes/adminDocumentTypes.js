const express = require('express');
const { DocumentTypeCatalog, RoleAllowedDocumentType, Bordereau, BordereauDepositInfo, BordereauDepositDocumentType } = require('../models');
const { RoleName } = require('../utils/constants');

const router = express.Router();

const MANAGED_ROLES = [RoleName.RESPONSABLE_CLIENT, RoleName.RESPONSABLE_CLIENT_PROD];

function normalizeTypeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parseTypes(list) {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.map(normalizeTypeName).filter(Boolean)));
}

async function syncAssignmentsForRole(roleName, items) {
  if (!MANAGED_ROLES.includes(roleName)) return;
  await RoleAllowedDocumentType.destroy({ where: { role_name: roleName } });
  const rows = parseTypes(items).map((typeDocument) => ({ role_name: roleName, type_document: typeDocument }));
  if (rows.length) await RoleAllowedDocumentType.bulkCreate(rows);
}

router.get('/', async (_req, res) => {
  const types = await DocumentTypeCatalog.findAll({ where: { enabled: true }, order: [['name', 'ASC']] });
  const assignments = await RoleAllowedDocumentType.findAll({ where: { role_name: MANAGED_ROLES }, order: [['role_name', 'ASC'], ['type_document', 'ASC']] });

  const byRole = {};
  for (const roleName of MANAGED_ROLES) byRole[roleName] = [];
  for (const row of assignments) {
    const roleName = String(row.role_name || '').trim();
    if (!MANAGED_ROLES.includes(roleName)) continue;
    byRole[roleName].push(String(row.type_document || '').trim());
  }
  for (const roleName of MANAGED_ROLES) {
    byRole[roleName] = Array.from(new Set((byRole[roleName] || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  res.json({
    managedRoles: MANAGED_ROLES,
    documentTypes: types.map((t) => ({ id: Number(t.id), name: t.name, enabled: !!t.enabled })),
    assignments: byRole,
  });
});

router.post('/', async (req, res) => {
  const name = normalizeTypeName(req.body?.name);
  if (!name) return res.status(400).json({ message: 'Nom requis' });
  const exists = await DocumentTypeCatalog.findOne({ where: { name } });
  if (exists) return res.status(409).json({ message: 'Ce type existe déjà' });
  const created = await DocumentTypeCatalog.create({ name, enabled: true, created_at: new Date(), updated_at: new Date() });
  res.status(201).json({ id: Number(created.id), name: created.name, enabled: !!created.enabled });
});

router.put('/assignments', async (req, res) => {
  const assignments = req.body?.assignments || {};
  const catalogRows = await DocumentTypeCatalog.findAll({ where: { enabled: true } });
  const allowedTypes = new Set(catalogRows.map((r) => String(r.name || '').trim()).filter(Boolean));

  for (const roleName of MANAGED_ROLES) {
    const items = parseTypes(assignments[roleName]).filter((name) => allowedTypes.has(name));
    await syncAssignmentsForRole(roleName, items);
  }

  res.json({ ok: true });
});

router.put('/:id', async (req, res) => {
  const row = await DocumentTypeCatalog.findByPk(req.params.id);
  if (!row) return res.status(404).json({ message: 'Type introuvable' });

  const name = normalizeTypeName(req.body?.name);
  if (!name) return res.status(400).json({ message: 'Nom requis' });

  const existing = await DocumentTypeCatalog.findOne({ where: { name } });
  if (existing && Number(existing.id) !== Number(row.id)) {
    return res.status(409).json({ message: 'Ce type existe déjà' });
  }

  const oldName = String(row.name || '').trim();
  row.name = name;
  row.updated_at = new Date();
  await row.save();

  if (oldName && oldName !== name) {
    await RoleAllowedDocumentType.update({ type_document: name }, { where: { type_document: oldName } });
    await Bordereau.update({ document_type: name }, { where: { document_type: oldName } });
    await BordereauDepositInfo.update({ type_document: name }, { where: { type_document: oldName } });
    await BordereauDepositDocumentType.update({ type_document: name }, { where: { type_document: oldName } });
  }

  res.json({ id: Number(row.id), name: row.name, enabled: !!row.enabled });
});

router.delete('/:id', async (req, res) => {
  const row = await DocumentTypeCatalog.findByPk(req.params.id);
  if (!row) return res.status(404).json({ message: 'Type introuvable' });
  await RoleAllowedDocumentType.destroy({ where: { type_document: row.name } });
  await row.destroy();
  res.status(204).send();
});

router.get('/options/public', async (_req, res) => {
  const rows = await DocumentTypeCatalog.findAll({ where: { enabled: true }, order: [['name', 'ASC']] });
  res.json(rows.map((r) => r.name));
});

module.exports = router;
