---
title: "Fuwari 博客部署：GitHub Actions + Nginx + Supervisor 自动化上线"
published: 2026-06-19
description: "从零搭建个人博客的 CI/CD 自动部署流程，推代码即上线。"
tags: ["部署", "GitHub Actions", "Nginx", "Supervisor"]
category: 技术
draft: false
---

# Fuwari 博客部署：推代码即上线

个人博客搭建完成后，最头疼的就是部署。每次改个错别字还得手动 SSH 上传文件？不存在的。

这篇文章记录了我如何用 GitHub Actions + Nginx + Supervisor 搭建一套「推代码即上线」的自动化部署流程。

## 整体架构

```
本地修改 → git push → GitHub Actions 自动构建 → rsync 上传服务器 → Supervisor 重启 → 上线
```

最终的请求链路：

```
用户浏览器 → Nginx (80端口) → 反向代理 → serve (8080) → 静态文件
```

## 为什么选这套方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 手动上传 | 简单 | 容易忘、容易错 |
| 服务器 Git Hook | 自动 | 服务器需开放 Git 端口，安全性差 |
| **GitHub Actions** | **免费、安全、有日志** | **首次配置稍复杂** |
| Vercel/Netlify | 零配置 | 国内访问慢，不够灵活 |

GitHub Actions 的好处：代码托管和 CI/CD 在同一平台，服务器不需要暴露 Git 端口，构建日志完整可查。

## 服务器准备

### 安装 Nginx

```bash
apt update && apt install -y nginx
systemctl enable nginx
```

### 安装 serve（静态文件服务器）

```bash
npm install -g serve
```

`serve` 是一个轻量 Node.js 静态文件服务器，比 Nginx 直接托管更灵活，且方便 Supervisor 管理进程。

### 配置 Supervisor

Supervisor 负责管理 `serve` 进程：崩溃自动重启、开机自启。

```ini
# /etc/supervisor/conf.d/fuwari-blog.conf
[program:fuwari-blog]
command=/usr/bin/serve -s /var/www/yunxing.fun -l 8080
directory=/var/www/yunxing.fun
autostart=true
autorestart=true
startsecs=3
startretries=5
stdout_logfile=/var/log/fuwari-blog.log
stderr_logfile=/var/log/fuwari-blog-error.log
user=root
```

```bash
supervisorctl reread && supervisorctl update
supervisorctl status  # 确认 fuwari-blog RUNNING
```

### 配置 Nginx 反向代理

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
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: pnpm build

      - name: Deploy via rsync
        uses: burnett01/rsync-deployments@7.0.1
        with:
          switches: -avz --delete
          path: dist/
          remote_path: /var/www/yunxing.fun/
          remote_host: ${{ secrets.SERVER_HOST }}
          remote_port: ${{ secrets.SERVER_PORT }}
          remote_user: ${{ secrets.SERVER_USER }}
          remote_key: ${{ secrets.SSH_PRIVATE_KEY }}

      - name: Restart blog service
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          port: ${{ secrets.SERVER_PORT }}
          script: |
            supervisorctl restart fuwari-blog
```

## GitHub Secrets 配置

服务器密码不能写在代码里，需要存到 GitHub Secrets：

```bash
gh secret set SSH_PRIVATE_KEY --body "$(cat ~/.ssh/github_deploy)"
gh secret set SERVER_HOST --body "117.72.100.178"
gh secret set SERVER_PORT --body "22"
gh secret set SERVER_USER --body "root"
```

SSH 密钥生成和部署：

```bash
# 本地生成密钥
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""

# 公钥添加到服务器
cat ~/.ssh/github_deploy.pub >> /root/.ssh/authorized_keys
```

## 工作流程

```
本地 git push
    ↓
GitHub Actions 启动 Ubuntu 虚拟机
    ↓
安装依赖 → pnpm build → 生成 dist/
    ↓
SSH + rsync 上传到 /var/www/yunxing.fun/
    ↓
SSH 执行 supervisorctl restart fuwari-blog
    ↓
约 2-3 分钟后上线
```

## 管理命令速查

```bash
supervisorctl status              # 查看所有服务状态
supervisorctl restart fuwari-blog  # 重启博客
supervisorctl stop fuwari-blog     # 停止博客
tail -f /var/log/fuwari-blog.log  # 查看日志
```

## 总结

整套方案的核心思路：**GitHub 管代码和构建，服务器只管运行**。

- 构建在 GitHub 云端完成，服务器不需要装 pnpm、Node.js 构建工具
- 服务器只装 `serve` + Nginx + Supervisor，职责单一
- 推代码 = 上线，零手动操作
