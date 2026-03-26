const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { ChatMessage, BordereauChatMessage, Bordereau, User, Role, Client, ClientResponsable, Notification } = require('./models');
const { ChatMessageType, RoleName, BordereauStatus } = require('./utils/constants');
const { conversationKey, toMsgDto, parseType } = require('./utils/chatUtils');

let ioRef = null;

// Presence (online/offline)
// Map userId -> active socket count
const onlineCounts = new Map();
// Map userId -> lastSeenAt (ms epoch) when they went offline
const lastSeenById = new Map();

function markOnline(userId) {
  const id = Number(userId);
  const prev = onlineCounts.get(id) || 0;
  onlineCounts.set(id, prev + 1);
  return prev === 0;
}

function markOffline(userId) {
  const id = Number(userId);
  const prev = onlineCounts.get(id) || 0;
  const next = Math.max(prev - 1, 0);
  if (next === 0) onlineCounts.delete(id);
  else onlineCounts.set(id, next);
  if (next === 0) lastSeenById.set(id, Date.now());
  return prev > 0 && next === 0;
}

function isUserOnline(userId) {
  return (onlineCounts.get(Number(userId)) || 0) > 0;
}

function getPresenceSnapshot() {
  return {
    onlineUserIds: new Set(Array.from(onlineCounts.keys())),
    lastSeenById,
  };
}



function fixMojibakeText(s) {
  if (s == null) return s;
  const str = String(s);
  const looksBad = /Ã.|Â.|â€|â€™|â€œ|â€�/.test(str);
  if (!looksBad) return str;
  try {
    const decoded = Buffer.from(str, 'latin1').toString('utf8');
    if (decoded.includes('�')) return str;
    return decoded;
  } catch {
    return str;
  }
}



function roomForBordereau(bordereauId) {
  return `bordereau:${Number(bordereauId)}`;
}

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

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

