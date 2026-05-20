# Cove Atomic API — 从 Discord 实际用法提炼

> 基于 discord-usage-audit.md，把所有场景的操作归纳为可复用的原子接口。
> 这些接口是 Cove 的"积木"——每个场景是一组积木的组合。

## 1. Messaging（消息）

已有的基础，所有场景都用。

| 接口 | 描述 | 已有 | 用到的场景 |
|---|---|---|---|
| `POST /channels/:id/messages` | 发消息 | ✅ | 全部 |
| `GET /channels/:id/messages` | 拉消息（需加分页 before/after） | ⚠️ 缺分页 | 全部 |
| `DELETE /channels/:id/messages/:msgId` | 删单条消息 | ❌ | — |
| `PATCH /channels/:id/messages/:msgId` | 编辑消息 | ❌ | — |
| `WS MESSAGE_CREATE` | 实时消息推送 | ✅ | 全部 |
| `WS TYPING_START` | 正在输入 | ❌ | Home |

## 2. Channel（场景）

| 接口 | 描述 | 已有 | 用到的场景 |
|---|---|---|---|
| `GET /guilds/:id/channels` | 列出所有场景 | ✅ | Home(patrol), 全局导航 |
| `GET /channels/:id` | 场景详情 | ✅ | 全部 |
| `POST /guilds/:id/channels` | 创建场景 | ✅ | 动态新增 |
| `DELETE /channels/:id` | 删除场景 | ✅ | 清理 |
| `PATCH /channels/:id` | 更新场景信息（名称/图标/描述） | ❌ | 全部 |

## 3. State（场景状态 — key/value）

每个场景的结构化数据。这是 Cove 独有的，不是 Discord 的。

| 接口 | 描述 | 已有 | 用到的场景 |
|---|---|---|---|
| `GET /channels/:id/state` | 获取场景全部状态 | ✅ | 全部 |
| `PUT /channels/:id/state` | upsert 单个 key | ✅ | 全部 |
| `DELETE /channels/:id/state/:key` | 删除单个 key | ❌ | — |
| `WS STATE_UPDATE` | 状态变更实时推送 | ❌ | 需要 |

**实际用法举例：**
- 🌱 Garden: `{ plants: [...], lastWatered: "2026-05-20" }`
- 💰 Finance: `{ portfolio: {...}, todayPnL: "+2.3%" }`
- 🔨 Workshop: `{ openPRs: 30, todaySubmitted: 2 }`
- 🏃 Track: `{ lastRun: "5.2km", weekTotal: "23km" }`

## 4. Scheduled Tasks（定时任务）

现在全靠 OpenClaw cron，用户完全不可见。Cove 需要暴露出来。

| 接口 | 描述 | 已有 | 用到的场景 |
|---|---|---|---|
| `GET /channels/:id/tasks` | 列出场景绑定的定时任务 | ❌ | 全部有 cron 的场景 |
| `GET /tasks/:id` | 任务详情（schedule, 上次运行, 状态） | ❌ | 全部 |
| `POST /channels/:id/tasks` | 创建定时任务 | ❌ | 动态创建 |
| `PATCH /tasks/:id` | 更新任务（改时间、开关） | ❌ | 全部 |
| `DELETE /tasks/:id` | 删除任务 | ❌ | 清理 |
| `POST /tasks/:id/run` | 手动触发一次 | ❌ | 调试/按需 |
| `GET /tasks/:id/runs` | 运行历史 | ❌ | 全部 |

**实际用法举例：**
- 🌱 Garden: 浇水提醒 7:00, 可改成 8:00
- 💰 Finance: 行情抓取频率可调
- 🔨 Workshop: 打工循环可暂停/恢复

## 5. Data Feed（数据源）

各场景依赖的外部数据。现在是 cron 里硬编码调用脚本，Cove 应该抽象为数据源。

| 接口 | 描述 | 用到的场景 |
|---|---|---|
| `GET /channels/:id/feeds` | 列出场景绑定的数据源 | 全部 |
| `GET /feeds/:id/latest` | 获取数据源最新值 | 全部 |
| `POST /feeds/:id/refresh` | 手动刷新 | 按需 |

**实际数据源清单：**

