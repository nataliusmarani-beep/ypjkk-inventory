const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'ypjkk-bus-2025-secret-key';

// Prefer the HttpOnly cookie; fall back to Authorization header for API clients.
function requireAuth(req, res, next) {
  const token =
    req.cookies?.bus_token ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.clearCookie('bus_token');
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// Usage: router.post('/x', requireRole('transport_admin'), handler)
// super_admin passes every role check.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (req.user.role === 'super_admin' || roles.includes(req.user.role)) return next();
    res.status(403).json({ error: 'You do not have access to this action.' });
  };
}

const isAdmin = (user) =>
  user?.role === 'transport_admin' || user?.role === 'super_admin';

// 'leader' and 'admin' (Admin Sekolah) are read-only supervisors over the
// Transport Team's admin data (see the write-guard in routes/admin.js) — not
// decision-makers, but every other staff-tier check here (file/card
// ownership, chat) is coarse enough that giving them the same visibility as
// an attendant is the right default.
const isStaff = (user) =>
  isAdmin(user) || ['attendant', 'school_staff', 'driver', 'helper', 'leader', 'admin'].includes(user?.role);

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
module.exports.isAdmin = isAdmin;
module.exports.isStaff = isStaff;
