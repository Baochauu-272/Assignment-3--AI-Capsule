// authMiddleware.js — kiểm tra JWT trong cookie "token"
// Nếu hợp lệ: gắn req.userId rồi cho đi tiếp (next())
// Nếu không có / không hợp lệ: trả về 401, KHÔNG cho đi tiếp
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId; // dùng cái này ở mọi route CRUD, KHÔNG bao giờ tin user_id từ frontend
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

module.exports = requireAuth;
