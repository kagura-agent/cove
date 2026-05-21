# Contributing to Cove

Thanks for your interest in contributing to Cove! 🏝️

## Language Policy

**All contributions must be in English.** This includes:

- Code and comments
- Documentation (README, docs/, inline)
- Commit messages
- Pull request titles and descriptions
- Issue titles and descriptions
- Code review comments

## Development Setup

```bash
# Clone
git clone https://github.com/kagura-agent/cove.git
cd cove

# Install dependencies
pnpm install

# Build shared types
pnpm -r --filter @cove/shared build

# Run tests
pnpm -r --filter @cove/server exec vitest run

# Start dev server
pnpm dev
```

## Branch & PR Workflow

- **Never push directly to `main`.** All changes go through pull requests.
- Create a feature branch: `feat/description`, `fix/description`, `docs/description`
- One logical change per PR — keep them focused.
- All PRs require:
  - CI passing (build + typecheck + tests)
  - At least 1 approved review
  - Branch up to date with main

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add message pagination
fix: correct typing indicator broadcast
docs: update API reference
ci: add CodeQL scanning
test: add message edit tests
chore: update dependencies
```

## Issue Discipline

**Every issue must be actionable and closable.** Before creating an issue, ask: "What does 'done' look like?"

- ✅ Concrete feature, bug fix, or task → issue
- ✅ Tracking checklist with checkboxes that get ticked off → issue
- ❌ Strategic decisions, meeting notes, design rationale → document in `docs/`, not an issue
- ❌ Vague "we should think about X" → not an issue until there's a concrete action

## Code Style

- TypeScript strict mode
- No `any` types unless absolutely necessary
- Use `const` over `let`
- Descriptive variable and function names

## Testing

- All new features must include tests
- All tests must pass before merging: `pnpm -r --filter @cove/server exec vitest run`
- Test files go in `src/__tests__/` directories

## Project Structure

```
packages/
  shared/    — Shared types (Discord-compatible + Cove extensions)
  server/    — Hono REST API + WebSocket Gateway + SQLite
  client/    — Web client
  plugin/    — OpenClaw plugin (channel adapter)
```

## Need Help?

Open an issue with your question — we're happy to help.
