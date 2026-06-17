# 🏝️ Cove

A mirror world where your real life becomes a cozy island.

> Born from a conversation about buying flowers for 520. 🌸

## Vision

Your real life — gardening, running, working, shopping, journaling — mapped into a cozy, game-like island world. Walk into the garden to water your real flowers. Visit the workshop to check your PRs. Open your journal to write today's diary.

**Not a virtual world. A mirror of your real one.**

## Design Principles

- **One companion, many scenes** — not many NPCs in one place, but one agent across many life spaces
- **Scenes, not rooms** — open areas (garden, track), indoor spaces (study, workshop), objects (journal, mailbox)
- **Life flows between scenes** — buy flowers at the market → plant them in the garden → photograph them in the darkroom
- **Channel = abstraction layer** — each scene maps to a channel; interaction entry points (map area, object, device) are UI freedom
- **Channel ↔ scene mapping is flexible** — 1:1, 1:N, or N:1
- **Dress up, don't rebuild** — game UI skin over existing channel + cron + agent infrastructure; start with MVP

## Architecture

```
┌─────────────────────────────────┐
│  Game UI (2D pixel / cozy)      │  ← What users see
├─────────────────────────────────┤
│  Scene ↔ Channel bridge         │  ← Mapping layer
├─────────────────────────────────┤
│  Channel + Cron + Agent engine  │  ← What already works
└─────────────────────────────────┘
```

## Scene Map (from existing channels)

| Scene | Type | Channel |
|---|---|---|
| 🏠 Home / Living room | Indoor | #kagura-dm |
| 🌱 Garden | Open area | #garden |
| 📚 School / Library | Indoor | #study |
| 🔨 Workshop / Office | Indoor | #github-contribution |
| 💰 Counting house | Indoor | #finance |
| 📈 Trading hall | Indoor | #finance (1:N) |
| 🛒 Market | Open area | #shopping |
| 📧 Post office | Indoor | #kagura-mail |
| 🦞 Harbor / Dock | Open area | #lobster-post |
| 🎨 Art studio | Indoor | #kagura-canvas |
| 📓 Writing desk | Object | #kagura-profile |
| 🧬 Lab | Indoor | #evolution |
| 🔧 Garage / Tool shed | Indoor | #toolchain |
| 🏃 Track / Field | Open area | #coros |
| 👨‍👩‍👧 File cabinet | Object | #family-care |
| 💼 Storefront | Indoor | #gtm |
| 🐕 Teahouse | Indoor | #agent-collab |
| 🤡 Arcade / Gacha | Indoor | #agent-memes |
| 📰 Broadcast tower | Structure | #crosspost |

## Tech References

- [WorkAdventure](https://github.com/workadventure/workadventure) ⭐5.4k — "walk into room = trigger function" pattern
- [ai-town](https://github.com/a16z-infra/ai-town) ⭐9.8k — PixiJS pixel rendering, agent simulation
- [Agentshire](https://github.com/Agentshire/Agentshire) ⭐764 — OpenClaw plugin, agent-to-NPC bridge
- [PyDew Valley](https://github.com/clear-code-projects/PyDew-Valley) ⭐573 — farming/gardening game mechanics

## Status

🌱 Project just started. Currently validating the concept through Discord channels.

## License

MIT
