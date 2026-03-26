const express = require('express');
const { Op } = require('sequelize');
const { Bordereau, BordereauChatMessage, Client, User, RoleAllowedDocumentType, BordereauDepositInfo, BordereauDepositDocumentType } = require('../models');
const { RoleName } = require('../utils/constants');
const { hasResponsableClientLikeRole } = require('../utils/helpers');

const router = express.Router();

function safeParseMentions(raw) {
  if (!raw) return [];
  try {
    const obj = JSON.parse(String(raw));
    const ids = obj?.mentionUserIds;
    if (!Array.isArray(ids)) return [];
    return ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  } catch {
    return [];
  }
}

async function resolveBordereauDocumentType(bordereau) {
  if (!bordereau) return '';
  const direct = String(bordereau.document_type || '').trim();
  if (direct) return direct;

  const bordereauId = Number(bordereau.id || 0);
  if (!bordereauId) return '';

  const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: bordereauId } });
  const legacy = String(info?.type_document || '').trim();
  if (legacy && legacy !== 'MULTI') return legacy;

  if (!info) return '';
  const docs = await BordereauDepositDocumentType.findAll({ where: { deposit_info_id: info.id }, order: [['id', 'ASC']] });
  const unique = Array.from(new Set((docs || []).map((row) => String(row.type_document || '').trim()).filter(Boolean)));
  return unique.length === 1 ? unique[0] : '';
}

function toDto(m) {
  return {
    id: Number(m.id),
    bordereauId: Number(m.bordereau_id),
    senderId: Number(m.sender_id),
    content: m.content ?? '',
    type: m.type,
    mediaUrl: m.media_url ?? null,
    mimeType: m.mime_type ?? null,
    fileName: m.file_name ?? null,
    fileSize: m.file_size ?? null,
    durationMs: m.duration_ms ?? null,
    sentAt: new Date(m.sent_at).toISOString(),
    pinnedAt: m.pinned_at ? new Date(m.pinned_at).toISOString() : null,
    pinnedByUserId: m.pinned_by_user_id != null ? Number(m.pinned_by_user_id) : null,
    mentions: safeParseMentions(m.mentions_json),
  };
}

async function assertCanAccess(req, bordereauId) {
  const b = await Bordereau.findByPk(Number(bordereauId));
  if (!b) {
    const err = new Error('Bordereau not found');
    err.status = 404;
    throw err;
  }

  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdmin = roles.includes(RoleName.ADMIN);
  const isResp = hasResponsableClientLikeRole(roles);
  const isRespProd = roles.includes(RoleName.RESPONSABLE_CLIENT_PROD);

  if (!isAdmin && isResp) {
    const cid = b.client_id != null ? Number(b.client_id) : null;
    if (!cid) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }

    const ok = await Client.findOne({
      where: { id: cid },
      include: [{ model: User, as: 'responsables', required: true, where: { id: req.user.id }, through: { attributes: [] } }],
    });

    if (!ok) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }

    const effectiveDocumentType = await resolveBordereauDocumentType(b);

    if (isRespProd) {
      const allowedRows = await RoleAllowedDocumentType.findAll({ where: { role_name: RoleName.RESPONSABLE_CLIENT_PROD } });
      const allowed = allowedRows.map((r) => String(r.type_document || '').trim()).filter(Boolean);
      if (!allowed.length || !effectiveDocumentType || !allowed.includes(effectiveDocumentType)) {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }
    } else if (roles.includes(RoleName.RESPONSABLE_CLIENT)) {
      const allowedRows = await RoleAllowedDocumentType.findAll({ where: { role_name: RoleName.RESPONSABLE_CLIENT } });
      const allowed = allowedRows.map((r) => String(r.type_document || '').trim()).filter(Boolean);
      if (allowed.length && (!effectiveDocumentType || !allowed.includes(effectiveDocumentType))) {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }
    }
  }

  return b;
}

// GET /api/bordereaux/:id/chat/history
router.get('/:id/chat/history', async (req, res) => {
  const id = Number(req.params.id);
  await assertCanAccess(req, id);

  const rows = await BordereauChatMessage.findAll({
    where: { bordereau_id: id },
    order: [['sent_at', 'ASC'], ['id', 'ASC']],
  });

  res.json((rows || []).map(toDto));
});

// GET /api/bordereaux/:id/chat/pins
router.get('/:id/chat/pins', async (req, res) => {
  const id = Number(req.params.id);
  await assertCanAccess(req, id);

  const rows = await BordereauChatMessage.findAll({
    where: {
      bordereau_id: id,
      pinned_at: { [Op.not]: null },
    },
    order: [['pinned_at', 'DESC'], ['id', 'DESC']],
    limit: 50,
  });

  res.json((rows || []).map(toDto));
});

module.exports = router;
