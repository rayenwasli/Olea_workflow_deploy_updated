const express = require('express');
const { Assureur } = require('../models');

const router = express.Router();

router.get('/', async (_req, res) => {
  const rows = await Assureur.findAll({ where: { enabled: true }, order: [['name', 'ASC']] });
  res.json(rows.map((a) => ({ id: a.id, name: a.name })));
});

module.exports = router;
