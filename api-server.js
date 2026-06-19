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
const VISITORS_FILE = path.join(API_DIR, 'data', 'visitors.json');
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

const MUSIC_DIR = path.join(SITE_DIR, 'music');
const MUSIC_JSON = path.join(API_DIR, 'data', 'music.json');

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type']?.match(/boundary=(.+)/)?.[1];
    if (!boundary) return reject(new Error('No boundary'));
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const boundaryBuf = Buffer.from('--' + boundary);
      const files = [];
      const fields = {};
      let pos = 0;
      while (pos < buf.length) {
        const start = buf.indexOf(boundaryBuf, pos);
        if (start === -1) break;
        const nextStart = buf.indexOf(boundaryBuf, start + boundaryBuf.length);
        if (nextStart === -1) break;
        const part = buf.slice(start + boundaryBuf.length, nextStart);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) { pos = nextStart; continue; }
        const headers = part.slice(0, headerEnd).toString('utf-8');
        const body = part.slice(headerEnd + 4, part.length - 2);
        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        if (filenameMatch && nameMatch) {
          files.push({ name: nameMatch[1], filename: filenameMatch[1], data: body });
        } else if (nameMatch) {
          fields[nameMatch[1]] = body.toString('utf-8');
        }
        pos = nextStart;
      }
      resolve({ files, fields });
    });
    req.on('error', reject);
  });
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

  // GET /api/site-data — public endpoint for site data (no auth)
  if (req.method === 'GET' && pathname === '/api/site-data') {
    try {
      const filePath = path.join(API_DIR, 'data', 'site-data.json');
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return send(res, 200, data);
      }
      return send(res, 200, {});
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

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

  // DELETE /api/guestbook/:commentId — 删除留言 (auth required)
  if (req.method === 'DELETE' && pathname.startsWith('/api/guestbook/')) {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      const commentId = pathname.slice('/api/guestbook/'.length);
      const filePath = path.join(COMMENTS_DIR, 'guestbook.json');
      const messages = readComments(filePath);
      const filtered = messages.filter(m => m.id !== commentId);
      if (filtered.length === messages.length) return send(res, 404, { error: 'Not found' });
      writeComments(filePath, filtered);
      send(res, 200, { ok: true });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // DELETE /api/comments/:type/:id/:commentId — 删除评论 (auth required)
  if (req.method === 'DELETE' && /^\/api\/comments\/([^/]+)\/([^/]+)\/([^/]+)$/.test(pathname)) {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      const m = pathname.match(/^\/api\/comments\/([^/]+)\/([^/]+)\/([^/]+)$/);
      const filePath = getCommentsFile(m[1], decodeURIComponent(m[2]));
      const commentId = m[3];
      const comments = readComments(filePath);
      const filtered = comments.filter(c => c.id !== commentId);
      if (filtered.length === comments.length) return send(res, 404, { error: 'Not found' });
      writeComments(filePath, filtered);
      send(res, 200, { ok: true });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // GET /api/comments/list — 列出所有评论文件 (auth required)
  if (req.method === 'GET' && pathname === '/api/comments/list') {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      const files = fs.readdirSync(COMMENTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      const result = [];
      for (const f of files) {
        const data = readComments(path.join(COMMENTS_DIR, f));
        const name = f.replace('.json', '');
        result.push({ file: f, name, count: data.length, data });
      }
      send(res, 200, { data: result });
    } catch (e) { send(res, 500, { error: e.message }); }
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

  // ========== Public Visitor API (no auth) ==========

  // POST /api/visitor — record a visit
  if (req.method === 'POST' && pathname === '/api/visitor') {
    try {
      const body = await parseBody(req);
      const ip = getClientIP(req);
      const entry = {
        ip: ip,
        path: sanitize(body.path || '/'),
        ua: sanitize((req.headers['user-agent'] || '').slice(0, 200)),
        timestamp: new Date().toISOString(),
      };
      let visitors = [];
      try { if (fs.existsSync(VISITORS_FILE)) visitors = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf-8')); } catch {}
      visitors.push(entry);
      if (visitors.length > 5000) visitors = visitors.slice(-5000);
      const dir = path.dirname(VISITORS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(VISITORS_FILE, JSON.stringify(visitors, null, 2), 'utf-8');
      send(res, 200, { ok: true });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // GET /api/visitor — list visitors (auth required)
  if (req.method === 'GET' && pathname === '/api/visitor') {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      let visitors = [];
      try { if (fs.existsSync(VISITORS_FILE)) visitors = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf-8')); } catch {}
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      send(res, 200, { data: visitors.slice().reverse().slice(offset, offset + limit), total: visitors.length });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // ========== Admin Music API ==========

  // GET /api/music — list tracks
  if (req.method === 'GET' && pathname === '/api/music') {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      let tracks = [];
      if (fs.existsSync(MUSIC_JSON)) tracks = JSON.parse(fs.readFileSync(MUSIC_JSON, 'utf-8'));
      send(res, 200, { data: tracks });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // POST /api/music/upload — upload audio file
  if (req.method === 'POST' && pathname === '/api/music/upload') {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });
      const { files, fields } = await parseMultipart(req);
      if (!files.length) return send(res, 400, { error: 'No file' });
      let tracks = [];
      if (fs.existsSync(MUSIC_JSON)) tracks = JSON.parse(fs.readFileSync(MUSIC_JSON, 'utf-8'));

      const results = [];
      for (const f of files) {
        const safeName = f.filename.replace(/[^\w\u4e00-\u9fff\-(). ]/g, '_');
        const destPath = path.join(MUSIC_DIR, safeName);
        fs.writeFileSync(destPath, f.data);
        const title = fields.title || safeName.replace(/\.[^/.]+$/, '');
        const artist = fields.artist || '未知艺术家';
        const track = { id: crypto.randomUUID(), title, artist, file: '/music/' + safeName };
        tracks.push(track);
        results.push(track);
      }
      const json = JSON.stringify(tracks, null, 2);
      fs.writeFileSync(MUSIC_JSON, json, 'utf-8');
      const siteMusicJson = path.join(SITE_DIR, 'data', 'music.json');
      try { fs.writeFileSync(siteMusicJson, json, 'utf-8'); } catch {}
      send(res, 200, { ok: true, tracks: results });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // POST /api/music/reorder — save track order
  if (req.method === 'POST' && pathname === '/api/music/reorder') {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      const body = await parseBody(req);
      const json = JSON.stringify(body, null, 2);
      fs.writeFileSync(MUSIC_JSON, json, 'utf-8');
      const siteMusicJson = path.join(SITE_DIR, 'data', 'music.json');
      try { fs.writeFileSync(siteMusicJson, json, 'utf-8'); } catch {}
      send(res, 200, { ok: true });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  // DELETE /api/music/:id — delete track
  if (req.method === 'DELETE' && pathname.startsWith('/api/music/')) {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    try {
      const id = pathname.slice('/api/music/'.length);
      let tracks = [];
      if (fs.existsSync(MUSIC_JSON)) tracks = JSON.parse(fs.readFileSync(MUSIC_JSON, 'utf-8'));
      const idx = tracks.findIndex(t => t.id === id);
      if (idx === -1) return send(res, 404, { error: 'Not found' });
      const removed = tracks.splice(idx, 1)[0];
      // delete file
      if (removed.file) {
        const filePath = path.join(SITE_DIR, removed.file);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      const json = JSON.stringify(tracks, null, 2);
      fs.writeFileSync(MUSIC_JSON, json, 'utf-8');
      const siteMusicJson = path.join(SITE_DIR, 'data', 'music.json');
      try { fs.writeFileSync(siteMusicJson, json, 'utf-8'); } catch {}
      send(res, 200, { ok: true });
    } catch (e) { send(res, 500, { error: e.message }); }
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`API server running on http://127.0.0.1:${PORT}`);
});
