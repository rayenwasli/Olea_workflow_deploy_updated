const express = require('express');
const { Op } = require('sequelize');
const { Assureur } = require('../models');
const { parsePaging, shouldPaginate, pageResponse } = require('../utils/pagination');

const router = express.Router();

function toDto(a) {
  return { id: a.id, name: a.name, enabled: !!a.enabled };
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

  const enabledRaw = String(req.query.enabled || '').trim();
  if (enabledRaw === 'true') where.enabled = true;
  if (enabledRaw === 'false') where.enabled = false;

  if (!paginate) {
    const items = await Assureur.findAll({ where, order: [['name', 'ASC']] });
    return res.json(items.map(toDto));
  }

  const { page, size, limit, offset } = parsePaging(req.query, { defaultSize: 25, maxSize: 200 });

  const result = await Assureur.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    limit,
    offset,
  });

  const total = typeof result.count === 'number' ? result.count : (Array.isArray(result.count) ? result.count.length : Number(result.count || 0));

  return res.json(pageResponse({ items: result.rows.map(toDto), page, size, total }));
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'name is required' });

  const exists = await Assureur.findOne({ where: { name: { [Op.eq]: name } } });
  if (exists) return res.status(409).json({ message: 'Assureur already exists' });

  const a = await Assureur.create({ name, enabled: true, created_at: new Date(), updated_at: new Date() });
  res.status(201).json(toDto(a));
});

router.put('/:id', async (req, res) => {
  const a = await Assureur.findByPk(req.params.id);
  if (!a) return res.status(404).json({ message: 'Assureur not found' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'name is required' });

  const enabled = req.body?.enabled;
  const enabledVal = typeof enabled === 'boolean' ? enabled : a.enabled;

  const other = await Assureur.findOne({ where: { name, id: { [Op.ne]: a.id } } });
  if (other) return res.status(409).json({ message: 'Assureur already exists' });

  await a.update({ name, enabled: enabledVal, updated_at: new Date() });
  res.json(toDto(a));
});

router.delete('/:id', async (req, res) => {
  const a = await Assureur.findByPk(req.params.id);
  if (!a) return res.status(404).json({ message: 'Assureur not found' });
  await a.destroy();
  res.status(204).send();
});

module.exports = router;
