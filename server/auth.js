const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkCredentials(username, password) {
  const validUser = process.env.ADMIN_USER || '';
  const validPass = process.env.ADMIN_PASSWORD || '';
  if (!validUser || !validPass) return false;
  return timingSafeEqual(username || '', validUser) && timingSafeEqual(password || '', validPass);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'No autenticado' });
}

module.exports = { checkCredentials, requireAuth };
