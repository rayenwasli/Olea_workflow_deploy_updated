const jwt = require('jsonwebtoken');

function getTokenFromReq(req) {
  const h = req.headers['authorization'];
  if (!h) return null;
  const parts = h.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

function authMiddleware() {
  return (req, res, next) => {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ message: 'Missing token' });

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
      req.auth = payload;
      next();
    } catch (e) {
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

function requireRole(...requiredAuthorities) {
  return (req, res, next) => {
    const roles = (req.auth && req.auth.roles) ? req.auth.roles : [];
    const ok = requiredAuthorities.some(r => roles.includes(r));
    if (!ok) return res.status(403).json({ message: 'Forbidden' });
    next();
  };
}

module.exports = { authMiddleware, requireRole, getTokenFromReq };
