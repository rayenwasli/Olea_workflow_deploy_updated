const express = require('express');
const { Op } = require('sequelize');
const { Client, User, Role } = require('../models');
const { RoleName } = require('../utils/constants');

const router = express.Router();

router.get('/', async (_req, res) => {
  const clients = await Client.findAll({ order: [['name','ASC']] });
  res.json(clients.map(c => ({ id: c.id, name: c.name })));
});

// List responsible-client users assigned to a given client.
// Used by the COORDINATEUR deposit form to pick the "responsable" from a dropdown.
router.get('/:clientId/responsables', async (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isFinite(clientId)) return res.status(400).json({ message: 'Invalid clientId' });

  // Keep the response minimal and stable.
  const users = await User.findAll({
    include: [
      {
        model: Client,
        as: 'assigned_clients',
        through: { attributes: [] },
        where: { id: clientId },
        required: true,
      },
      {
        model: Role,
        through: { attributes: [] },
        where: { name: { [Op.in]: [RoleName.RESPONSABLE_CLIENT, RoleName.RESPONSABLE_CLIENT_PROD] } },
        required: true,
      },
    ],
    where: { enabled: true },
    order: [['email', 'ASC']],
    distinct: true,
  });

  res.json(users.map((u) => ({ id: u.id, email: u.email })));
});

module.exports = router;
