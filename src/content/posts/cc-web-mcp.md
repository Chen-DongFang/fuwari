---
title: "Claude Code 联网能力补全：CC-Web-MCP 优化实践"
published: 2026-06-17
description: "基于 CC-Web-MCP 的优化版本，让 Claude Code 接入 DeepSeek、Qwen 等第三方模型时也能联网搜索。"
tags: ["MCP", "Claude Code", "Python", "AI工具"]
category: 技术
draft: false
---

# Claude Code 联网能力补全：CC-Web-MCP 优化实践

## 背景

Claude Code 是一个非常强大的 AI 编程助手，但它有一个限制：当接入 DeepSeek、Qwen、Kimi 等第三方模型时，这些模型**没有官方的 WebSearch/WebFetch 能力**，无法联网搜索。

这意味着你用 Claude Code + DeepSeek 写代码时，模型无法查阅最新的 API 文档、无法搜索报错信息、无法了解最新的技术动态——相当于被关在了一个信息孤岛里。

## CC-Web-MCP 是什么

[CC-Web-MCP](https://github.com/JcDizzy/CC-Web-MCP) 是一个本地 MCP 工具链，专门为 Claude Code 补上这个缺口。

它提供四个核心工具：

| 工具 | 功能 |
|------|------|
| `web_search` | 搜索公开网页 |
| `fetch_url` | 抓取网页内容并转为 Markdown |
| `research_brief` | 快速调研，搜索并提取关键摘要 |
| `health_check` | 检查依赖和网络连通性 |

安装后，模型会自动调用这些工具来获取网络信息，开发者无需额外操作。

## 我做了什么优化

我基于原版做了一系列优化，已提交 PR 至原仓库。

### 速度优化

- **并行搜索**：同时请求 DuckDuckGo + Bing，搜索速度翻倍
- **超时缩短**：从 15s 降到 8s，后端卡住时不再傻等
- **缓存延长**：相同查询 10 分钟内直接返回缓存
- **抓取量增加**：单次抓取从 10000 字符提升到 15000，减少分页

### 调用主动性优化

原版的工具描述偏保守，模型经常"不敢"主动调用。我做了以下调整：

- 工具描述从"仅供第三方模型使用"改为正向功能说明
- MCP 指令从"不要主动使用"改为"当需要获取最新信息时，应主动使用"
- CLAUDE.md 模板从英文否定指令改为中文正向引导

效果：模型现在会更主动地使用联网能力，而不是等到开发者明确要求才去搜索。

### 配套修复

- 更新 doctor 检查逻辑，适配新的 CLAUDE.md 模板
- 全部 201 个测试通过

## 快速上手

```bash
# 安装
uvx cc-web-mcp init --runner uvx

# 验证
uvx cc-web-mcp doctor
```

安装完成后重启 Claude Code，直接在对话中使用即可：

```
帮我搜索一下 Astro 5.x 的最新 API 变化
```

模型会自动调用 `mcp__cc-web__web_search` 或 `mcp__cc-web__research_brief`。

## 技术栈

- **Python 3.11+**
- **FastMCP** — MCP Server 框架
- **httpx** — 异步 HTTP 客户端
- **beautifulsoup4** — HTML 解析
- **markdownify** — HTML 转 Markdown

搜索后端默认按 `DuckDuckGo → Bing → Bing_cn` 顺序尝试，也支持自定义 API。

## 安全特性

- 默认禁止抓取内网地址
- DNS 解析后二次校验 IP
- 302 重定向后再次安全检查
- 反爬检测和诊断

## 项目地址

[https://github.com/Chen-DongFang/Claude-code-to-Browser](https://github.com/Chen-DongFang/Claude-code-to-Browser)

如果你也在用 Claude Code + 第三方模型，可以试试这个工具。有问题欢迎提 Issue。
