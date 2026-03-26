const { User, Role } = require('../models');

async function loadUser(req, res, next) {
  const email = req.auth && req.auth.sub;
  if (!email) return res.status(401).json({ message: 'Invalid token' });

  const user = await User.findOne({ where: { email }, include: [{ model: Role }] });
  if (!user || !user.enabled) return res.status(401).json({ message: 'User not found or disabled' });

  const roleNames = (user.roles || []).map(r => r.name);
  req.user = {
    id: user.id,
    email: user.email,
    enabled: user.enabled,
    roles: roleNames,
  };
  next();
}

module.exports = { loadUser };
