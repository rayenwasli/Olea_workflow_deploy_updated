const express = require('express');
const { Op } = require('sequelize');
const { Client } = require('../models');
const { parsePaging, shouldPaginate, pageResponse } = require('../utils/pagination');

const router = express.Router();

function toDto(c) {
  return { id: c.id, name: c.name };
}

router.get('/', async (req, res) => {
  const paginate = shouldPaginate(req.query);

  const q = String(req.query.q || '').trim();
  const where = {};
  if (q) {
    const or = [{ name: { [Op.like]: `%${q}%` } }];
    const n = Number(q);
    if (Number.isFinite(n) && String(n) === q) or.push({ id: n });
    where[Op.or] = or;
  }

  if (!paginate) {
    const clients = await Client.findAll({ where, order: [['name','ASC']] });
    return res.json(clients.map(toDto));
  }

  const { page, size, limit, offset } = parsePaging(req.query, { defaultSize: 25, maxSize: 200 });

  const result = await Client.findAndCountAll({
    where,
    order: [['name','ASC']],
    limit,
    offset,
  });

  const total = typeof result.count === 'number' ? result.count : (Array.isArray(result.count) ? result.count.length : Number(result.count || 0));

  return res.json(pageResponse({ items: result.rows.map(toDto), page, size, total }));
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'name is required' });

  const exists = await Client.findOne({ where: { name: { [Op.eq]: name } } });
  if (exists) return res.status(409).json({ message: 'Client already exists' });

  const c = await Client.create({ name, created_at: new Date(), updated_at: new Date() });
  res.status(201).json(toDto(c));
});

router.put('/:id', async (req, res) => {
  const c = await Client.findByPk(req.params.id);
  if (!c) return res.status(404).json({ message: 'Client not found' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'name is required' });

  const other = await Client.findOne({ where: { name, id: { [Op.ne]: c.id } } });
  if (other) return res.status(409).json({ message: 'Client already exists' });

  await c.update({ name, updated_at: new Date() });
  res.json(toDto(c));
});

router.delete('/:id', async (req, res) => {
  const c = await Client.findByPk(req.params.id);
  if (!c) return res.status(404).json({ message: 'Client not found' });
  await c.destroy();
  res.status(204).send();
});

module.exports = router;