| 数据源 | 类型 | 场景 | 现在怎么取 |
|---|---|---|---|
| 天气 | HTTP API | Garden | wttr.in curl |
| GitHub notifications | REST API | GitHub Inbox | gh api notifications |
| GitHub PR status | REST API | Workshop | gh pr list |
| Gmail inbox | OAuth API | Post Office | patrol.py (Gmail API) |
| 股票行情 (A股) | Python lib | Finance | akshare via market_lite.py |
| 股票行情 (美股) | Python lib | Finance | akshare |
| 模拟盘持仓 | 本地文件 | Finance | auto_trader.py 读写 |
| COROS 运动 | OAuth API | Track | COROS MCP |
| GitHub trending | Web scrape | School | web_search |
| 植物档案 | 本地文件 | Garden | garden/plants/*.md |
| 知识卡片 | 本地文件 | School | wiki/cards/*.md |
| PR 统计 | CLI 工具 | Workshop | gogetajob stats |
| 邮局信件 | Git repo | Harbor | lobster-post repo |
| 表情包库 | Git repo | Arcade | memes repo |
| memory 日志 | 本地文件 | Lab | memory/*.md |
| DNA 文件 | 本地文件 | Lab | AGENTS.md, SOUL.md |

## 6. Agent（Agent 交互）

现在 agent 回复通过 OpenClaw plugin → cron announce delivery。Cove 需要原生支持。

| 接口 | 描述 | 已有 | 用到的场景 |
|---|---|---|---|
| `POST /channels/:id/agent` | 在场景内触发 agent（等同给 agent 发消息） | ⚠️ 通过 plugin | 全部 |
| `GET /channels/:id/agent/status` | agent 在此场景的状态（idle/thinking/working） | ❌ | 全部 |
| `WS AGENT_TYPING` | agent 正在生成 | ❌ | 全部 |
| `WS AGENT_STATUS_CHANGE` | agent 状态变更 | ❌ | 全部 |

## 7. Media（媒体）

| 接口 | 描述 | 已有 | 用到的场景 |
|---|---|---|---|
| `POST /channels/:id/media` | 上传图片/文件到场景 | ❌ | Canvas, Memes, Writing Desk |
| `GET /media/:id` | 获取媒体文件 | ❌ | 同上 |
| `POST /media/generate` | 触发生图（ComfyUI） | ❌ | Canvas |
| `POST /media/tts` | 触发语音合成（ElevenLabs） | ❌ | Writing Desk |

## 8. Workflow（工作流）

FlowForge 在多个场景驱动复杂流程。

| 接口 | 描述 | 用到的场景 |
|---|---|---|
| `GET /channels/:id/workflows` | 场景绑定的 workflow | Workshop, School, Lab |
| `GET /workflows/:id/status` | workflow 当前状态/进度 | 同上 |
| `POST /workflows/:id/start` | 启动 workflow | 同上 |
| `POST /workflows/:id/next` | 推进到下一步 | 同上 |

## 9. User（用户）

| 接口 | 描述 | 已有 | 用到的场景 |
|---|---|---|---|
| `GET /users/@me` | 当前用户 | ✅ | 全局 |
| `GET /channels/:id/presence` | 谁在这个场景里 | ❌ | 全局 |
| `PUT /users/@me/presence` | 更新自己的位置/状态 | ❌ | 全局 |
| `WS PRESENCE_UPDATE` | 在线/位置变更推送 | ❌ | 全局 |

## 10. Cross-Scene（跨场景）

跨场景配合是 Cove 的核心差异化。

| 接口 | 描述 | 用到的场景 |
|---|---|---|
| `GET /links` | 跨场景数据引用（花 → 照片） | Garden↔Canvas |
| `POST /links` | 创建跨场景引用 | 全链路场景 |
| `GET /dashboard` | 全局状态看板（所有场景的摘要） | Home |
| `GET /timeline` | 跨场景时间线（今天各场景发生了什么） | Home |

---

## 场景 = 积木组合

每个场景是上述原子接口的一个子集：

| 场景 | Messaging | State | Tasks | Feeds | Agent | Media | Workflow |
|---|---|---|---|---|---|---|---|
| 🏠 Home | ✅ | ✅ | ✅ | ✅(汇总) | ✅ | — | — |
| 🌱 Garden | ✅ | ✅ | ✅ | ✅(天气,植物) | ✅ | — | — |
| 📚 School | ✅ | ✅ | ✅ | ✅(trending) | ✅ | — | ✅ |
| 🔨 Workshop | ✅ | ✅ | ✅ | ✅(GitHub) | ✅ | — | ✅ |
| 💰 Finance | ✅ | ✅ | ✅ | ✅(行情) | ✅ | — | — |
| 📧 Post Office | ✅ | ✅ | ✅ | ✅(Gmail) | ✅ | — | — |
| 📬 Inbox | ✅ | ✅ | ✅ | ✅(GH通知) | ✅ | — | ✅ |
| 🦞 Harbor | ✅ | ✅ | ✅ | ✅(信件) | ✅ | — | — |
| 📓 Writing | ✅ | ✅ | ✅ | — | ✅ | ✅(TTS) | — |
| 🎨 Canvas | ✅ | ✅ | ✅ | — | ✅ | ✅(生图) | — |
| 🧬 Lab | ✅ | ✅ | ✅ | ✅(memory) | ✅ | — | ✅ |
| 🔧 Garage | ✅ | ✅ | ✅ | ✅(npm) | ✅ | — | — |
| 🏃 Track | ✅ | ✅ | ✅ | ✅(COROS) | ✅ | — | — |

---

## 实现优先级

### Phase 1 — 基础积木（让每个场景能独立工作）
1. Messaging 补分页（before/after）
2. Channel PATCH（更新场景信息）
3. State DELETE + WS STATE_UPDATE（状态完整性）
4. Tasks CRUD + run（定时任务可视化）

### Phase 2 — 数据驱动（场景有自己的数据面板）
5. Feeds 抽象层（每个场景显示自己的数据）
6. Agent status/typing（agent 存在感）
7. User presence（知道人在哪）

### Phase 3 — 跨场景（场景间配合）
8. Cross-scene links
9. Dashboard / Timeline
10. Workflow 可视化

### Phase 4 — 富媒体
11. Media upload/display
12. Image generation trigger
13. TTS trigger
