const express = require('express');
const { Op } = require('sequelize');
const { UndoRequest, Bordereau, BordereauStatusHistory, User, sequelize } = require('../models');
const { UndoRequestStatus, RoleName } = require('../utils/constants');
const { parsePaging, shouldPaginate, pageResponse } = require('../utils/pagination');
const { emitBordereauStatusChanged } = require('../socket');

const router = express.Router();

function dto(r) {
  return {
    id: r.id,
    bordereauId: r.bordereau?.id,
    bordereauReference: r.bordereau?.reference,
    targetHistoryId: r.targetHistory?.id,
    requestedByEmail: r.requestedBy?.email,
    status: r.status,
    reason: r.reason ?? null,
    requestedAt: r.requested_at,
    decidedByEmail: r.decidedBy ? r.decidedBy.email : null,
    decidedAt: r.decided_at ?? null,
  };
}

router.get('/', async (req, res) => {
  const status = req.query.status;
  const q = String(req.query.q || '').trim();
  const where = {};
  if (status) where.status = status;
  if (q) {
    const or = [];
    or.push({ reason: { [Op.like]: `%${q}%` } });
    or.push({ '$bordereau.reference$': { [Op.like]: `%${q}%` } });
    or.push({ '$requestedBy.email$': { [Op.like]: `%${q}%` } });
    or.push({ '$decidedBy.email$': { [Op.like]: `%${q}%` } });
    const n = Number(q);
    if (Number.isFinite(n) && String(n) === q) {
      or.push({ id: n });
      or.push({ bordereau_id: n });
      or.push({ target_history_id: n });
    }
    where[Op.or] = or;
  }

  const paginate = shouldPaginate(req.query);

  const baseOpts = {
    where,
    include: [
      { model: Bordereau, as: 'bordereau' },
      { model: BordereauStatusHistory, as: 'targetHistory' },
      { model: User, as: 'requestedBy' },
      { model: User, as: 'decidedBy' },
    ],
    order: [['requested_at','DESC'], ['id','DESC']],
    distinct: true,
    subQuery: false,
  };

  if (!paginate) {
    const rows = await UndoRequest.findAll(baseOpts);
    return res.json(rows.map(dto));
  }

  const { page, size, limit, offset } = parsePaging(req.query, { defaultSize: 25, maxSize: 200 });

  const result = await UndoRequest.findAndCountAll({ ...baseOpts, limit, offset });

  const total = typeof result.count === 'number' ? result.count : (Array.isArray(result.count) ? result.count.length : Number(result.count || 0));

  return res.json(pageResponse({ items: result.rows.map(dto), page, size, total }));
});

router.post('/:id/approve', async (req, res) => {
  const id = Number(req.params.id);

  const reqRow = await UndoRequest.findByPk(id, {
    include: [
      { model: Bordereau, as: 'bordereau' },
      { model: BordereauStatusHistory, as: 'targetHistory' },
    ],
  });
  if (!reqRow) return res.status(404).json({ message: 'Undo request not found' });

  if (reqRow.status !== UndoRequestStatus.PENDING) return res.status(409).json({ message: 'Undo request already processed' });

  const bordereauId = reqRow.bordereau.id;
  const latest = await BordereauStatusHistory.findOne({ where: { bordereau_id: bordereauId }, order: [['changed_at','DESC'], ['id','DESC']] });
  if (!latest || Number(latest.id) !== Number(reqRow.target_history_id)) {
    return res.status(409).json({ message: 'Cannot approve: bordereau has changed since the request' });
  }

  const target = reqRow.targetHistory;
  if (!target.from_status) return res.status(400).json({ message: 'Cannot undo initial state' });

  const b = await Bordereau.findByPk(bordereauId);
  const from = b.current_status;
  const to = target.from_status;

  const changedAt = new Date();

  const adminUserId = req.user.id;

  const updated = await sequelize.transaction(async (t) => {
    await b.update({ current_status: to, updated_at: changedAt }, { transaction: t });

    await BordereauStatusHistory.create({
      bordereau_id: bordereauId,
      from_status: from,
      to_status: to,
      changed_by_user_id: adminUserId,
      changed_by_role: RoleName.ADMIN,
      changed_at: changedAt,
      comment: `UNDO approuvé (demande #${reqRow.id})`,
      attachment_url: null,
    }, { transaction: t });

    await reqRow.update({
      status: UndoRequestStatus.APPROVED,
      decided_by_admin_user_id: adminUserId,
      decided_at: new Date(),
    }, { transaction: t });

    return b;
  });

  try {
    emitBordereauStatusChanged({
      bordereauId,
      reference: updated.reference,
      clientId: updated.client_id ?? null,
      clientName: null,
      fromStatus: from,
      toStatus: to,
      changedByUserId: adminUserId,
      changedByEmail: req.user.email,
      changedAt: changedAt.toISOString(),
    });
  } catch {
    // ignore
  }

  res.json({ id: updated.id, reference: updated.reference, currentStatus: updated.current_status });
});

router.post('/:id/reject', async (req, res) => {
  const id = Number(req.params.id);

  const reqRow = await UndoRequest.findByPk(id, {
    include: [
      { model: Bordereau, as: 'bordereau' },
      { model: BordereauStatusHistory, as: 'targetHistory' },
      { model: User, as: 'requestedBy' },
      { model: User, as: 'decidedBy' },
    ],
  });
  if (!reqRow) return res.status(404).json({ message: 'Undo request not found' });

  if (reqRow.status !== UndoRequestStatus.PENDING) return res.status(409).json({ message: 'Undo request already processed' });

  await reqRow.update({
    status: UndoRequestStatus.REJECTED,
    decided_by_admin_user_id: req.user.id,
    decided_at: new Date(),
  });

  const refreshed = await UndoRequest.findByPk(id, {
    include: [
      { model: Bordereau, as: 'bordereau' },
      { model: BordereauStatusHistory, as: 'targetHistory' },
      { model: User, as: 'requestedBy' },
      { model: User, as: 'decidedBy' },
    ],
  });

  res.json(dto(refreshed));
});

module.exports = router;
