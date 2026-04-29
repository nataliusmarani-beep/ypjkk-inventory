const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'ypjkk-inventory-2025-secret-key';

module.exports = function requireAuth(req, res, next) {
  // Prefer HttpOnly cookie; fall back to Authorization header for API clients
  const token =
    req.cookies?.inv_token ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    // Clear stale cookie if present
    res.clearCookie('inv_token');
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
};