function extractMentionTokens(text) {
  if (!text) return [];
  const s = String(text);
  // Capture @token where token is like "chaima" or "chaima.meziane" (NOT full email, to avoid "@@").
  const re = /(^|[\s\(\[\{"'`])@([a-zA-Z0-9._-]{2,80})/g;
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    const token = String(m[2] || '').trim().toLowerCase();
    if (token && token !== 'all' && token !== 'here') out.push(token);
  }
  return Array.from(new Set(out));
}

function toBordereauChatDto(m) {
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

async function assertBordereauAccessSocket(me, bordereauId) {
  const b = await Bordereau.findByPk(Number(bordereauId));
  if (!b) throw new Error('Bordereau not found');

  const roles = Array.isArray(me?.roles) ? me.roles : [];
  const isAdmin = roles.includes(RoleName.ADMIN);
  const isResp = roles.includes(RoleName.RESPONSABLE_CLIENT);

  if (!isAdmin && isResp) {
    const cid = b.client_id != null ? Number(b.client_id) : null;
    const assigned = Array.isArray(me?.assignedClientIds) ? me.assignedClientIds : [];
    if (!cid || !assigned.includes(cid)) throw new Error('Forbidden');
  }

  return b;
}

function localPart(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  return i > 0 ? s.slice(0, i).toLowerCase() : s.toLowerCase();
}

async function resolveMentionUserIds(tokens, bordereauRow) {
  if (!tokens || tokens.length === 0) return [];

  const all = await User.findAll({
    attributes: ['id', 'email', 'enabled'],
    include: [{ model: Role }],
    order: [['email', 'ASC']],
  });

  const tks = tokens.map((t) => String(t).toLowerCase());
  const hitsByToken = new Map(tks.map((t) => [t, []]));

  for (const u of all || []) {
    if (!u || !u.enabled) continue;
    const email = String(u.email || '').toLowerCase();
    const lp = localPart(email);
    for (const t of tks) {
      if (lp.startsWith(t) || email.startsWith(t)) {
        hitsByToken.get(t).push({ id: Number(u.id), roles: (u.roles || []).map((r) => r.name) });
      }
    }
  }

  const out = new Set();
  const cid = bordereauRow?.client_id != null ? Number(bordereauRow.client_id) : null;

  for (const [t, hits] of hitsByToken.entries()) {
    if (!hits || hits.length !== 1) continue; // only notify when unique match
    const cand = hits[0];
    const roles = Array.isArray(cand.roles) ? cand.roles : [];

    if (roles.includes(RoleName.ADMIN)) {
      out.add(cand.id);
      continue;
    }

    if (roles.includes(RoleName.RESPONSABLE_CLIENT)) {
      if (!cid) continue;
      const cnt = await ClientResponsable.count({ where: { client_id: cid, user_id: cand.id } });
      if (cnt > 0) out.add(cand.id);
      continue;
    }

    // other roles: they can generally access bordereaux
    out.add(cand.id);
  }

  return Array.from(out);
}

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/ws',
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  ioRef = io;

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        null;

      if (!token) return next(new Error('Missing token'));
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
      const email = payload.sub;
      const user = await User.findOne({
        where: { email },
        include: [
          { model: Role },
          { model: Client, as: 'assigned_clients', attributes: ['id'], through: { attributes: [] } },
        ],
      });
      if (!user || !user.enabled) return next(new Error('User not found/disabled'));

      const roles = (user.roles || []).map((r) => r.name);
      const assignedClientIds = (user.assigned_clients || []).map((c) => Number(c.id)).filter(Boolean);

      socket.data.user = { id: user.id, email: user.email, roles, assignedClientIds };
      return next();
    } catch (e) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;

    // Presence
    const becameOnline = markOnline(me.id);
    if (becameOnline && ioRef) {
      ioRef.emit('presence.update', { userId: me.id, online: true, at: new Date().toISOString() });
    }
    socket.join(`user:${me.id}`);

    // Rooms per role
    const roles = Array.isArray(me.roles) ? me.roles : [];
    for (const r of roles) socket.join(`role:${r}`);

    // Rooms per assigned client (useful for RESPONSABLE_CLIENT targeted notifications)
    const clientIds = Array.isArray(me.assignedClientIds) ? me.assignedClientIds : [];
    for (const cid of clientIds) socket.join(`client:${cid}`);

    socket.on('disconnect', () => {
      const wentOffline = markOffline(me.id);
      if (wentOffline && ioRef) {
        ioRef.emit('presence.update', { userId: me.id, online: false, at: new Date().toISOString(), lastSeenAt: lastSeenById.get(Number(me.id)) || null });
      }
    });


    socket.on('chat.send', async (req, cb) => {
      try {
        const recipientId = req?.recipientId;
        if (!recipientId) throw new Error('recipientId is required');

        const type = parseType(req.type);
        // For media messages, content is usually the filename. Fix common encoding issues.
        const content = type === ChatMessageType.TEXT ? (req.content ?? '') : fixMojibakeText(req.content ?? '');
        const mediaUrl = req.mediaUrl ?? null;

        if (type === ChatMessageType.TEXT) {
          if (!String(content).trim()) throw new Error('content is required for TEXT messages');
        } else {
          if (!mediaUrl || !String(mediaUrl).trim()) throw new Error(`mediaUrl is required for ${type} messages`);
        }

        const recipient = await User.findByPk(recipientId);
        if (!recipient) throw new Error('User not found: id=' + recipientId);

        const msg = await ChatMessage.create({
          conversation_key: conversationKey(me.id, recipientId),
          sender_id: me.id,
          recipient_id: Number(recipientId),
          type,
          content: content ?? '',
          media_url: req.mediaUrl ?? null,
          mime_type: req.mimeType ?? null,
          file_name: type === ChatMessageType.TEXT ? (req.fileName ?? null) : fixMojibakeText(req.fileName ?? null),
          file_size: req.fileSize ?? null,
          duration_ms: req.durationMs ?? null,
          sent_at: new Date(),
          delivered_at: null,
          seen_at: null,
        });

        // Mark as delivered if recipient is currently online
        if (isUserOnline(recipientId)) {
          try {
            const deliveredAt = new Date();
            await ChatMessage.update({ delivered_at: deliveredAt }, { where: { id: msg.id, delivered_at: null } });
            msg.delivered_at = deliveredAt;
          } catch {
            // ignore
          }
        }

        const dto = toMsgDto(msg);
        dto.clientMessageId = req.clientMessageId ?? null;

        // Persist notification for recipient (so it appears after reconnect, other device, etc.)
        try {
          const preview = (() => {
            if (dto.type === ChatMessageType.TEXT) {
              const t = String(dto.content || '').trim();
              return t.length > 120 ? t.slice(0, 120) + '…' : t;
            }
            if (dto.type === ChatMessageType.IMAGE) return '📷 Image';
            if (dto.type === ChatMessageType.VOICE) return '🎤 Message vocal';
            const isPdf = String(dto.mimeType || '').toLowerCase() === 'application/pdf' || String(dto.fileName || dto.content || '').toLowerCase().endsWith('.pdf');
            if (isPdf) return '📄 PDF';
            return '📎 Fichier';
          })();

          await Notification.create({
            user_id: Number(recipientId),
            event_key: `chat:${dto.id}`,
            kind: 'CHAT',
            title: `Message · ${me.email}`,
            message: preview,
            href: `/chat?user=${me.id}`,
            read: false,
            created_at: new Date(dto.sentAt || Date.now()),
          });
        } catch {
          // ignore notification persistence errors
        }

        io.to(`user:${recipientId}`).emit('chat.message', dto);
        io.to(`user:${me.id}`).emit('chat.message', dto);

        if (typeof cb === 'function') cb({ ok: true, message: dto });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    // Mark messages as seen (read receipts)
    socket.on('chat.seen', async (req, cb) => {
      try {
        const otherUserId = Number(req?.otherUserId);
        if (!otherUserId) throw new Error('otherUserId is required');
        const lastMessageId = req?.lastMessageId != null ? Number(req.lastMessageId) : null;

        const key = conversationKey(me.id, otherUserId);
        const { Op } = require('sequelize');

        const where = {
          conversation_key: key,
          recipient_id: Number(me.id),
          sender_id: Number(otherUserId),
          seen_at: null,
        };
        if (lastMessageId && Number.isFinite(lastMessageId)) where.id = { [Op.lte]: lastMessageId };

        const seenAt = new Date();
        const [count] = await ChatMessage.update({ seen_at: seenAt }, { where });

        // Mark corresponding chat notifications as read (best-effort)
        try {
          const notifWhere = {
            user_id: Number(me.id),
            kind: 'CHAT',
            read: { [Op.not]: true },
          };
          // If lastMessageId was provided, mark all chat:* notifications up to that id.
          // We store notifications with event_key = chat:<messageId>.
          if (lastMessageId && Number.isFinite(lastMessageId)) {
            // MySQL doesn't support numeric compare inside strings easily; we update by joining message ids.
            // Best effort: mark notifications for this conversation as read by href.
            notifWhere.href = `/chat?user=${otherUserId}`;
          }
          await Notification.update({ read: true }, { where: notifWhere });
        } catch {
          // ignore
        }

        // Inform the sender so they can show "seen"
        if (ioRef) {
          ioRef.to(`user:${otherUserId}`).emit('chat.seen', {
            byUserId: me.id,
            otherUserId: otherUserId,
            lastSeenMessageId: lastMessageId,
            seenAt: seenAt.toISOString(),
          });
        }

        if (typeof cb === 'function') cb({ ok: true, updated: count || 0, seenAt: seenAt.toISOString() });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    // Bordereau chat (threads per bordereau)
    socket.on('bordereau.chat.join', async (req, cb) => {
      try {
        const bordereauId = Number(req?.bordereauId);
        if (!bordereauId) throw new Error('bordereauId is required');

        await assertBordereauAccessSocket(me, bordereauId);
        socket.join(roomForBordereau(bordereauId));

        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('bordereau.chat.leave', async (req, cb) => {
      try {
        const bordereauId = Number(req?.bordereauId);
        if (!bordereauId) throw new Error('bordereauId is required');
        socket.leave(roomForBordereau(bordereauId));
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('bordereau.chat.send', async (req, cb) => {
      try {
        const bordereauId = Number(req?.bordereauId);
        if (!bordereauId) throw new Error('bordereauId is required');

        const b = await assertBordereauAccessSocket(me, bordereauId);

        const type = parseType(req.type);
        const content = type === ChatMessageType.TEXT ? (req.content ?? '') : fixMojibakeText(req.content ?? '');
        const mediaUrl = req.mediaUrl ?? null;

        if (type === ChatMessageType.TEXT) {
          if (!String(content).trim()) throw new Error('content is required for TEXT messages');
        } else {
          if (!mediaUrl || !String(mediaUrl).trim()) throw new Error(`mediaUrl is required for ${type} messages`);
        }

        // Mentions
        let mentionUserIds = [];
        if (type === ChatMessageType.TEXT) {
          const tokens = extractMentionTokens(content);
          if (tokens.length) {
            mentionUserIds = await resolveMentionUserIds(tokens, b);
            mentionUserIds = mentionUserIds.filter((id) => Number(id) !== Number(me.id));
          }
        }

        const msg = await BordereauChatMessage.create({
          bordereau_id: bordereauId,
          sender_id: me.id,
          type,
          content: content ?? '',
          media_url: mediaUrl,
          mime_type: req.mimeType ?? null,
          file_name: req.fileName ?? null,
          file_size: req.fileSize ?? null,
          duration_ms: req.durationMs ?? null,
          sent_at: new Date(),
          pinned_at: null,
          pinned_by_user_id: null,
          mentions_json: mentionUserIds.length ? safeJson({ mentionUserIds }) : null,
        });

        const dto = toBordereauChatDto(msg);
        dto.clientMessageId = req.clientMessageId ?? null;

        // Notify mentioned users (persistent + realtime)
        if (mentionUserIds.length) {
          const preview = (() => {
            const t = String(dto.content || '').trim();
            return t.length > 140 ? t.slice(0, 140) + '…' : t;
          })();

          const createdAt = new Date(dto.sentAt || Date.now());
          const href = `/bordereaux/${bordereauId}#chat`;
          const title = `Mention · Bordereau ${b.reference || ('#' + bordereauId)}`;
          const io = ioRef;

          for (const uid of mentionUserIds) {
            try {
              const eventKey = `mention:bord:${bordereauId}:msg:${dto.id}`;
              await Notification.create({
                user_id: Number(uid),
                event_key: eventKey,
                kind: 'CHAT',
                title,
                message: preview,
                href,
                read: false,
                created_at: createdAt,
              });

              // realtime toast
              if (io) {
                io.to(`user:${uid}`).emit('notification.new', {
                  id: String(eventKey),
                  kind: 'chat',
                  title,
                  message: preview,
                  href,
                  read: false,
                  createdAt: createdAt.getTime(),
                });
              }
            } catch (e) {
              // ignore duplicates / persistence errors
            }
          }
        }

        io.to(roomForBordereau(bordereauId)).emit('bordereau.chat.message', dto);

        if (typeof cb === 'function') cb({ ok: true, message: dto });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('bordereau.chat.pin', async (req, cb) => {
      try {
        const bordereauId = Number(req?.bordereauId);
        const messageId = Number(req?.messageId);
        const pinned = Boolean(req?.pinned);
        if (!bordereauId) throw new Error('bordereauId is required');
        if (!messageId) throw new Error('messageId is required');

        await assertBordereauAccessSocket(me, bordereauId);

        const row = await BordereauChatMessage.findOne({ where: { id: messageId, bordereau_id: bordereauId } });
        if (!row) throw new Error('Message not found');

        const pinnedAt = pinned ? new Date() : null;
        const pinnedBy = pinned ? Number(me.id) : null;

        await BordereauChatMessage.update(
          { pinned_at: pinnedAt, pinned_by_user_id: pinnedBy },
          { where: { id: messageId, bordereau_id: bordereauId } }
        );

        const payload = {
          bordereauId,
          messageId,
          pinnedAt: pinnedAt ? pinnedAt.toISOString() : null,
          pinnedByUserId: pinnedBy,
        };

        io.to(roomForBordereau(bordereauId)).emit('bordereau.chat.pin', payload);
        if (typeof cb === 'function') cb({ ok: true, ...payload });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });


  });

  return io;
}

function getIO() {
  return ioRef;
}

function roleForQueueStatus(status) {
  switch (status) {
    case BordereauStatus.CREE:
      return RoleName.BUREAU_ORDRE;
    case BordereauStatus.RECUPERE_BO:
      return RoleName.COORDINATEUR;
    case BordereauStatus.DEPOSE_SCAN:
      return RoleName.SCANNER;
    case BordereauStatus.SCANNE:
      return RoleName.VERIFICATEUR;
    case BordereauStatus.VERIFIE:
      return RoleName.RESPONSABLE_CLIENT;
    case BordereauStatus.A_RENVOYER_AU_CLIENT:
      return RoleName.BUREAU_ORDRE;
    case BordereauStatus.RENVOYE_AU_CLIENT:
      return RoleName.BUREAU_ORDRE;
    case BordereauStatus.RECU_DU_CLIENT:
      return RoleName.RESPONSABLE_CLIENT;
    case BordereauStatus.PRET_A_ENVOYER:
    case BordereauStatus.RECU_DU_RESPONSABLE:
    case BordereauStatus.DONNE_AU_COURSIER:
      return RoleName.BUREAU_ORDRE;
    case BordereauStatus.FINALISE:
    case BordereauStatus.VALIDE:
      return RoleName.RESPONSABLE_CLIENT;
    default:
      return null;
  }
}

/**
 * Broadcast a bordereau status change.
 * We notify:
 * - all admins (role room)
 * - the role responsible for the *new* status (role room)
 * - for RESPONSABLE_CLIENT, we prefer the specific client room when clientId is present.
 */
function emitBordereauStatusChanged(payload) {
  const io = ioRef;
  // Persist notifications (async, best-effort)
  (async () => {
    try {
      const toStatus = payload?.toStatus;
      const clientId = payload?.clientId != null ? Number(payload.clientId) : null;
      const changedByUserId = payload?.changedByUserId != null ? Number(payload.changedByUserId) : null;

      const key = `bordereau:${payload?.bordereauId || 'x'}_${payload?.changedAt || ''}_${payload?.toStatus || ''}`;
      const title = `Bordereau ${payload?.reference || ''}`.trim();
      const msg = payload?.fromStatus
        ? `Statut: ${payload.fromStatus} → ${payload.toStatus}`
        : `Statut: ${payload?.toStatus || ''}`;

      const userIds = new Set();

      // Admins
      const admins = await User.findAll({
        attributes: ['id'],
        include: [{ model: Role, where: { name: RoleName.ADMIN }, through: { attributes: [] } }],
      });
      for (const u of admins) userIds.add(Number(u.id));

      const role = roleForQueueStatus(toStatus);
      if (role === RoleName.RESPONSABLE_CLIENT) {
        if (clientId) {
          const client = await Client.findByPk(clientId, {
            include: [{ model: User, as: 'responsables', attributes: ['id'], through: { attributes: [] } }],
          });
          const rs = client?.responsables || [];
          for (const u of rs) userIds.add(Number(u.id));
        } else {
          const users = await User.findAll({
            attributes: ['id'],
            include: [{ model: Role, where: { name: RoleName.RESPONSABLE_CLIENT }, through: { attributes: [] } }],
          });
          for (const u of users) userIds.add(Number(u.id));
        }
      } else if (role) {
        const users = await User.findAll({
          attributes: ['id'],
          include: [{ model: Role, where: { name: role }, through: { attributes: [] } }],
        });
        for (const u of users) userIds.add(Number(u.id));
      }

      if (changedByUserId) userIds.delete(changedByUserId);

      const createdAt = payload?.changedAt ? new Date(payload.changedAt) : new Date();
      const rows = Array.from(userIds)
        .filter(Boolean)
        .map((uid) => ({
          user_id: uid,
          event_key: key,
          kind: 'BORDEREAU',
          title,
          message: msg,
          href: `/bordereaux/${payload?.bordereauId}`,
          read: false,
          created_at: createdAt,
        }));

      if (rows.length) {
        // ignore duplicates thanks to unique index
        await Notification.bulkCreate(rows, { ignoreDuplicates: true });
      }
    } catch {
      // ignore persistence errors
    }
  })();

  if (!io) return;

  const toStatus = payload?.toStatus;
  const clientId = payload?.clientId != null ? Number(payload.clientId) : null;

  const rooms = new Set();
  rooms.add(`role:${RoleName.ADMIN}`);

  const role = roleForQueueStatus(toStatus);
  if (role === RoleName.RESPONSABLE_CLIENT) {
    if (clientId) rooms.add(`client:${clientId}`);
    else rooms.add(`role:${RoleName.RESPONSABLE_CLIENT}`);
  } else if (role) {
    rooms.add(`role:${role}`);
  }

  for (const r of rooms) io.to(r).emit('bordereau.status_changed', payload);
}

module.exports = { initSocket, getIO, emitBordereauStatusChanged, isUserOnline, getPresenceSnapshot };
