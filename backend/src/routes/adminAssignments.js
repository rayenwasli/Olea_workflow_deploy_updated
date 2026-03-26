const express = require('express');
const { Op } = require('sequelize');
const { Client, User, Role, ClientResponsable } = require('../models');
const { RoleName } = require('../utils/constants');
const { parsePaging, shouldPaginate, pageResponse } = require('../utils/pagination');

const router = express.Router();

function responsableDto(u) {
  return { id: u.id, email: u.email };
}

router.get('/clients', async (req, res) => {
  const paginate = shouldPaginate(req.query);

  const q = String(req.query.q || '').trim();
  const responsableIdRaw = req.query.responsableId;
  const responsableId = responsableIdRaw == null || String(responsableIdRaw).trim() === ''
    ? null
    : Number(responsableIdRaw);

  const where = {};
  if (q) where.name = { [Op.like]: `%${q}%` };

  if (responsableId != null && Number.isFinite(responsableId)) {
    const links = await ClientResponsable.findAll({ where: { user_id: responsableId }, attributes: ['client_id'] });
    const ids = links.map(l => Number(l.client_id)).filter(Boolean);
    if (!ids.length) {
      if (!paginate) return res.json([]);
      const { page, size } = parsePaging(req.query, { defaultSize: 25, maxSize: 200 });
      return res.json(pageResponse({ items: [], page, size, total: 0 }));
    }
    where.id = { [Op.in]: ids };
  }

  const { page, size, limit, offset } = paginate
    ? parsePaging(req.query, { defaultSize: 25, maxSize: 200 })
    : { page: 1, size: 1000000, limit: null, offset: null };

  const opts = {
    where,
    include: [{ model: User, as: 'responsables', through: { attributes: [] }, required: false }],
    order: [['name','ASC']],
    distinct: true,
  };

  let rows = [];
  let total = 0;

  if (!paginate) {
    const clients = await Client.findAll(opts);
    rows = clients;
    total = clients.length;
    const out = rows.map(c => ({
      id: c.id,
      name: c.name,
      responsables: (c.responsables || [])
        .filter(u => u.enabled)
        .map(responsableDto)
        .sort((a,b) => a.email.localeCompare(b.email)),
    }));
    return res.json(out);
  }

  const result = await Client.findAndCountAll({ ...opts, limit, offset });

  rows = result.rows;
  total = typeof result.count === 'number' ? result.count : (Array.isArray(result.count) ? result.count.length : Number(result.count || 0));

  const items = rows.map(c => ({
    id: c.id,
    name: c.name,
    responsables: (c.responsables || [])
      .filter(u => u.enabled)
      .map(responsableDto)
      .sort((a,b) => a.email.localeCompare(b.email)),
  }));

  return res.json(pageResponse({ items, page, size, total }));
});

router.get('/responsables', async (_req, res) => {
  const users = await User.findAll({
    include: [{ model: Role, where: { name: { [Op.in]: [RoleName.RESPONSABLE_CLIENT, RoleName.RESPONSABLE_CLIENT_PROD] } }, required: true }],
    where: { enabled: true },
    order: [['email','ASC']],
    distinct: true,
  });

  res.json(users.map(responsableDto));
});

router.put('/clients/:clientId', async (req, res) => {
  const clientId = Number(req.params.clientId);
  const ids = Array.isArray(req.body?.responsableIds) ? req.body.responsableIds : [];
  const client = await Client.findByPk(clientId, { include: [{ model: User, as: 'responsables', through: { attributes: [] } }] });
  if (!client) return res.status(404).json({ message: 'Client not found' });

  if (!ids.length) {
    await client.setResponsables([]);
    const c = await Client.findByPk(clientId, { include: [{ model: User, as: 'responsables', through: { attributes: [] } }] });
    return res.json({
      id: c.id,
      name: c.name,
      responsables: (c.responsables || []).map(responsableDto).sort((a,b)=>a.email.localeCompare(b.email)),
    });
  }

  const responsables = await User.findAll({
    where: { id: { [Op.in]: ids }, enabled: true },
    include: [{ model: Role, where: { name: { [Op.in]: [RoleName.RESPONSABLE_CLIENT, RoleName.RESPONSABLE_CLIENT_PROD] } }, required: true }],
    distinct: true,
  });

  await client.setResponsables(responsables);

  const c = await Client.findByPk(clientId, { include: [{ model: User, as: 'responsables', through: { attributes: [] } }] });
  return res.json({
    id: c.id,
    name: c.name,
    responsables: (c.responsables || []).map(responsableDto).sort((a,b)=>a.email.localeCompare(b.email)),
  });
});

module.exports = router;
