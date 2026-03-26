const express = require('express');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Role } = require('../models');
const { RoleName } = require('../utils/constants');
const { parsePaging, shouldPaginate, pageResponse } = require('../utils/pagination');

const router = express.Router();

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function parseRoleNames(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s) continue;
    const v = String(s).trim().toUpperCase();
    if (RoleName[v]) out.push(v);
  }
  // unique
  return Array.from(new Set(out));
}


function toResponse(u) {
  const roles = (u.roles || []).map(r => r.name).sort();
  return { id: u.id, email: u.email, enabled: !!u.enabled, roles };
}

router.get('/', async (req, res) => {
  const paginate = shouldPaginate(req.query);

  const q = String(req.query.q || '').trim();
  const roleFilter = String(req.query.role || '').trim().toUpperCase();
  const enabledRaw = req.query.enabled;
  const enabledFilter = (() => {
    if (enabledRaw == null || String(enabledRaw).trim() === '') return null;
    const v = String(enabledRaw).toLowerCase().trim();
    if (['1','true','yes','y','on'].includes(v)) return true;
    if (['0','false','no','n','off'].includes(v)) return false;
    return null;
  })();

  const where = {};
  if (enabledFilter !== null) where.enabled = enabledFilter;
  if (q) {
    const or = [{ email: { [Op.like]: `%${q.toLowerCase()}%` } }];
    const n = Number(q);
    if (Number.isFinite(n) && String(n) === q) or.push({ id: n });
    where[Op.or] = or;
  }

  const hasRoleFilter = !!roleFilter;

  if (!paginate) {
    if (!hasRoleFilter) {
      const users = await User.findAll({ where, include: [{ model: Role }], order: [['id','ASC']], distinct: true });
      return res.json(users.map(toResponse));
    }

    // If role filter is applied, first fetch matching user ids then hydrate full roles.
    const filtered = await User.findAll({
      where,
      include: [{ model: Role, where: { name: roleFilter }, required: true }],
      order: [['id','ASC']],
      distinct: true,
    });
    const ids = filtered.map(u => u.id);
    if (!ids.length) return res.json([]);
    const hydrated = await User.findAll({ where: { id: { [Op.in]: ids } }, include: [{ model: Role }], order: [['id','ASC']], distinct: true });
    const byId = new Map(hydrated.map(u => [Number(u.id), u]));
    return res.json(ids.map((id) => {
      const u = byId.get(Number(id));
      return u ? toResponse(u) : null;
    }).filter(Boolean));
  }

  const { page, size, limit, offset } = parsePaging(req.query, { defaultSize: 25, maxSize: 200 });

  const result = await User.findAndCountAll({
    where,
    include: hasRoleFilter
      ? [{ model: Role, where: { name: roleFilter }, required: true }]
      : [{ model: Role }],
    order: [['id','ASC']],
    limit,
    offset,
    distinct: true,
  });

  const total = typeof result.count === 'number' ? result.count : (Array.isArray(result.count) ? result.count.length : Number(result.count || 0));

  if (!hasRoleFilter) {
    return res.json(pageResponse({ items: result.rows.map(toResponse), page, size, total }));
  }

  // hydrate roles for this page (so UI still shows all roles, not only the filtered one)
  const pageIds = result.rows.map(u => Number(u.id));
  const hydrated = pageIds.length
    ? await User.findAll({ where: { id: { [Op.in]: pageIds } }, include: [{ model: Role }], distinct: true })
    : [];
  const byId = new Map(hydrated.map(u => [Number(u.id), u]));

  return res.json(pageResponse({
    items: pageIds.map((id) => {
      const u = byId.get(id);
      return u ? toResponse(u) : null;
    }).filter(Boolean),
    page,
    size,
    total,
  }));
});

router.get('/:id', async (req, res) => {
  const u = await User.findByPk(req.params.id, { include: [{ model: Role }] });
  if (!u) return res.status(404).json({ message: 'User not found' });
  res.json(toResponse(u));
});

router.post('/', async (req, res) => {
  const { email, password, enabled, roles } = req.body || {};
  if (!email || String(email).trim() === '') return res.status(400).json({ message: 'Email is required' });
  if (!password || String(password).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

  const em = normalizeEmail(email);
  const exists = await User.findOne({ where: { email: em } });
  if (exists) return res.status(409).json({ message: 'Email already exists' });

  const roleNames = parseRoleNames(roles);
  const finalRoleNames = roleNames.length ? roleNames : [RoleName.RESPONSABLE_CLIENT];

  const roleRows = await Role.findAll({ where: { name: { [Op.in]: finalRoleNames } } });
  if (!roleRows.length) return res.status(500).json({ message: 'Roles missing in DB' });

  const u = await User.create({
    email: em,
    password_hash: await bcrypt.hash(String(password), 10),
    enabled: enabled == null ? true : !!enabled,
    created_at: new Date(),
    updated_at: new Date(),
  });

  await u.setRoles(roleRows);


  const out = await User.findByPk(u.id, { include: [{ model: Role }] });
  res.status(201).json(toResponse(out));
});

router.put('/:id', async (req, res) => {
  const u = await User.findByPk(req.params.id, { include: [{ model: Role }] });
  if (!u) return res.status(404).json({ message: 'User not found' });

  const { email, password, enabled, roles } = req.body || {};

  if (email != null && String(email).trim() !== '') {
    const em = normalizeEmail(email);
    if (em !== u.email) {
      const exists = await User.findOne({ where: { email: em, id: { [Op.ne]: u.id } } });
      if (exists) return res.status(409).json({ message: 'Email already exists' });
    }
    u.email = em;
  }

  if (password != null && String(password).trim() !== '') {
    if (String(password).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    u.password_hash = await bcrypt.hash(String(password), 10);
  }

  if (enabled != null) u.enabled = !!enabled;

  await u.save();

  if (roles != null) {
    const roleNames = parseRoleNames(roles);
    if (!roleNames.length) return res.status(400).json({ message: 'roles must contain at least 1 valid role' });
    const roleRows = await Role.findAll({ where: { name: { [Op.in]: roleNames } } });
    await u.setRoles(roleRows);
  }


  const out = await User.findByPk(u.id, { include: [{ model: Role }] });
  res.json(toResponse(out));
});

router.delete('/:id', async (req, res) => {
  const u = await User.findByPk(req.params.id);
  if (!u) return res.status(404).json({ message: 'User not found' });

  // prevent deleting yourself
  if (req.user && req.user.email && req.user.email.toLowerCase() === u.email.toLowerCase()) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  await u.destroy();
  res.status(204).send();
});

module.exports = router;
