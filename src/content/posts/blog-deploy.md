---
title: "Fuwari 博客部署：GitHub Actions + Nginx + Supervisor 自动化上线"
published: 2026-06-19
description: "从零搭建个人博客的 CI/CD 自动部署流程，踩坑记录，推代码即上线。"
tags: ["部署", "GitHub Actions", "Nginx", "Supervisor"]
category: 技术
draft: false
---

# Fuwari 博客部署：推代码即上线

个人博客搭建完成后，最头疼的就是部署。每次改个错别字还得手动 SSH 上传文件？不存在的。

这篇文章记录了我如何用 GitHub Actions + Nginx + Supervisor 搭建一套「推代码即上线」的自动化部署流程，以及过程中踩过的坑。

## 整体架构

```
本地修改 → git push → GitHub Actions 自动构建 → rsync 上传服务器 → Supervisor 重启 → 上线
```

请求链路：

```
用户浏览器 → Nginx (80端口) → 反向代理 → serve (8080) → 静态文件
```

## 服务器准备

### 1. 安装 Nginx

```bash
apt update && apt install -y nginx
systemctl enable nginx
```

### 2. 安装 serve（静态文件服务器）

```bash
npm install -g serve
```

`serve` 是一个轻量 Node.js 静态文件服务器，比 Nginx 直接托管更灵活，且方便 Supervisor 管理进程。

### 3. 配置 Supervisor

Supervisor 负责管理 `serve` 进程：崩溃自动重启、开机自启。

```ini
# /etc/supervisor/conf.d/fuwari-blog.conf
[program:fuwari-blog]
command=/usr/bin/serve /var/www/yunxing.fun -l 8080
directory=/var/www/yunxing.fun
autostart=true
autorestart=true
startsecs=3
startretries=5
stdout_logfile=/var/log/fuwari-blog.log
stderr_logfile=/var/log/fuwari-blog-error.log
user=root
stopasgroup=true
killasgroup=true
```

```bash
supervisorctl reread && supervisorctl update
supervisorctl status  # 确认 fuwari-blog RUNNING
```

### 4. 配置 Nginx 反向代理

Nginx 监听 80 端口，把请求转发给 8080 的 serve：

```nginx
# /etc/nginx/sites-available/yunxing.fun
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/yunxing.fun /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## GitHub Actions 工作流

在项目根目录创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Server

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: pnpm build

      - name: Install sshpass
        run: sudo apt-get install -y sshpass

      - name: Deploy via rsync
        run: |
          sshpass -p "$SERVER_PASSWORD" rsync -avz --delete \
            -e "ssh -o StrictHostKeyChecking=no" \
            dist/ \
            ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}:/var/www/yunxing.fun/
        env:
          SERVER_PASSWORD: ${{ secrets.SERVER_PASSWORD }}

      - name: Restart blog
        run: |
          sshpass -p "$SERVER_PASSWORD" ssh -o StrictHostKeyChecking=no \
            ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }} \
            "supervisorctl restart fuwari-blog"
        env:
          SERVER_PASSWORD: ${{ secrets.SERVER_PASSWORD }}
```

## GitHub Secrets 配置

敏感信息存到 GitHub Secrets，不能写在代码里：

```bash
gh secret set SERVER_HOST --body "117.72.100.178"
gh secret set SERVER_PORT --body "22"
gh secret set SERVER_USER --body "root"
gh secret set SERVER_PASSWORD --body "你的服务器密码"
```

## 踩坑记录

### 坑 1：SSH 密钥认证失败（Windows 特有）

最初用 SSH 密钥认证，但 GitHub Actions 一直报 `Permission denied`。

**原因**：Windows PowerShell 读取多行 SSH 私钥时，会把 `\n` 转成 `\r\n`（CRLF），导致密钥文件格式被破坏。GitHub Actions 的 Docker 容器内 SSH 客户端直接拒绝这个损坏的密钥。

**解决**：放弃密钥认证，改用 `sshpass + 密码认证`。密码是单行字符串，不存在换行符问题：

```yaml
- name: Install sshpass
  run: sudo apt-get install -y sshpass

- name: Deploy via rsync
  run: |
    sshpass -p "$SERVER_PASSWORD" rsync -avz --delete \
      -e "ssh -o StrictHostKeyChecking=no" \
      dist/ \
      ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}:/var/www/yunxing.fun/
  env:
    SERVER_PASSWORD: ${{ secrets.SERVER_PASSWORD }}
```

### 坑 2：`serve -s` 导致页面跳转失效

部署后发现所有链接点击都没反应，页面不跳转。

**原因**：`serve -s` 启用了 SPA（单页应用）模式，会把所有请求都重定向到 `index.html`。但 Astro 生成的是多页静态站，每个路由都有独立的 `index.html`。

**解决**：去掉 `-s` 参数：

```diff
- command=/usr/bin/serve -s /var/www/yunxing.fun -l 8080
+ command=/usr/bin/serve /var/www/yunxing.fun -l 8080
```

### 坑 3：pnpm 版本冲突

GitHub Actions 报错 `Multiple versions of pnpm specified`。

**原因**：`package.json` 里声明了 `"packageManager": "pnpm@9.14.4"`，工作流里又手动指定 `version: 9`，两者冲突。

**解决**：工作流里去掉 `version` 参数，让 pnpm action 自动读取 `package.json`：

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  # 不指定 version，自动从 package.json 读取
```

### 坑 4：Nginx `$uri` 变量被 PowerShell 吃掉

通过 PowerShell heredoc 写 Nginx 配置时，`$uri` 被 PowerShell 当变量解析成空字符串，导致 `try_files` 指令错误，页面出现 301 重定向循环。

**解决**：用 base64 编码传输配置文件，避免 PowerShell 变量替换：

```powershell
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($content))
echo y | plink -ssh root@server -pw "pass" "echo '$base64' | base64 -d > /etc/nginx/sites-available/yunxing.fun"
```

## 工作流程总结

```
本地 git push
    ↓
GitHub Actions 启动 Ubuntu 虚拟机
    ↓
安装依赖 → pnpm build → 生成 dist/
    ↓
sshpass + rsync 上传到 /var/www/yunxing.fun/
    ↓
sshpass + ssh 执行 supervisorctl restart fuwari-blog
    ↓
约 2-3 分钟后上线
```

## 管理命令速查

```bash
supervisorctl status              # 查看所有服务状态
supervisorctl restart fuwari-blog  # 重启博客
supervisorctl stop fuwari-blog     # 停止博客
tail -f /var/log/fuwari-blog.log  # 查看日志
tail -f /var/log/fuwari-blog-error.log  # 查看错误日志
```

## 总结

整套方案的核心思路：**GitHub 管代码和构建，服务器只管运行**。

- 构建在 GitHub 云端完成，服务器不需要装 pnpm、Node.js 构建工具
- 服务器只装 `serve` + Nginx + Supervisor，职责单一
- 推代码 = 上线，零手动操作
- **Windows 用户注意**：SSH 密钥认证有 CRLF 坑，用密码认证更省心
