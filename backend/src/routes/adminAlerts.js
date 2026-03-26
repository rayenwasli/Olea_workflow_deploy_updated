const express = require('express');

const { listBlockedAtCoursier } = require('../utils/alertScheduler');

const router = express.Router();

// GET /api/admin/alerts/bordereaux-bloques
// Returns bordereaux stuck in DONNE_AU_COURSIER for > threshold hours.
router.get('/bordereaux-bloques', async (_req, res) => {
  const olderThanHours = Number(process.env.ALERT_DONNE_AU_COURSIER_HOURS || '48');
  const items = await listBlockedAtCoursier({ olderThanHours });
  res.json({ thresholdHours: olderThanHours, items });
});

module.exports = router;
