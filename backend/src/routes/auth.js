const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Role } = require('../models');
const { authoritiesFromRoleNames } = require('../utils/helpers');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'email and password are required' });

  const user = await User.findOne({ where: { email: String(email).toLowerCase().trim() }, include: [{ model: Role }] });
  if (!user || !user.enabled) return res.status(401).json({ message: 'Bad credentials' });

  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ message: 'Bad credentials' });

  const roleNames = (user.roles || []).map(r => r.name);
  const roles = authoritiesFromRoleNames(roleNames);
  const expiresIn = Number(process.env.JWT_EXPIRES_IN_SECONDS || '43200');

  const token = jwt.sign(
    { sub: user.email, roles },
    process.env.JWT_SECRET || 'dev_secret_change_me',
    { expiresIn }
  );

  return res.json({
    accessToken: token,
    tokenType: 'Bearer',
    expiresIn,
    roles,
  });
});

module.exports = router;
