# Claudegram - Product Requirements Document

## Overview

Claudegram allows用户通过一个 Telegram Bot，远程接收和响应多个并发 Claude Code 会话的决策请求。

## Problem Statement

当同时运行 5-6 个 Claude Code 会话时，用户需要不断在终端窗口之间切换来响应权限提示和决策请求：
- 上下文切换开销大
- 后台会话的提示容易被忽略
- 会话因等待用户注意力而被阻塞，而用户并不知道

最常见的阻塞事件是 Claude Code 的**原生权限提示**：

```
Do you want to overwrite architecture_overview.md?
  1. Yes
  2. Yes, allow all edits during this session (shift+tab)
  3. No
```

```
Allow Bash command: npm test?
  1. Yes
  2. Yes, allow all Bash commands during this session
  3. No
```

这些提示会冻结会话，直到用户在终端中响应。

## Target User

单用户，本地运行，同时管理多个 Claude Code 会话的开发者。

---

## Core Features

### F1: Session Registration

每个新的 Claude Code 会话启动时，用户可以通过指令将该会话注册到 Claudegram，并指定一个会话名称（如 "api-refactor"、"fix-auth"）。

**Requirements:**
- 用户指定一个人类可读的会话名称
- 同一名称不能被两个活跃会话同时使用
- 如果同名会话已不活跃（30 分钟无交互），可以被替换
- 注册成功后，Telegram 收到通知：`Session registered: api-refactor`
- 会话结束时自动注销，Telegram 收到通知：`Session ended: api-refactor`

### F2: Native Permission Prompt Forwarding

Claude Code 的所有原生权限提示自动转发到 Telegram，无需用户或 Claude 额外操作。

**Supported permission types:**

| Permission Type | Telegram Buttons |
|----------------|-----------------|
| File edit/write | `Yes` · `Yes, allow all edits this session` · `No` |
| Bash command | `Yes` · `Yes, allow all Bash this session` · `No` |
| MCP tool use | `Yes` · `Yes, allow all MCP this session` · `No` |

**Requirements:**
- 权限提示到达后**立即**推送到 Telegram
- 消息包含：会话名称、权限类型、具体操作描述
- 选项以 Telegram inline keyboard buttons 呈现
- 用户点击按钮后，会话立即恢复执行
- `Yes, allow all` 选项等同于终端中的 `shift+tab`，授予该类别的会话级权限
- 如果用户不响应，权限提示在 TTL 过期后视为拒绝（默认 5 分钟）
- 用户只能点击一次，点击后按钮消失，消息更新为已回答状态

### F3: Custom Decision Requests

除原生权限外，Claude Code 也可以主动向用户推送自定义决策请求（2-6 个选项）。

**Requirements:**
- 支持 2-6 个自定义选项
- 每个选项有唯一 ID 和显示文本
- 消息包含：会话名称、标题、详细描述、选项按钮
- 用户选择后，Claude Code 获取选择结果并继续
- 支持 TTL 过期（默认 5 分钟），过期视为"用户选择不操作"
- 用户也可以主动取消决策

### F4: Multi-Session Routing

一个 Telegram Bot 同时服务多个 Claude Code 会话，消息路由到正确的会话。

**Requirements:**
- 所有会话共享同一个 Telegram Bot
- 每条 Telegram 消息明确标识来源会话
- 用户的响应精确路由回发起请求的会话
- 不同会话的决策请求互不干扰
- 支持同时存在多个 pending 决策（来自不同会话）

### F5: Session Lifecycle Management

**Requirements:**
- 用户可以查看所有活跃会话及其状态
- 用户可以查看所有待处理的决策
- 用户可以取消单个决策或全部决策
- 会话异常断开时自动清理

---

## Telegram Bot Behavior

### Commands

| Command | Description |
|---------|-------------|
| `/sessions` | 查看所有活跃会话 |
| `/pending` | 查看所有待处理决策 |
| `/cancel <id>` | 取消某个决策 |
| `/cancel_all` | 取消所有待处理决策 |

### Message Format — Permission Prompt

```
[api-refactor] Edit Permission

Overwrite architecture_overview.md?

[Yes]  [Yes, all edits]  [No]
```

```
[fix-auth] Bash Permission

Run: npm test --coverage

[Yes]  [Yes, all Bash]  [No]
```

用户点击后：
```
[api-refactor] Edit Permission

Overwrite architecture_overview.md?

Answered: Yes, all edits
```

### Message Format — Custom Decision

```
[new-feature] Architecture Choice

Should I split the payment module into
separate services or keep it monolithic?

[Split into services]  [Keep monolithic]  [Skip]
```

用户点击后：
```
[new-feature] Architecture Choice

Should I split the payment module into
separate services or keep it monolithic?

Answered: Split into services
```

### Security

- 仅预配置的 Telegram user ID 可以交互（allowlist）
- 单用户场景，无需多用户认证
- 非授权用户的消息静默丢弃

---

## User Workflow

### Typical Usage

```
1. 启动 Claudegram 服务（一次性）
2. 开启 Claude Code 会话 A → "Register as api-refactor"
3. 开启 Claude Code 会话 B → "Register as fix-auth"
4. 会话 A 遇到权限提示 → Telegram: "[api-refactor] Overwrite X? [Yes][Yes All][No]"
5. 会话 B 遇到权限提示 → Telegram: "[fix-auth] Run npm test? [Yes][Yes All][No]"
6. 用户在手机上点击按钮 → 对应会话恢复执行
7. 会话结束 → Telegram: "Session ended: api-refactor"
```

### "No Response = No Action" Semantics

- 所有决策请求都有 TTL（默认 5 分钟）
- TTL 过期后，视为用户选择不操作
- Claude Code 应当优雅处理过期情况（不执行被请求的操作）

---

## Non-Goals (v1)

- **不是聊天桥**：不在 Telegram 和 Claude Code 之间转发任意消息
- **不是任务触发器**：不从 Telegram 触发新的 Claude Code 会话
- **不是多用户系统**：单用户，单 Bot
- **不是云服务**：仅在用户本地机器运行

---

## Milestones

### v0.1 - Core Loop
- [ ] 多会话注册与注销
- [ ] 原生权限提示自动转发到 Telegram（含 Yes / Yes All / No 按钮）
- [ ] 用户点击按钮后会话恢复
- [ ] TTL 过期处理
- [ ] 多会话消息路由

### v0.2 - Custom Decisions + Polish
- [ ] 自定义决策请求（任意多选项）
- [ ] Telegram `/sessions`、`/pending`、`/cancel` 命令
- [ ] 会话空闲检测与自动清理
- [ ] 服务重启后状态恢复
- [ ] 优雅关闭（取消所有 pending，通知 Telegram）

### v1.0 - Production Ready
- [ ] 开机自启动
- [ ] Telegram API 故障恢复与重连
- [ ] 防刷限流
- [ ] 完整日志
- [ ] CLI 管理命令：`start`、`stop`、`status`、`configure`
