const { QueryTypes } = require('sequelize');
const { BordereauStatus, RoleName } = require('./constants');
const { sequelize, User, Role, Notification } = require('../models');
const { getIO } = require('../socket');

function hoursToMs(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * 3600 * 1000;
}

async function listBlockedAtCoursier({ olderThanHours }) {
  const cutoff = new Date(Date.now() - hoursToMs(olderThanHours));

  // "Blocked" if current_status is DONNE_AU_COURSIER and the last entry into
  // that status is older than the cutoff.
  // We return the history row id to build a stable alert key.
  const rows = await sequelize.query(
    `
      SELECT
        b.id AS bordereau_id,
        b.reference AS reference,
        b.client_id AS client_id,
        b.client_name AS client_name,
        b.priority AS priority,
        h.id AS history_id,
        h.changed_at AS entered_at
      FROM bordereaux b
      JOIN bordereau_status_history h
        ON h.bordereau_id = b.id
       AND h.to_status = :status
       AND h.changed_at = (
          SELECT MAX(h2.changed_at)
          FROM bordereau_status_history h2
          WHERE h2.bordereau_id = b.id
            AND h2.to_status = :status
       )
      WHERE b.current_status = :status
        AND (
          b.parent_id IS NOT NULL
          OR b.id NOT IN (SELECT DISTINCT parent_id FROM bordereaux WHERE parent_id IS NOT NULL)
        )
        AND h.changed_at <= :cutoff
      ORDER BY h.changed_at ASC
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        status: BordereauStatus.DONNE_AU_COURSIER,
        cutoff,
      },
    }
  );

  return (rows || []).map((r) => {
    const enteredAt = r.entered_at ? new Date(r.entered_at) : null;
    const ageMs = enteredAt ? Date.now() - enteredAt.getTime() : 0;
    const ageHours = Math.floor(ageMs / (3600 * 1000));
    return {
      bordereauId: Number(r.bordereau_id),
      reference: String(r.reference || ''),
      clientId: r.client_id == null ? null : Number(r.client_id),
      clientName: r.client_name ? String(r.client_name) : null,
      priority: Boolean(r.priority),
      historyId: Number(r.history_id),
      enteredAt: enteredAt ? enteredAt.toISOString() : null,
      ageHours,
    };
  });
}

async function createNotificationIfMissing({ userId, eventKey, title, message, href }) {
  try {
    const createdAt = new Date();
    await Notification.create({
      user_id: Number(userId),
      event_key: String(eventKey),
      kind: 'BORDEREAU',
      title,
      message,
      href,
      read: false,
      created_at: createdAt,
    });

    // Realtime push (best effort)
    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit('notification.new', {
        id: String(eventKey),
        kind: 'bordereau',
        title,
        message,
        href,
        read: false,
        createdAt: createdAt.getTime(),
      });
    }

    return true;
  } catch (e) {
    if (e?.name === 'SequelizeUniqueConstraintError') return false;
    // eslint-disable-next-line no-console
    console.warn('[alerts] unable to create notification:', e?.message || e);
    return false;
  }
}

async function notifyAdminsBlockedCoursier({ olderThanHours }) {
  const blocked = await listBlockedAtCoursier({ olderThanHours });
  if (!blocked.length) return { checked: 0, notified: 0 };

  const admins = await User.findAll({
    attributes: ['id'],
    include: [{ model: Role, where: { name: RoleName.ADMIN }, through: { attributes: [] } }],
  });
  const adminIds = (admins || []).map((u) => Number(u.id)).filter(Boolean);
  if (!adminIds.length) return { checked: blocked.length, notified: 0 };

  let notified = 0;
  for (const b of blocked) {
    const title = `Alerte · Bordereau ${b.reference}`;
    const msg = `Bloqué en “Donné au coursier” depuis ${b.ageHours}h`;
    const href = '/admin/alerts';
    const eventKey = `alert:coursier_blocked:${b.historyId}`;

    for (const uid of adminIds) {
      // eslint-disable-next-line no-await-in-loop
      const created = await createNotificationIfMissing({
        userId: uid,
        eventKey,
        title,
        message: msg,
        href,
      });
      if (created) notified += 1;
    }
  }

  return { checked: blocked.length, notified };
}

function startBordereauAlertScheduler() {
  const enabled = String(process.env.ALERTS_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) return;

  const olderThanHours = Number(process.env.ALERT_DONNE_AU_COURSIER_HOURS || '48');
  const intervalMin = Number(process.env.ALERT_CHECK_INTERVAL_MIN || '15');
  const intervalMs = Math.max(60_000, Math.floor(intervalMin * 60_000));

  // eslint-disable-next-line no-console
  console.log(`[alerts] scheduler enabled (threshold=${olderThanHours}h, interval=${Math.round(intervalMs / 60000)}m)`);

  const run = async () => {
    try {
      await notifyAdminsBlockedCoursier({ olderThanHours });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[alerts] scheduler run failed:', e?.message || e);
    }
  };

  // Initial run shortly after startup
  setTimeout(run, 12_000);
  setInterval(run, intervalMs);
}

module.exports = {
  listBlockedAtCoursier,
  notifyAdminsBlockedCoursier,
  startBordereauAlertScheduler,
};
