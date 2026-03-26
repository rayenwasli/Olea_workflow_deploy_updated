const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { ChatMessage, User, Role } = require('../models');
const { ChatMessageType } = require('../utils/constants');
const { conversationKey, toMsgDto } = require('../utils/chatUtils');
const { getPresenceSnapshot } = require('../socket');

const router = express.Router();

const uploadDir = process.env.CHAT_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'chat');
let uploadUrlPrefix = process.env.CHAT_UPLOAD_URL_PREFIX || '/uploads/chat/';
if (!uploadUrlPrefix.endsWith('/')) uploadUrlPrefix += '/';

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const safeExt = ext && ext.length <= 10 ? ext.replace(/[^a-zA-Z0-9.]/g, '') : '';
    cb(null, `${uuidv4()}${safeExt}`);
  },
});
const upload = multer({ storage });

function fixMojibakeFilename(name) {
  if (!name) return name;
  const s = String(name);
  // Common patterns when a UTF-8 filename is interpreted as latin1 (multer/busboy default).
  const looksBad = /Ã.|Â.|â€|â€™|â€œ|â€�/.test(s);
  if (!looksBad) return s;
  try {
    const decoded = Buffer.from(s, 'latin1').toString('utf8');
    // If decoding produced replacement chars, keep original.
    if (decoded.includes('�')) return s;
    return decoded;
  } catch {
    return s;
  }
}


router.get('/me', async (req, res) => {
  const user = await User.findByPk(req.user.id, { include: [{ model: Role }] });
  res.json({ id: user.id, email: user.email, roles: (user.roles || []).map(r => r.name) });
});

router.get('/users', async (req, res) => {
  const users = await User.findAll({ include: [{ model: Role }], order: [['email','ASC']] });
  const out = users
    .filter(u => Number(u.id) !== Number(req.user.id))
    .map(u => ({ id: u.id, email: u.email, roles: (u.roles || []).map(r => r.name) }));
  res.json(out);
});

// Sidebar summary: users + unread count + last message + presence
router.get('/sidebar', async (req, res) => {
  const meId = Number(req.user.id);
  const users = await User.findAll({ include: [{ model: Role }], order: [['email','ASC']] });
  const others = (users || []).filter(u => Number(u.id) !== meId);

  const { onlineUserIds, lastSeenById } = getPresenceSnapshot();

  // Unread counts grouped by sender
  const unreadRows = await ChatMessage.findAll({
    attributes: ['sender_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'cnt']],
    where: { recipient_id: meId, seen_at: { [Op.is]: null } },
    group: ['sender_id'],
  });
  const unreadBySender = new Map();
  for (const r of unreadRows || []) unreadBySender.set(Number(r.get('sender_id')), Number(r.get('cnt')) || 0);

  // Last message per conversation
  const keys = others.map(u => conversationKey(meId, u.id));
  const lastByKey = new Map();
  if (keys.length) {
    const all = await ChatMessage.findAll({ where: { conversation_key: { [Op.in]: keys } }, order: [['sent_at','DESC'], ['id','DESC']] });
    for (const m of all || []) {
      if (!lastByKey.has(m.conversation_key)) lastByKey.set(m.conversation_key, m);
    }
  }

  const out = others.map(u => {
    const key = conversationKey(meId, u.id);
    const last = lastByKey.get(key) || null;
    return {
      id: u.id,
      email: u.email,
      roles: (u.roles || []).map(r => r.name),
      unreadCount: unreadBySender.get(Number(u.id)) || 0,
      lastMessage: last ? toMsgDto(last) : null,
      online: onlineUserIds.has(Number(u.id)),
      lastSeenAt: lastSeenById.get(Number(u.id)) || null,
    };
  });

  res.json(out);
});


router.get('/history/:otherUserId', async (req, res) => {
  const other = Number(req.params.otherUserId);
  const otherUser = await User.findByPk(other);
  if (!otherUser) return res.status(404).json({ message: 'User not found' });

  const key = conversationKey(req.user.id, other);
  const messages = await ChatMessage.findAll({ where: { conversation_key: key }, order: [['sent_at','ASC'], ['id','ASC']] });
  res.json(messages.map(toMsgDto));
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'file is required' });

  const url = uploadUrlPrefix + req.file.filename;
  res.json({
    url,
    originalName: fixMojibakeFilename(req.file.originalname),
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
});

module.exports = { chatRouter: router };
