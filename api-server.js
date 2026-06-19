const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const API_DIR = '/var/www/blog-api';
const SITE_DIR = '/var/www/yunxing.fun';
const AUTH_TOKEN = 'admin.Aa@314159';

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

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/data/:filename — 读取数据
  if (req.method === 'GET' && url.pathname.startsWith('/api/data/')) {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });

    const filename = url.pathname.slice('/api/data/'.length);
    if (filename.includes('..') || !filename.endsWith('.json')) {
      return send(res, 400, { error: 'Invalid filename' });
    }

    // 读取数据
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

  // POST /api/data/:filename — 写入数据（同时写 public/data 和 src/data）
  if (req.method === 'POST' && url.pathname.startsWith('/api/data/')) {
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });

    const filename = url.pathname.slice('/api/data/'.length);
    if (filename.includes('..') || !filename.endsWith('.json')) {
      return send(res, 400, { error: 'Invalid filename' });
    }

    try {
      const body = await parseBody(req);
      const json = JSON.stringify(body, null, 2);

      const apiDataDir = path.join(API_DIR, 'data');
      const apiSrcDir = path.join(API_DIR, 'src-data');
      const siteDataDir = path.join(SITE_DIR, 'data');

      // 确保目录存在
      [apiDataDir, apiSrcDir, siteDataDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      });

      // 写入所有位置
      fs.writeFileSync(path.join(apiDataDir, filename), json, 'utf-8');
      fs.writeFileSync(path.join(apiSrcDir, filename), json, 'utf-8');
      fs.writeFileSync(path.join(siteDataDir, filename), json, 'utf-8');

      send(res, 200, { ok: true, filename });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
    return;
  }

  // GET /api/posts — 列出所有博客文章
  if (req.method === 'GET' && url.pathname === '/api/posts') {
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
