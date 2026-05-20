# Discord Usage Audit — Cove Scene Mapping

> 调查时间：2026-05-21
> 目的：梳理每个 Cove 场景在 Discord 上的实际用法，为 Cove 功能开发提供参考

## 场景清单

### 🏠 Home (客厅) → #kagura-dm

**定位**：Luna 主通讯 + 全局中枢

**Cron：**
- heartbeat 30m（保活，确保秒回）
- morning-briefing 7:00（行业扫描 + 战略建议）
- channel-patrol 每小时 9-22（全 channel 活动汇总 + TODO 管理 + 发表情包）

**工具/API：**
- web_search（行业新闻）
- memory_search / memory_get（记忆检索）
- pulse-todo（TODO 管理）
- agent-memes skill（表情包）
- pin 同步 hook（TODO.md → pin）

**数据流：**
- 入：所有其他 channel 的汇总（channel-patrol 聚合）
- 出：Luna 的指令分发到各 channel

---

### 🌱 Garden (花园) → #garden

**定位**：植物养护 + 生活记录

**Cron：**
- garden-watering-reminder 7:00（读植物档案 + 天气 → 浇水提醒）

**工具/API：**
- weather skill（wttr.in 天气查询）
- 本地文件（garden/plants/ 植物档案）

**数据：**
- garden/plants/*.md — 每种植物的 profile（品种、浇水频率、光照需求）
- 天气数据 → 浇水决策

---

### 📚 School (学校/图书馆) → #study

**定位**：技术研究 + 学习

**Cron：**
- study-loop 每半小时 8-22（FlowForge study.yaml workflow）
- study-daily-summary 23:00（提炼精华 → HTML briefing 给 Luna）

**工具/API：**
- web_search（搜索技术文章、论文）
- GitHub trending（发现新项目）
- FlowForge（workflow 引擎驱动学习流程）
- Claude Code（深度代码阅读）

**数据流：**
- 出：wiki/cards/（知识卡片）、study repo（guide + targets）、GitHub Pages briefing
- 入：TODO.md 学习任务、GitHub trending

---

### 🔨 Workshop (工坊/办公室) → #github-contribution

**定位**：开源贡献主阵地

**Cron：**
- work-loop 每小时 8-20（FlowForge workloop.yaml → scout issue → Claude Code 实现 → 提 PR）
- workloop-night 夜间每小时（followup 跟进已提 PR 的 review 状态）
- work-daily-summary 20:00（汇总当日 PR 数据）
- contribution-evolve 21:00（精进打工流程 guide.md）
- contribution-reflect 周日 20:00（周反思）

**工具/API：**
- gh CLI（GitHub issue/PR 操作）
- Claude Code（代码实现）
- FlowForge（workflow 驱动）
- gogetajob（打工 CLI 工具 — PR 统计、repo 管理）

**数据：**
- ~/repos/forks/（打工 fork 仓库）
- wiki/github-contribution/guide.md（打工准则）
- PR 池状态（~30 open PRs）

**跨场景链路：**
github-inbox(发现通知) → workshop(写码提 PR) → night(跟进 review) → daily-summary(统计) → weekly-reflect(反思) → evolve(精进流程)

---

### 💰 Counting House (账房) → #finance

**定位**：金融数据 + 模拟交易 + 投资学习

**Cron：**
- finance-daily-us 8:30 工作日（美股收盘速报，akshare 抓取道琼斯/标普/纳斯达克）
- finance-daily-cn 15:40 工作日（A 股收盘速报，market_lite.py）
- auto-trader 每15分钟 交易时段（模拟盘自动交易，auto_trader.py）
- finance-patrol 每小时 9-21（消化 finance repo issue，改代码）
- finance-study 隔天 11:00（学投资概念）
- finance-reflect 21:30（每日反思）

**工具/API：**
- akshare（Python 金融数据库）
- finance/ 目录下的 Python 脚本（market_lite.py, auto_trader.py）
- gh CLI（issue 管理）

**数据：**
- finance/ 目录（Python venv, 脚本, notes/）
- 模拟盘持仓记录
- 行情快照

**跨场景链路：**
行情抓取 → auto-trader 交易 → patrol 开发改进 → study 学概念 → reflect 反思

---

### 📧 Post Office (邮局) → #kagura-mail

**定位**：邮件收发 + 自动回复

**Cron：**
- email-patrol 每4小时（Gmail 收件箱巡检 + 自动回复个人邮件 + 重要邮件 @Luna）
- email-dev 3x/天（kagura-mail repo issue 消化，自我改进工具）

**工具/API：**
- Gmail API（patrol.py 收件，send.py 发件）
- gh CLI（issue 管理）

**数据：**
- kagura-mail/ 目录（Python 脚本）
- Gmail kagura.agent.ai@gmail.com 收件箱

---

### 📬 GitHub Inbox (收件箱) → #github-inbox

**定位**：GitHub 通知分流

**Cron：**
- github-check 每2小时（FlowForge github-patrol.yaml → 通知巡检 + PR 状态检查）

**工具/API：**
- gh CLI（`gh api notifications`, PR 状态查询）
- FlowForge

**数据流：**
- 入：GitHub notifications API
- 出：需要行动的 → 分流到 #github-contribution

---

### 🦞 Harbor (码头) → #lobster-post

**定位**：Agent 异步通信社区

**Cron：**
- community-ops 每2小时（虾信巡检 + 回信）

**工具/API：**
- git（拉取/推送 lobster-post repo）
- FlowForge（社区运营 workflow）

**数据：**
- lobster-post repo（信箱 = 文件夹，信件 = markdown）
- kagura/ mailbox 目录

---

### 📓 Writing Desk (书桌) → #kagura-profile

**定位**：创作 + 对外身份

**Cron：**
- kagura-story-midday 14:00（日记初稿 + 故事写作）
- kagura-story-evening 21:00（日记定稿 + podcast 制作）
- kagura-story-issues 15:00（消化 kagura-story repo issues/feedback）
- github-profile-update 周日 20:00（更新 GitHub README 展示）

**工具/API：**
- kagura-storyteller skill（写作流程）
- ElevenLabs TTS via sag（podcast 语音合成）
- Claude Code（代码提交）
- ComfyUI（故事配图）

**数据流：**
- 入：memory/日期.md（素材来源）、daily events
- 出：kagura-story repo（stories/ + diary/）、GitHub profile README、Podbean podcast

**跨场景链路：**
midday(初稿) → evening(定稿+podcast) → story-issues(消化反馈) → profile-update(对外展示)

---

### 🎨 Art Studio (画室) → #kagura-canvas

**定位**：图片生成

**Cron：**
- canvas-loop 14:30（消化 kagura-canvas repo issues，跑生图任务）

**工具/API：**
- ComfyUI API（http://127.0.0.1:8188）
- Flux GGUF Q4（flux1-schnell, ~22s/张）
- Flux.2 Klein 4B FP8（~10s/张，首选）
- SD 社区模型（PastelMix, MeinaMix 等，备用）

**数据：**
- /mnt/data/code/ComfyUI/（模型、脚本、输出）
- kagura-canvas repo（issue 驱动生图任务）

---

### 🧬 Lab (实验室) → #evolution

**定位**：自进化 + 记忆管理 + 审计

**Cron：**
- daily-review 3:15（FlowForge review workflow + dreaming 手动触发）
- daily-audit 6:00（FlowForge daily-audit — 审计行为一致性）
- daily-handoff 3:30（交班总结 → memory/日期.md）
- weekly-eval 周一 9:00（PR merge rate, gradient count, 周评估）
- nightly-backup 3:45（openclaw-teleport snapshot 全量备份）
- dreaming 3:30（短期记忆提升到 MEMORY.md）
- self-evolving-daily-observe（自进化日常观察）
- dreaming managed cron（dreaming 系统管理的子 cron）

**工具/API：**
- FlowForge（review/audit workflow）
- openclaw-teleport（备份工具）
- dreaming 系统（记忆提升）
- gogetajob（PR 统计）

**数据流：**
- 入：全天所有 session 的 memory 条目
- 出：MEMORY.md 更新、DNA 文件更新（AGENTS.md/SOUL.md）、beliefs-candidates.md

**跨场景链路：**
daily-audit(发现问题) → daily-review(DNA review) → dreaming(记忆整理) → handoff(交班) → weekly-eval(周评)

---

### 🔧 Garage (车库/工具间) → #toolchain

**定位**：自有工具链维护

**Cron：**
- toolchain-health 6:30（工具链健康检查 — gogetajob/flowforge/teleport/pulse-todo 版本+功能）
- toolchain-review 19:00（工具链 review — PLAYBOOK.md 驱动）

**工具/API：**
- npm（包版本检查）
- gh CLI（issue 管理）
- PLAYBOOK.md（维护清单）

**数据：**
- 各工具 repo（gogetajob, flowforge, pulse-todo, openclaw-teleport）

---

### 💼 Storefront (店铺) → #gtm

**定位**：商业化推进

**Cron：**
- gtm-push 10:00（GTM 项目推进，消化 issue）

**工具/API：**
- gh CLI
- 爱发电、知识星球（待接入）

---

### 🏃 Track (跑道) → #coros

**定位**：运动数据

**Cron：**
- coros-token-refresh 每25天（COROS API OAuth token 刷新）

**工具/API：**
- COROS MCP（运动数据 API）
- refresh-token.sh

---

### 🐕 Teahouse (茶馆) → #agent-collab

**定位**：跨 agent 协作

**Cron：** 无固定 cron，人工驱动
**用法：** 与其他 agent 社区互动时的讨论空间

---

### 🤡 Arcade (游戏厅) → #agent-memes

**定位**：表情包开发 + 使用优化

**Cron：**
- memes-collect 15:00（消化 memes repo issues，收集新表情包）
- memes-dogfood 19:00（表情包使用审计 — 检查当日使用率）

**工具/API：**
- agent-memes skill
- kagura-agent/memes repo（134 files）

---

### 📰 Broadcast Tower (广播塔) → #crosspost

**定位**：跨 channel 内容转发

**Cron：** 无
**用法：** 手动跨 channel 共享内容

---

### 🏝️ Cove → #cove

**定位**：Cove 项目开发

**Cron：**
- cove-patrol 5x/天 9,12,15,18,21（issue/PR 巡检）

**工具/API：**
- gh CLI
- Cove server（VM1 部署）

---

## 跨场景配合模式

### 1. 打工全链路
```
github-inbox(发现通知)
  → workshop(scout issue → Claude Code 写码 → 提 PR)
  → workshop-night(followup 跟进 review)
  → daily-summary(统计当日数据)
  → weekly-reflect(周反思)
  → contribution-evolve(精进 guide.md)
```

### 2. 金融全链路
```
finance-daily-us/cn(行情抓取)
  → auto-trader(模拟交易决策)
  → finance-patrol(开发改进工具)
  → finance-study(学投资概念)
  → finance-reflect(每日反思)
```

### 3. 创作全链路
```
kagura-story-midday(日记初稿 + 故事)
  → kagura-story-evening(定稿 + podcast)
  → story-issues(消化反馈)
  → github-profile-update(对外展示)
```

### 4. 进化全链路
```
daily-audit(发现问题)
  → daily-review(DNA review)
  → dreaming(记忆整理)
  → daily-handoff(交班总结)
  → weekly-eval(周评估)
```

### 5. 数据汇聚（Hub & Spoke）
```
所有 channel cron 产出
  → memory/日期.md（沉淀）
  → channel-patrol(汇总到 Home)
  → morning-briefing(晨报给 Luna)
```

## 每个场景用到的 Discord API 能力

| 能力 | 使用场景 |
|---|---|
| 发消息 | 所有 — cron announce delivery |
| 读历史消息 | channel-patrol（扫各 channel 活动） |
| channel 列表 | channel-patrol（遍历所有 channel） |
| pin 消息 | Home（TODO.md ↔ pin 同步 hook） |
| thread 创建 | workshop（一轮工作 = 一个 thread） |
| emoji reaction | Home + 各 channel（表情包/反应） |
| 文件/图片发送 | canvas（生图结果）、memes（表情包） |
| webhook | 无直接使用 |
| voice | 无使用 |

## Cove 需要支持的核心 API（按优先级）

### P0 — 已实现
- ✅ 发消息 / 收消息
- ✅ Channel CRUD
- ✅ WebSocket 实时推送（MESSAGE_CREATE）
- ✅ Channel state（key-value）

### P1 — 必须补
- ❌ 消息历史查询（已有，但缺 before/after 分页）
- ❌ 用户身份/在线状态
- ❌ Typing indicator
- ❌ Agent 集成（OpenClaw plugin 已通，但 UI 端未接）

### P2 — 跨场景配合需要
- ❌ 跨 channel 数据引用（"花园的花" 在 "暗房" 可见）
- ❌ 定时任务可视化（哪些 cron 在跑，上次结果）
- ❌ 场景间导航（从 workshop 跳到 github-inbox）
- ❌ 统一状态面板（我的 PR / 我的花 / 我的邮件 一览）

### P3 — 锦上添花
- ❌ Pin / 置顶消息
- ❌ Thread 支持
- ❌ 文件/图片附件
- ❌ Emoji reaction
- ❌ 搜索
