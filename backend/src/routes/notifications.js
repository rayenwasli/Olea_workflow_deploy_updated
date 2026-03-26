const express = require('express');
const { Op } = require('sequelize');
const { Notification } = require('../models');
const { parsePaging, shouldPaginate, pageResponse } = require('../utils/pagination');

const router = express.Router();

function toDto(n) {
  return {
    // expose stable key to the client
    id: n.event_key,
    kind: (n.kind || 'SYSTEM').toLowerCase(),
    title: n.title,
    message: n.message || null,
    href: n.href || null,
    read: !!n.read,
    createdAt: new Date(n.created_at).getTime(),
  };
}

// GET /api/notifications?unreadOnly=true&limit=50
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const unreadOnly = String(req.query.unreadOnly || 'false').toLowerCase() === 'true';

  // Optional filters (used by /notifications page)
  const q = String(req.query.q || '').trim();
  const kindRaw = String(req.query.kind || '').trim().toLowerCase();
  const readRaw = req.query.read != null ? String(req.query.read).toLowerCase() : '';

  const where = { user_id: userId };

  if (unreadOnly) where.read = false;
  if (readRaw === 'true' || readRaw === 'false') where.read = readRaw === 'true';

  if (kindRaw) {
    const upper = kindRaw.toUpperCase();
    if (['CHAT', 'BORDEREAU', 'SYSTEM'].includes(upper)) {
      where.kind = upper;
    }
  }

  if (q) {
    where[Op.or] = [
      { title: { [Op.like]: `%${q}%` } },
      { message: { [Op.like]: `%${q}%` } },
    ];
  }

  // Paginated mode: /api/notifications?page=1&size=25 (or paginate=1)
  if (shouldPaginate(req.query)) {
    const { page, size, limit, offset } = parsePaging(req.query, { defaultSize: 25, maxSize: 200 });
    const result = await Notification.findAndCountAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
    });

    return res.json(
      pageResponse({
        items: (result.rows || []).map(toDto),
        page,
        size,
        total: result.count || 0,
      })
    );
  }

  // Backward compatible "latest N" mode
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const rows = await Notification.findAll({
    where,
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit,
  });

  return res.json(rows.map(toDto));
});

// PATCH /api/notifications/:id/read   (id = event_key)
router.patch('/:id/read', async (req, res) => {
  const userId = req.user.id;
  const key = String(req.params.id);
  await Notification.update(
    { read: true },
    { where: { user_id: userId, event_key: key } }
  );
  res.json({ ok: true });
});

// PATCH /api/notifications/read-all
router.patch('/read-all', async (req, res) => {
  const userId = req.user.id;
  await Notification.update(
    { read: true },
    { where: { user_id: userId, read: { [Op.not]: true } } }
  );
  res.json({ ok: true });
});

// DELETE /api/notifications
router.delete('/', async (req, res) => {
  const userId = req.user.id;
  await Notification.destroy({ where: { user_id: userId } });
  res.json({ ok: true });
});

module.exports = router;
