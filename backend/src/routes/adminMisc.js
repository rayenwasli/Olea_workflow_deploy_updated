const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  User, Role, Bordereau, BordereauStatusHistory, BordereauDepositInfo, BordereauDepositDocumentType, UndoRequest, sequelize
} = require('../models');
const { RoleName } = require('../utils/constants');

const router = express.Router();

const uploadDir = process.env.BORDEREAU_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'bordereaux');
let uploadUrlPrefix = process.env.BORDEREAU_UPLOAD_URL_PREFIX || '/uploads/bordereaux/';
if (!uploadUrlPrefix.endsWith('/')) uploadUrlPrefix += '/';

router.post('/scanners', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || String(email).trim() === '' || !password || String(password).length < 8) {
    return res.status(400).json({ message: 'Email required and password must be at least 8 chars' });
  }

  const em = String(email).toLowerCase().trim();
  const exists = await User.findOne({ where: { email: em } });
  if (exists) return res.status(409).json({ message: 'Email already exists' });

  const scannerRole = await Role.findOne({ where: { name: RoleName.SCANNER } });
  if (!scannerRole) return res.status(500).json({ message: 'SCANNER role missing' });

  const u = await User.create({
    email: em,
    password_hash: await bcrypt.hash(String(password), 10),
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await u.setRoles([scannerRole]);

  res.status(200).json({ message: 'created' });
});

router.delete('/bordereaux/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = await Bordereau.findByPk(id);
  if (!b) return res.status(404).json({ message: 'Bordereau not found' });

  // best-effort delete attachments from disk
  try {
    const events = await BordereauStatusHistory.findAll({ where: { bordereau_id: id } });
    for (const h of events) {
      const url = h.attachment_url;
      if (!url || !String(url).startsWith(uploadUrlPrefix)) continue;
      const fileName = String(url).substring(uploadUrlPrefix.length);
      const p = path.join(uploadDir, fileName);
      try { fs.unlinkSync(p); } catch (_) {}
    }
  } catch (_) {}

  await sequelize.transaction(async (t) => {
    await UndoRequest.destroy({ where: { bordereau_id: id }, transaction: t });

    const info = await BordereauDepositInfo.findOne({ where: { bordereau_id: id }, transaction: t });
    if (info) {
      await BordereauDepositDocumentType.destroy({ where: { deposit_info_id: info.id }, transaction: t });
      await info.destroy({ transaction: t });
    }

    await BordereauStatusHistory.destroy({ where: { bordereau_id: id }, transaction: t });
    await b.destroy({ transaction: t });
  });

  res.status(204).send();
});

module.exports = router;
