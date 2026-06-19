const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3001;
const API_DIR = '/var/www/blog-api';
const SITE_DIR = '/var/www/yunxing.fun';
const AUTH_TOKEN = 'admin.Aa@314159';
const COMMENTS_DIR = path.join(API_DIR, 'comments');
const RATE_LIMIT_FILE = path.join(COMMENTS_DIR, '_ratelimit.json');
const MAX_COMMENTS_PER_DAY = 10;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function checkAuth(req) {
  const auth = req.headers.authorization;
  return auth === `Bearer ${AUTH_TOKEN}`;
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])).trim().slice(0, 2000);
}

function getCommentsFile(type, id) {
  const safeName = String(id).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
  return path.join(COMMENTS_DIR, `${type}_${safeName}.json`);
}

function readComments(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {}
  return [];
}

function writeComments(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

function loadRateLimit() {
  try {
    if (fs.existsSync(RATE_LIMIT_FILE)) {
      return JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveRateLimit(data) {
  const dir = path.dirname(RATE_LIMIT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function checkRateLimit(ip) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const data = loadRateLimit();

  if (!data[ip]) data[ip] = [];
  data[ip] = data[ip].filter(ts => now - ts < dayMs);

  if (data[ip].length >= MAX_COMMENTS_PER_DAY) {
    saveRateLimit(data);
    return false;
  }

  data[ip].push(now);
  saveRateLimit(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ========== Public Comment API (no auth) ==========

  // GET /api/comments/:type/:id — 获取评论
  if (req.method === 'GET' && /^\/api\/comments\/([^/]+)\/([^/]+)$/.test(pathname)) {
    const m = pathname.match(/^\/api\/comments\/([^/]+)\/([^/]+)$/);
    const filePath = getCommentsFile(m[1], decodeURIComponent(m[2]));
    const comments = readComments(filePath);
    return send(res, 200, { data: comments, total: comments.length });
  }

  // POST /api/comments/:type/:id — 发表评论
  if (req.method === 'POST' && /^\/api\/comments\/([^/]+)\/([^/]+)$/.test(pathname)) {
    try {
      const m = pathname.match(/^\/api\/comments\/([^/]+)\/([^/]+)$/);
      const type = m[1];
      const id = decodeURIComponent(m[2]);
      const body = await parseBody(req);

      if (!body.name || !body.content) {
        return send(res, 400, { error: '昵称和内容不能为空' });
      }

      const ip = getClientIP(req);
      if (!checkRateLimit(ip)) {
        return send(res, 429, { error: `今天评论次数已达上限（${MAX_COMMENTS_PER_DAY}次/天），请明天再来` });
      }

      const comment = {
        id: crypto.randomUUID(),
        name: sanitize(body.name).slice(0, 50),
        content: sanitize(body.content).slice(0, 2000),
        timestamp: new Date().toISOString(),
      };

      const filePath = getCommentsFile(type, id);
      const comments = readComments(filePath);
      comments.push(comment);
      writeComments(filePath, comments);

      send(res, 200, { ok: true, comment });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // ========== Public Guestbook API (no auth) ==========

  // GET /api/guestbook — 获取留言
  if (req.method === 'GET' && pathname === '/api/guestbook') {
    const filePath = path.join(COMMENTS_DIR, 'guestbook.json');
    const messages = readComments(filePath);
    return send(res, 200, { data: messages, total: messages.length });
  }

  // POST /api/guestbook — 发表留言
  if (req.method === 'POST' && pathname === '/api/guestbook') {
    try {
      const body = await parseBody(req);

      if (!body.name || !body.content) {
        return send(res, 400, { error: '昵称和内容不能为空' });
      }

      const ip = getClientIP(req);
      if (!checkRateLimit(ip)) {
        return send(res, 429, { error: `今天评论次数已达上限（${MAX_COMMENTS_PER_DAY}次/天），请明天再来` });
      }

      const message = {
        id: crypto.randomUUID(),
        name: sanitize(body.name).slice(0, 50),
        content: sanitize(body.content).slice(0, 2000),
        timestamp: new Date().toISOString(),
      };

      const filePath = path.join(COMMENTS_DIR, 'guestbook.json');
      const messages = readComments(filePath);
      messages.push(message);
      writeComments(filePath, messages);

      send(res, 200, { ok: true, message });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // ========== Admin API (auth required) ==========

  // GET /api/data/:filename — 读取数据
  if (req.method === 'GET' && pathname.startsWith('/api/data/')) {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });

    const filename = pathname.slice('/api/data/'.length);
    if (filename.includes('..') || !filename.endsWith('.json')) {
      return send(res, 400, { error: 'Invalid filename' });
    }

    const apiPath = path.join(API_DIR, 'data', filename);
    const apiSrcPath = path.join(API_DIR, 'src-data', filename);

    let filePath = null;
    if (fs.existsSync(apiPath)) filePath = apiPath;
    else if (fs.existsSync(apiSrcPath)) filePath = apiSrcPath;
    else return send(res, 404, { error: 'File not found' });

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      send(res, 200, { data: JSON.parse(content) });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // POST /api/data/:filename — 写入数据
  if (req.method === 'POST' && pathname.startsWith('/api/data/')) {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });

    const filename = pathname.slice('/api/data/'.length);
    if (filename.includes('..') || !filename.endsWith('.json')) {
      return send(res, 400, { error: 'Invalid filename' });
    }

    try {
      const body = await parseBody(req);
      const json = JSON.stringify(body, null, 2);

      const apiDataDir = path.join(API_DIR, 'data');
      const apiSrcDir = path.join(API_DIR, 'src-data');
      const siteDataDir = path.join(SITE_DIR, 'data');

      [apiDataDir, apiSrcDir, siteDataDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      });

      fs.writeFileSync(path.join(apiDataDir, filename), json, 'utf-8');
      fs.writeFileSync(path.join(apiSrcDir, filename), json, 'utf-8');
      fs.writeFileSync(path.join(siteDataDir, filename), json, 'utf-8');

      send(res, 200, { ok: true, filename });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // GET /api/posts
  if (req.method === 'GET' && pathname === '/api/posts') {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });

    try {
      const postsDir = path.join(API_DIR, 'src', 'content', 'posts');
      if (!fs.existsSync(postsDir)) return send(res, 200, { data: [] });

      const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
      const posts = files.map(f => {
        const content = fs.readFileSync(path.join(postsDir, f), 'utf-8');
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        const meta = {};
        if (match) {
          match[1].split('\n').forEach(line => {
            const [k, ...v] = line.split(':');
            if (k && v.length) meta[k.trim()] = v.join(':').trim().replace(/^["']|["']$/g, '');
          });
        }
        return { slug: f.replace(/\.(md|mdx)$/, ''), file: f, ...meta };
      });

      send(res, 200, { data: posts });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`API server running on http://127.0.0.1:${PORT}`);
});
