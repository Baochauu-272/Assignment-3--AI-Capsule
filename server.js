require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const db = require('./db');
const requireAuth = require('./authMiddleware');

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------
// PUBLIC: health check
// ---------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------
// OAUTH: bước 1 — redirect user sang GitHub để đăng nhập
// ---------------------------------------------
app.get('/auth/github', (req, res) => {
  const redirectUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.GITHUB_CALLBACK_URL)}` +
    `&scope=read:user`;
  res.redirect(redirectUrl);
});

// ---------------------------------------------
// OAUTH: bước 2 — GitHub gọi lại route này kèm "code"
// Đổi code lấy access_token, lấy thông tin user, tạo JWT riêng, set cookie
// ---------------------------------------------
app.get('/auth/github/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing code from GitHub');
  }

  try {
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
      },
      { headers: { Accept: 'application/json' } }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      console.error('No access_token returned from GitHub', tokenResponse.data);
      return res.status(401).send('GitHub OAuth failed');
    }

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const githubUserId = String(userResponse.data.id);

    const appToken = jwt.sign(
      { userId: githubUserId },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.cookie('token', appToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.redirect('/dashboard');
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    res.status(500).send('Authentication error');
  }
});

// ---------------------------------------------
// LOGOUT: xoá cookie token
// ---------------------------------------------
app.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// ---------------------------------------------
// PROTECTED CRUD: /api/capsules
// ---------------------------------------------

app.get('/api/capsules', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM capsules WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId);
  res.json(rows);
});

app.post('/api/capsules', requireAuth, (req, res) => {
  const {
    project_name,
    prompt_title,
    prompt_version,
    prompt_text,
    response_summary,
    category,
    usefulness,
    reviewed,
    improved,
    screenshot_url,
    notes,
  } = req.body;

  if (!project_name || !prompt_title || !prompt_text) {
    return res.status(400).json({
      error: 'project_name, prompt_title và prompt_text là bắt buộc',
    });
  }

  const result = db
    .prepare(
      `INSERT INTO capsules
        (user_id, project_name, prompt_title, prompt_version, prompt_text,
         response_summary, category, usefulness, reviewed, improved,
         screenshot_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.userId,
      project_name,
      prompt_title,
      prompt_version || null,
      prompt_text,
      response_summary || null,
      category || null,
      usefulness || null,
      reviewed ? 1 : 0,
      improved ? 1 : 0,
      screenshot_url || null,
      notes || null
    );

  const newRecord = db
    .prepare('SELECT * FROM capsules WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json(newRecord);
});

app.put('/api/capsules/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db
    .prepare('SELECT * FROM capsules WHERE id = ? AND user_id = ?')
    .get(id, req.userId);

  if (!existing) {
    return res.status(404).json({ error: 'Record not found or not yours' });
  }

  const {
    project_name,
    prompt_title,
    prompt_version,
    prompt_text,
    response_summary,
    category,
    usefulness,
    reviewed,
    improved,
    screenshot_url,
    notes,
  } = req.body;

  db.prepare(
    `UPDATE capsules SET
      project_name = ?, prompt_title = ?, prompt_version = ?, prompt_text = ?,
      response_summary = ?, category = ?, usefulness = ?, reviewed = ?,
      improved = ?, screenshot_url = ?, notes = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    project_name ?? existing.project_name,
    prompt_title ?? existing.prompt_title,
    prompt_version ?? existing.prompt_version,
    prompt_text ?? existing.prompt_text,
    response_summary ?? existing.response_summary,
    category ?? existing.category,
    usefulness ?? existing.usefulness,
    reviewed !== undefined ? (reviewed ? 1 : 0) : existing.reviewed,
    improved !== undefined ? (improved ? 1 : 0) : existing.improved,
    screenshot_url ?? existing.screenshot_url,
    notes ?? existing.notes,
    id,
    req.userId
  );

  const updated = db.prepare('SELECT * FROM capsules WHERE id = ?').get(id);
  res.json(updated);
});

app.delete('/api/capsules/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const result = db
    .prepare('DELETE FROM capsules WHERE id = ? AND user_id = ?')
    .run(id, req.userId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Record not found or not yours' });
  }

  res.json({ message: 'Deleted' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
