const express = require('express');
const { Op, QueryTypes } = require('sequelize');
const { Bordereau, BordereauStatusHistory, sequelize } = require('../models');
const { BordereauStatus, RoleName } = require('../utils/constants');
const { WORKFLOW } = require('../utils/helpers');

const router = express.Router();

function parseInstant(s, fallback, { endOfDay = false } = {}) {
  if (!s || String(s).trim() === '') return fallback;
  const str = String(s).trim();

  // IMPORTANT:
  // The UI sends HTML <input type="date"> values like "YYYY-MM-DD" (date-only).
  // In JS, that parses to midnight (00:00:00.000) which would EXCLUDE the whole
  // selected "to" day when using BETWEEN [from,to].
  // We normalize date-only inputs to UTC day boundaries.
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    if (endOfDay) return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return fallback;
  return d;
}

function formatDate(d) {
  // YYYY-MM-DD in UTC
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function weekStart(d) {
  // Monday as start (UTC)
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1 - day); // move to Monday
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

function bucketKey(d, bucket) {
  if (bucket === 'WEEK') return formatDate(weekStart(d));
  return formatDate(d);
}

function seriesBuckets(from, to, bucket) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  const out = [];
  if (bucket === 'WEEK') {
    let cur = weekStart(start);
    const last = weekStart(end);
    while (cur.getTime() <= last.getTime()) {
      out.push(formatDate(cur));
      cur = new Date(cur);
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
  } else {
    let cur = start;
    while (cur.getTime() <= end.getTime()) {
      out.push(formatDate(cur));
      cur = new Date(cur);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function parseOptionalInt(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseTriStateBool(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return null;
}

router.get('/overview', async (req, res) => {
  const now = new Date();
  const rawTo = parseInstant(req.query.to, now, { endOfDay: true });
  const rawFrom = parseInstant(req.query.from, new Date(rawTo.getTime() - 30 * 24 * 3600 * 1000));

  // Never go beyond "now" (avoid future buckets / durations)
  const effectiveTo = new Date(Math.min(rawTo.getTime(), now.getTime()));

  // Safety: if user swaps dates
  let from = rawFrom;
  let to = effectiveTo;
  if (from.getTime() > to.getTime()) {
    const tmp = new Date(from);
    from = to;
    to = tmp;
  }

  const bucket = (req.query.bucket || 'DAY').toString().toUpperCase() === 'WEEK' ? 'WEEK' : 'DAY';

  // Optional filters (backward compatible):
  // - clientId: number
  // - priority: true/false
  const clientId = parseOptionalInt(req.query.clientId);
  const priority = parseTriStateBool(req.query.priority);

  const bordereauWhere = {};
  if (clientId != null) bordereauWhere.client_id = clientId;
  if (priority != null) bordereauWhere.priority = priority;

  // Cohort scope: all dashboard widgets are computed on bordereaux created in [from,to]
  // so the date filters consistently affect KPIs + all charts.
  const cohortWhere = {
    ...bordereauWhere,
    created_at: { [Op.between]: [from, to] },
  };

  // History include scoped to the cohort
  const historyInclude = [{
    model: Bordereau,
    as: 'bordereau',
    attributes: [],
    where: cohortWhere,
    required: true,
  }];

  // KPIs (cohort)
  const totalBordereaux = await Bordereau.count({ where: cohortWhere });
  const backlog = await Bordereau.count({ where: { ...cohortWhere, current_status: { [Op.ne]: BordereauStatus.VALIDE } } });
  const priorityCount = await Bordereau.count({ where: { ...cohortWhere, priority: true } });

  // "en cours 24h / 7j" computed relative to selected end date "to"
  const last24 = new Date(to.getTime() - 24 * 3600 * 1000);
  const last7d = new Date(to.getTime() - 7 * 24 * 3600 * 1000);

  const inProgressToday = await BordereauStatusHistory.count({
    where: { changed_at: { [Op.between]: [last24, to] } },
    include: historyInclude,
  });
  const inProgressWeek = await BordereauStatusHistory.count({
    where: { changed_at: { [Op.between]: [last7d, to] } },
    include: historyInclude,
  });

  // avg cycle hours (created -> first VALIDE) within the cohort + completed within [from,to]
  const pairs = await sequelize.query(
    `
    SELECT b.id AS id, b.created_at AS created_at, MIN(h.changed_at) AS finalized_at
    FROM bordereau_status_history h
    JOIN bordereaux b ON b.id = h.bordereau_id
    WHERE h.to_status = 'VALIDE'
      AND b.created_at BETWEEN :from AND :to
      AND h.changed_at BETWEEN :from AND :to
      ${clientId != null ? 'AND b.client_id = :clientId' : ''}
      ${priority != null ? 'AND b.priority = :priority' : ''}
    GROUP BY b.id, b.created_at
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        from,
        to,
        ...(clientId != null ? { clientId } : {}),
        ...(priority != null ? { priority } : {}),
      },
    }
  );

  let avgCycleHours = null;
  if (pairs.length) {
    let total = 0;
    let n = 0;
    for (const row of pairs) {
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const finalizedAt = row.finalized_at ? new Date(row.finalized_at) : null;
      if (!createdAt || !finalizedAt) continue;
      const sec = (finalizedAt.getTime() - createdAt.getTime()) / 1000;
      if (sec < 0) continue;
      total += sec / 3600;
      n += 1;
    }
    if (n) avgCycleHours = total / n;
  }

  const kpis = {
    totalBordereaux,
    backlog,
    inProgressToday,
    inProgressWeek,
    priorityCount,
    avgCycleHours: avgCycleHours == null ? null : round2(avgCycleHours),
  };

  // status counts (cohort)
  const statusRows = await sequelize.query(
    `
      SELECT current_status AS status, COUNT(*) AS count
      FROM bordereaux
      WHERE created_at BETWEEN :from AND :to
      ${clientId != null ? 'AND client_id = :clientId' : ''}
      ${priority != null ? 'AND priority = :priority' : ''}
      GROUP BY current_status
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        from,
        to,
        ...(clientId != null ? { clientId } : {}),
        ...(priority != null ? { priority } : {}),
      },
    }
  );

  const map = new Map();
  for (const r of statusRows) map.set(r.status, Number(r.count || 0));

  const statusCounts = [];
  for (const s of WORKFLOW) statusCounts.push({ status: s, count: map.get(s) || 0 });
  for (const [k, v] of map.entries()) {
    if (!WORKFLOW.includes(k)) statusCounts.push({ status: k, count: v });
  }

  const funnel = WORKFLOW.map((s) => ({ status: s, count: map.get(s) || 0 }));

  // created series (cohort)
  const allB = await Bordereau.findAll({
    attributes: ['created_at'],
    where: cohortWhere,
  });

  const createdCounts = new Map();
  for (const b of allB) {
    const t = b.created_at ? new Date(b.created_at) : null;
    if (!t) continue;
    const key = bucketKey(t, bucket);
    createdCounts.set(key, (createdCounts.get(key) || 0) + 1);
  }

  const buckets = seriesBuckets(from, to, bucket);
  const createdSeries = buckets.map((k) => ({ bucket: k, count: createdCounts.get(k) || 0 }));

  // finalized series (VALIDE transitions) for cohort in [from,to]
  const eventsInRange = await BordereauStatusHistory.findAll({
    where: { changed_at: { [Op.between]: [from, to] } },
    attributes: ['bordereau_id', 'to_status', 'changed_at', 'from_status', 'changed_by_role'],
    include: historyInclude,
  });

  const finalizedCounts = new Map();
  for (const e of eventsInRange) {
    if (e.to_status !== BordereauStatus.VALIDE) continue;
    const key = bucketKey(new Date(e.changed_at), bucket);
    finalizedCounts.set(key, (finalizedCounts.get(key) || 0) + 1);
  }
  const finalizedSeries = buckets.map((k) => ({ bucket: k, count: finalizedCounts.get(k) || 0 }));

  // avg time per status within [from,to] (cohort)
  // We need events before "from" to correctly compute overlaps, so fetch everything up to "to".
  const allHistory = await BordereauStatusHistory.findAll({
    where: { changed_at: { [Op.lte]: to } },
    attributes: ['bordereau_id', 'to_status', 'changed_at'],
    include: historyInclude,
    order: [
      ['bordereau_id', 'ASC'],
      ['changed_at', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const byBord = new Map();
  for (const h of allHistory) {
    const id = Number(h.bordereau_id);
    if (!byBord.has(id)) byBord.set(id, []);
    byBord.get(id).push(h);
  }

  const totalSec = new Map();
  const samples = new Map();

  for (const [bid, list] of byBord.entries()) {
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const status = cur.to_status;
      if (!status) continue;

      const intervalStart = new Date(cur.changed_at);
      const intervalEnd = i + 1 < list.length ? new Date(list[i + 1].changed_at) : to;

      // Clip the interval to the selected range [from,to]
      const start = new Date(Math.max(intervalStart.getTime(), from.getTime()));
      const end = new Date(Math.min(intervalEnd.getTime(), to.getTime()));

      const sec = (end.getTime() - start.getTime()) / 1000;
      if (sec <= 0) continue;

      totalSec.set(status, (totalSec.get(status) || 0) + sec);
      samples.set(status, (samples.get(status) || 0) + 1);
    }
  }

  let bottleneck = { status: 'N/A', avgHours: 0.0, samples: 0 };
  const avgTimePerStatus = [];
  for (const s of WORKFLOW) {
    const samp = samples.get(s) || 0;
    const avgHours = samp === 0 ? 0.0 : (totalSec.get(s) || 0) / 3600 / samp;
    const sd = { status: s, avgHours: round2(avgHours), samples: samp };
    avgTimePerStatus.push(sd);
    if (samp > 0 && sd.avgHours > bottleneck.avgHours) bottleneck = sd;
  }

  // aging buckets (cohort backlog as of "to")
  const open = await Bordereau.findAll({
    attributes: ['current_status', 'created_at'],
    where: {
      ...cohortWhere,
      current_status: { [Op.ne]: BordereauStatus.FINALISE },
    },
  });

  const agingDefs = [
    { label: '0-2', minDays: 0, maxDays: 2 },
    { label: '3-7', minDays: 3, maxDays: 7 },
    { label: '8-14', minDays: 8, maxDays: 14 },
    { label: '15+', minDays: 15, maxDays: 10_000 },
  ];

  const agingBuckets = [];
  for (const def of agingDefs) {
    const byStatus = new Map();
    let total = 0;

    for (const b of open) {
      const createdAt = b.created_at ? new Date(b.created_at) : null;
      if (!createdAt) continue;
      const ageDays = Math.floor((to.getTime() - createdAt.getTime()) / (24 * 3600 * 1000));
      if (ageDays < def.minDays) continue;
      if (ageDays > def.maxDays) continue;

      const st = b.current_status;
      byStatus.set(st, (byStatus.get(st) || 0) + 1);
      total += 1;
    }

    const ordered = {};
    for (const s of WORKFLOW) {
      if (s === BordereauStatus.VALIDE) continue;
      ordered[s] = byStatus.get(s) || 0;
    }

    agingBuckets.push({ bucket: def.label, total, byStatus: ordered });
  }

  // role activity over time (cohort transitions in range)
  const roleAcc = new Map(); // bucket -> role -> count
  for (const e of eventsInRange) {
    if (e.from_status == null) continue; // exclude initial creation
    const bkey = bucketKey(new Date(e.changed_at), bucket);
    const role = e.changed_by_role || 'UNKNOWN';

    if (!roleAcc.has(bkey)) roleAcc.set(bkey, new Map());
    const m = roleAcc.get(bkey);
    m.set(role, (m.get(role) || 0) + 1);
  }

  // roles set
  let roles = new Set();
  for (const m of roleAcc.values()) for (const r of m.keys()) roles.add(r);
  if (roles.size === 0) {
    roles = new Set(Object.values(RoleName));
  }

  const roleList = Array.from(roles).sort();
  const roleActivitySeries = buckets.map((b) => {
    const m = roleAcc.get(b) || new Map();
    const countsByRole = {};
    for (const r of roleList) countsByRole[r] = m.get(r) || 0;
    return { bucket: b, countsByRole };
  });

  res.json({
    generatedAt: new Date().toISOString(),
    scope: {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket,
      clientId,
      priority,
    },
    kpis,
    statusCounts,
    funnel,
    createdSeries,
    finalizedSeries,
    avgTimePerStatus,
    bottleneck,
    agingBuckets,
    roleActivitySeries,
  });
});



// ----------------------------
// Role-specific dashboards
// ----------------------------

function pendingStatusesForRole(role) {
  switch (role) {
    case RoleName.BUREAU_ORDRE:
      return [
        BordereauStatus.CREE,
        BordereauStatus.PRET_A_ENVOYER,
        BordereauStatus.A_RENVOYER_AU_CLIENT,
        BordereauStatus.RENVOYE_AU_CLIENT,
        BordereauStatus.RECU_DU_RESPONSABLE,
        BordereauStatus.DONNE_AU_COURSIER,
      ];
    case RoleName.COORDINATEUR:
      return [BordereauStatus.RECUPERE_BO];
    case RoleName.SCANNER:
      return [BordereauStatus.DEPOSE_SCAN];
    case RoleName.VERIFICATEUR:
      return [BordereauStatus.SCANNE];
    case RoleName.RESPONSABLE_CLIENT:
    case RoleName.RESPONSABLE_CLIENT_PROD:
      return [BordereauStatus.VERIFIE, BordereauStatus.RECU_DU_CLIENT, BordereauStatus.FINALISE];
    case RoleName.COURSIER:
      // No dedicated in-app workflow step currently.
      return [];
    default:
      return [];
  }
}

router.get('/role/:role', async (req, res) => {
  const role = String(req.params.role || '').toUpperCase();
  const roleName = Object.values(RoleName).includes(role) ? role : null;
  if (!roleName) return res.status(400).json({ message: 'Rôle invalide' });

  const pendingStatuses = pendingStatusesForRole(roleName);

  const now = new Date();
  const rawTo = parseInstant(req.query.to, now, { endOfDay: true });
  const rawFrom = parseInstant(req.query.from, new Date(rawTo.getTime() - 30 * 24 * 3600 * 1000));

  // Never go beyond "now"
  const effectiveTo = new Date(Math.min(rawTo.getTime(), now.getTime()));

  let from = rawFrom;
  let to = effectiveTo;
  if (from.getTime() > to.getTime()) {
    const tmp = new Date(from);
    from = to;
    to = tmp;
  }

  const bucket = (req.query.bucket || 'DAY').toString().toUpperCase() === 'WEEK' ? 'WEEK' : 'DAY';

  const clientId = parseOptionalInt(req.query.clientId);
  const priority = parseTriStateBool(req.query.priority);

  const baseWhere = {};
  if (clientId != null) baseWhere.client_id = clientId;
  if (priority != null) baseWhere.priority = priority;

  // If no statuses for this role, return empty dashboard gracefully.
  if (!pendingStatuses.length) {
    return res.json({
      generatedAt: new Date().toISOString(),
      role: roleName,
      scope: {
        from: from.toISOString(),
        to: to.toISOString(),
        bucket,
        asOf: to.toISOString(),
        clientId,
        priority,
      },
      pendingStatuses,
      backlogByStatus: [],
      agingDaily: [],
      waitingItems: [],
      throughputSeries: seriesBuckets(from, to, bucket).map((b) => ({ bucket: b, count: 0 })),
      kpis: { backlogBordereaux: 0, backlogDocuments: 0, avgWaitDays: 0, maxWaitDays: 0, processedInRange: 0 },
    });
  }

  // Exclude parent groups (bordereaux that have children)
  const excludeGroupsSql = `NOT EXISTS (SELECT 1 FROM bordereaux c WHERE c.parent_id = b.id)`;

  const replacements = {
    statuses: pendingStatuses,
    asOf: to,
    ...(clientId != null ? { clientId } : {}),
    ...(priority != null ? { priority } : {}),
  }

  // Backlog by current_status + waiting time (days since entering current status)
  const backlogRows = await sequelize.query(
    `
      SELECT
        b.current_status AS status,
        COUNT(*) AS count,
        SUM(COALESCE(di.nombre, 0)) AS documents,
        AVG(TIMESTAMPDIFF(SECOND, e.changed_at, :asOf)) / 86400 AS avgWaitDays,
        MAX(TIMESTAMPDIFF(SECOND, e.changed_at, :asOf)) / 86400 AS maxWaitDays
      FROM bordereaux b
      LEFT JOIN bordereau_deposit_info di ON di.bordereau_id = b.id
      JOIN (
        SELECT bordereau_id, to_status, MAX(changed_at) AS changed_at
        FROM bordereau_status_history
        WHERE to_status IN (:statuses)
        GROUP BY bordereau_id, to_status
      ) e
        ON e.bordereau_id = b.id
       AND e.to_status = b.current_status
      WHERE b.current_status IN (:statuses)
        AND ${excludeGroupsSql}
        ${clientId != null ? 'AND b.client_id = :clientId' : ''}
        ${priority != null ? 'AND b.priority = :priority' : ''}
      GROUP BY b.current_status
    `,
    { type: QueryTypes.SELECT, replacements }
  );

  const backlogByStatus = pendingStatuses.map((s) => {
    const row = backlogRows.find((r) => r.status === s);
    return {
      status: s,
      count: Number(row?.count || 0),
      documents: Number(row?.documents || 0),
      avgWaitDays: round2(Number(row?.avgWaitDays || 0)),
      maxWaitDays: round2(Number(row?.maxWaitDays || 0)),
    };
  });


  // Aging distribution (day-by-day) + waiting items (details)
  // ageDays = full days since entering the current status.
  const agingDailyRows = await sequelize.query(
    `
      SELECT ageDays, COUNT(*) AS count, SUM(documents) AS documents
      FROM (
        SELECT
          b.id,
          FLOOR(TIMESTAMPDIFF(HOUR, e.changed_at, :asOf) / 24) AS ageDays,
          CASE
            WHEN SUM(COALESCE(dt.nombre, 0)) > 0 THEN SUM(COALESCE(dt.nombre, 0))
            ELSE COALESCE(MAX(di.nombre), 0)
          END AS documents
        FROM bordereaux b
        LEFT JOIN bordereau_deposit_info di ON di.bordereau_id = b.id
        LEFT JOIN bordereau_deposit_document_type dt ON dt.deposit_info_id = di.id
        JOIN (
          SELECT bordereau_id, to_status, MAX(changed_at) AS changed_at
          FROM bordereau_status_history
          WHERE to_status IN (:statuses)
          GROUP BY bordereau_id, to_status
        ) e
          ON e.bordereau_id = b.id
         AND e.to_status = b.current_status
        WHERE b.current_status IN (:statuses)
          AND ${excludeGroupsSql}
          ${clientId != null ? 'AND b.client_id = :clientId' : ''}
          ${priority != null ? 'AND b.priority = :priority' : ''}
        GROUP BY b.id, e.changed_at
      ) t
      GROUP BY ageDays
      ORDER BY ageDays ASC
    `,
    { type: QueryTypes.SELECT, replacements }
  );

  const agingDaily = agingDailyRows.map((r) => ({
    ageDays: Number(r.ageDays || 0),
    count: Number(r.count || 0),
    documents: Number(r.documents || 0),
  }));

  // Detailed waiting items (one row per document type when available)
  const waitingItemsRows = await sequelize.query(
    `
      SELECT
        b.id AS bordereauId,
        b.reference AS reference,
        c.name AS clientName,
        b.current_status AS status,
        e.changed_at AS statusSince,
        FLOOR(TIMESTAMPDIFF(HOUR, e.changed_at, :asOf) / 24) AS ageDays,
        COALESCE(dt.type_document, di.type_document, '') AS documentType,
        COALESCE(dt.nombre, di.nombre, 0) AS nombre
      FROM bordereaux b
      LEFT JOIN clients c ON c.id = b.client_id
      LEFT JOIN bordereau_deposit_info di ON di.bordereau_id = b.id
      LEFT JOIN bordereau_deposit_document_type dt ON dt.deposit_info_id = di.id
      JOIN (
        SELECT bordereau_id, to_status, MAX(changed_at) AS changed_at
        FROM bordereau_status_history
        WHERE to_status IN (:statuses)
        GROUP BY bordereau_id, to_status
      ) e
        ON e.bordereau_id = b.id
       AND e.to_status = b.current_status
      WHERE b.current_status IN (:statuses)
        AND ${excludeGroupsSql}
        ${clientId != null ? 'AND b.client_id = :clientId' : ''}
        ${priority != null ? 'AND b.priority = :priority' : ''}
      ORDER BY ageDays DESC, statusSince ASC, b.id DESC
    `,
    { type: QueryTypes.SELECT, replacements }
  );

  const waitingItems = waitingItemsRows.map((r) => ({
    bordereauId: Number(r.bordereauId),
    reference: r.reference,
    clientName: r.clientName || null,
    status: r.status,
    statusSince: r.statusSince ? new Date(r.statusSince).toISOString() : null,
    ageDays: Number(r.ageDays || 0),
    documentType: r.documentType || '',
    nombre: Number(r.nombre || 0),
  }));

  // Throughput series: number of transitions performed by this role in [from,to]
  const events = await BordereauStatusHistory.findAll({
    where: {
      changed_at: { [Op.between]: [from, to] },
      changed_by_role: roleName,
    },
    attributes: ['changed_at', 'from_status'],
  });

  const buckets = seriesBuckets(from, to, bucket);
  const acc = new Map();
  for (const e of events) {
    if (e.from_status == null) continue;
    const k = bucketKey(new Date(e.changed_at), bucket);
    acc.set(k, (acc.get(k) || 0) + 1);
  }
  const throughputSeries = buckets.map((b) => ({ bucket: b, count: acc.get(b) || 0 }));

  const backlogTotal = backlogByStatus.reduce((s, x) => s + x.count, 0);
  const backlogTotalDocs = backlogByStatus.reduce((s, x) => s + (x.documents || 0), 0);
  const weightedAvg = backlogTotal
    ? backlogByStatus.reduce((s, x) => s + x.avgWaitDays * x.count, 0) / backlogTotal
    : 0;
  const maxWait = backlogByStatus.reduce((m, x) => Math.max(m, x.maxWaitDays), 0);

  res.json({
    generatedAt: new Date().toISOString(),
    role: roleName,
    scope: {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket,
      asOf: to.toISOString(),
      clientId,
      priority,
    },
    pendingStatuses,
    backlogByStatus,
    agingDaily,
    waitingItems,
    throughputSeries,
    kpis: {
      backlogBordereaux: backlogTotal,
      backlogDocuments: backlogTotalDocs,
      avgWaitDays: round2(weightedAvg),
      maxWaitDays: round2(maxWait),
      processedInRange: events.length,
    },
  });
});


// ----------------------------
// Numeric statistics (tables only)
// ----------------------------

router.get('/numeric', async (req, res) => {
  const now = new Date();
  const rawTo = parseInstant(req.query.to, now, { endOfDay: true });
  const rawFrom = parseInstant(req.query.from, new Date(rawTo.getTime() - 30 * 24 * 3600 * 1000));

  const effectiveTo = new Date(Math.min(rawTo.getTime(), now.getTime()));
  let from = rawFrom;
  let to = effectiveTo;
  if (from.getTime() > to.getTime()) {
    const tmp = new Date(from);
    from = to;
    to = tmp;
  }

  const bucket = (req.query.bucket || 'DAY').toString().toUpperCase() === 'WEEK' ? 'WEEK' : 'DAY';
  const clientId = parseOptionalInt(req.query.clientId);
  const priority = parseTriStateBool(req.query.priority);

  const bordereauWhere = {};
  if (clientId != null) bordereauWhere.client_id = clientId;
  if (priority != null) bordereauWhere.priority = priority;

  // Cohort scope (consistent with /overview)
  const cohortWhere = {
    ...bordereauWhere,
    created_at: { [Op.between]: [from, to] },
  };

  const excludeGroupsSql = `NOT EXISTS (SELECT 1 FROM bordereaux c WHERE c.parent_id = b.id)`;

  // KPIs (same as /overview)
  const totalBordereaux = await Bordereau.count({ where: cohortWhere });
  const backlog = await Bordereau.count({ where: { ...cohortWhere, current_status: { [Op.ne]: BordereauStatus.VALIDE } } });
  const priorityCount = await Bordereau.count({ where: { ...cohortWhere, priority: true } });

  const last24 = new Date(to.getTime() - 24 * 3600 * 1000);
  const last7d = new Date(to.getTime() - 7 * 24 * 3600 * 1000);

  const historyInclude = [{
    model: Bordereau,
    as: 'bordereau',
    attributes: [],
    where: cohortWhere,
    required: true,
  }];

  const inProgressToday = await BordereauStatusHistory.count({
    where: { changed_at: { [Op.between]: [last24, to] } },
    include: historyInclude,
  });
  const inProgressWeek = await BordereauStatusHistory.count({
    where: { changed_at: { [Op.between]: [last7d, to] } },
    include: historyInclude,
  });

  // Avg cycle hours (created -> first VALIDE)
  const pairs = await sequelize.query(
    `
    SELECT b.id AS id, b.created_at AS created_at, MIN(h.changed_at) AS finalized_at
    FROM bordereau_status_history h
    JOIN bordereaux b ON b.id = h.bordereau_id
    WHERE h.to_status = 'VALIDE'
      AND b.created_at BETWEEN :from AND :to
      AND h.changed_at BETWEEN :from AND :to
      ${clientId != null ? 'AND b.client_id = :clientId' : ''}
      ${priority != null ? 'AND b.priority = :priority' : ''}
    GROUP BY b.id, b.created_at
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        from,
        to,
        ...(clientId != null ? { clientId } : {}),
        ...(priority != null ? { priority } : {}),
      },
    }
  );

  let avgCycleHours = null;
  if (pairs.length) {
    let total = 0;
    let n = 0;
    for (const row of pairs) {
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const finalizedAt = row.finalized_at ? new Date(row.finalized_at) : null;
      if (!createdAt || !finalizedAt) continue;
      const sec = (finalizedAt.getTime() - createdAt.getTime()) / 1000;
      if (sec < 0) continue;
      total += sec / 3600;
      n += 1;
    }
    if (n) avgCycleHours = total / n;
  }

  const kpis = {
    totalBordereaux,
    backlog,
    inProgressToday,
    inProgressWeek,
    priorityCount,
    avgCycleHours: avgCycleHours == null ? null : round2(avgCycleHours),
  };

  // Status counts in cohort
  const statusRows = await sequelize.query(
    `
      SELECT current_status AS status, COUNT(*) AS count
      FROM bordereaux
      WHERE created_at BETWEEN :from AND :to
      ${clientId != null ? 'AND client_id = :clientId' : ''}
      ${priority != null ? 'AND priority = :priority' : ''}
      GROUP BY current_status
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        from,
        to,
        ...(clientId != null ? { clientId } : {}),
        ...(priority != null ? { priority } : {}),
      },
    }
  );

  const statusCountMap = new Map();
  for (const r of statusRows) statusCountMap.set(r.status, Number(r.count || 0));

  // Avg time per status in cohort (same logic as /overview)
  const allHistory = await BordereauStatusHistory.findAll({
    where: { changed_at: { [Op.lte]: to } },
    attributes: ['bordereau_id', 'to_status', 'changed_at'],
    include: historyInclude,
    order: [
      ['bordereau_id', 'ASC'],
      ['changed_at', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const byBord = new Map();
  for (const h of allHistory) {
    const id = Number(h.bordereau_id);
    if (!byBord.has(id)) byBord.set(id, []);
    byBord.get(id).push(h);
  }

  const totalSec = new Map();
  const samples = new Map();

  for (const [bid, list] of byBord.entries()) {
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const status = cur.to_status;
      if (!status) continue;

      const intervalStart = new Date(cur.changed_at);
      const intervalEnd = i + 1 < list.length ? new Date(list[i + 1].changed_at) : to;

      const start = new Date(Math.max(intervalStart.getTime(), from.getTime()));
      const end = new Date(Math.min(intervalEnd.getTime(), to.getTime()));

      const sec = (end.getTime() - start.getTime()) / 1000;
      if (sec <= 0) continue;

      totalSec.set(status, (totalSec.get(status) || 0) + sec);
      samples.set(status, (samples.get(status) || 0) + 1);
    }
  }

  let bottleneck = { status: 'N/A', avgHours: 0.0, samples: 0 };
  const byStatus = [];
  for (const s of WORKFLOW) {
    const samp = samples.get(s) || 0;
    const avgHours = samp === 0 ? 0.0 : (totalSec.get(s) || 0) / 3600 / samp;
    const item = {
      status: s,
      count: statusCountMap.get(s) || 0,
      avgHours: round2(avgHours),
      samples: samp,
    };
    byStatus.push(item);
    if (samp > 0 && item.avgHours > bottleneck.avgHours) bottleneck = { status: s, avgHours: item.avgHours, samples: samp };
  }

  // Role table (using role pending statuses definition)
  const roles = [
    RoleName.BUREAU_ORDRE,
    RoleName.COORDINATEUR,
    RoleName.SCANNER,
    RoleName.VERIFICATEUR,
    RoleName.RESPONSABLE_CLIENT,
    RoleName.RESPONSABLE_CLIENT_PROD,
    RoleName.COURSIER,
  ];

  const roleRows = [];
  for (const r of roles) {
    const statuses = pendingStatusesForRole(r);
    if (!statuses.length) {
      roleRows.push({ role: r, backlogBordereaux: 0, backlogDocuments: 0, avgWaitDays: 0, maxWaitDays: 0, processedInRange: 0 });
      continue;
    }

    const agg = await sequelize.query(
      `
      SELECT
        COUNT(*) AS count,
        SUM(documents) AS documents,
        AVG(waitSec) / 86400 AS avgWaitDays,
        MAX(waitSec) / 86400 AS maxWaitDays
      FROM (
        SELECT
          b.id,
          CASE
            WHEN SUM(COALESCE(dt.nombre, 0)) > 0 THEN SUM(COALESCE(dt.nombre, 0))
            ELSE COALESCE(MAX(di.nombre), 0)
          END AS documents,
          TIMESTAMPDIFF(SECOND, e.changed_at, :asOf) AS waitSec
        FROM bordereaux b
        LEFT JOIN bordereau_deposit_info di ON di.bordereau_id = b.id
        LEFT JOIN bordereau_deposit_document_type dt ON dt.deposit_info_id = di.id
        JOIN (
          SELECT bordereau_id, to_status, MAX(changed_at) AS changed_at
          FROM bordereau_status_history
          WHERE to_status IN (:statuses)
          GROUP BY bordereau_id, to_status
        ) e
          ON e.bordereau_id = b.id
         AND e.to_status = b.current_status
        WHERE b.current_status IN (:statuses)
          AND ${excludeGroupsSql}
          ${clientId != null ? 'AND b.client_id = :clientId' : ''}
          ${priority != null ? 'AND b.priority = :priority' : ''}
        GROUP BY b.id, e.changed_at
      ) t
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          statuses,
          asOf: to,
          ...(clientId != null ? { clientId } : {}),
          ...(priority != null ? { priority } : {}),
        },
      }
    );

    const row = agg?.[0] || {};

    const processed = await sequelize.query(
      `
      SELECT COUNT(*) AS count
      FROM bordereau_status_history h
      JOIN bordereaux b ON b.id = h.bordereau_id
      WHERE h.changed_by_role = :role
        AND h.changed_at BETWEEN :from AND :to
        AND h.from_status IS NOT NULL
        AND b.created_at BETWEEN :from AND :to
        AND ${excludeGroupsSql}
        ${clientId != null ? 'AND b.client_id = :clientId' : ''}
        ${priority != null ? 'AND b.priority = :priority' : ''}
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          role: r,
          from,
          to,
          ...(clientId != null ? { clientId } : {}),
          ...(priority != null ? { priority } : {}),
        },
      }
    );

    const processedCount = Number((processed?.[0] || {}).count || 0);

    roleRows.push({
      role: r,
      backlogBordereaux: Number(row.count || 0),
      backlogDocuments: Number(row.documents || 0),
      avgWaitDays: round2(Number(row.avgWaitDays || 0)),
      maxWaitDays: round2(Number(row.maxWaitDays || 0)),
      processedInRange: processedCount,
    });
  }

  res.json({
    generatedAt: new Date().toISOString(),
    scope: {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket,
      asOf: to.toISOString(),
      clientId,
      priority,
    },
    kpis,
    bottleneck,
    byStatus,
    byRole: roleRows,
  });
});

module.exports = router;
