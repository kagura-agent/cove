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

## Issue Discipline

**Every issue must be actionable and closable.** Before creating an issue, ask: "What does 'done' look like?"

- ✅ Concrete feature, bug fix, or task → issue
- ✅ Tracking checklist with checkboxes that get ticked off → issue
- ❌ Strategic decisions, meeting notes, design rationale → document in `docs/`, not an issue
- ❌ Vague "we should think about X" → not an issue until there's a concrete action

## Branch & PR Workflow

- **Never push directly to `main`.** All changes go through pull requests.
- Create a feature branch: `feat/description`, `fix/description`, `docs/description`
- One logical change per PR — keep them focused.
- PR description must explain what changed and why.
- Use `Closes #N` or `Fixes #N` in PR description to link issues.
- All PRs are set to **auto-merge** after approval — once CI passes and review is approved, the PR merges automatically. No manual merge step needed.
- **Keep branch up to date** — if GitHub shows "This branch is out-of-date with the base branch", rebase locally and push (`git fetch origin main && git rebase origin/main && git push --force-with-lease`). Do NOT use GitHub's "Update branch" button — it creates a merge commit associated with the repo owner's account.
- After updating branch, the previous approval is automatically dismissed. **Re-request review** from the reviewer (`gh api .../requested_reviewers -X POST`).
- After addressing review comments and resolving threads, **always re-request review** — the reviewer won't see it's ready otherwise.
- All PRs require:
  - CI passing (build + typecheck + tests)
  - At least 1 approved review
  - Branch up to date with main

## PR Review Process

- **Before requesting Luna's review**, send the PR to the `#code-review` channel (Discord <#1508641076204802159>) for automated multi-model code review. Address any findings first, then request Luna's review.
- PRs are assigned to Luna for final review via CODEOWNERS.
- When review comments are posted:
  - **Reply directly in the review comment thread** (not as a general PR comment)
  - **Resolve the thread** after addressing the feedback
  - If a comment raises a separate concern, open a new issue and reference it in the reply
- After addressing all comments, check the PR status yourself — don't ask if it's been approved; look at the review decision and CI status directly.
- Stale approvals are automatically dismissed when new commits are pushed — re-approval is required after changes.

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

## Code Style

- TypeScript strict mode
- No `any` types unless absolutely necessary
- Use `const` over `let`
- Descriptive variable and function names
- **Code implementation via Claude Code** — subagents delegate coding to `claude --print --permission-mode bypassPermissions`

## Testing

- All new features must include tests
- All tests must pass before merging
- Test files go in `src/__tests__/` directories

### Local verification (must match CI)

Before pushing, run **all** steps that CI checks:

```bash
# 1. Build all packages
pnpm -r build

# 2. Type check (catches errors that vitest/vite skip)
pnpm -r exec tsc --noEmit

# 3. Run tests
npm test
```

⚠️ `npm test` alone is NOT sufficient — vitest uses esbuild which skips type checking, and `vite build` doesn't check types either. The `tsc --noEmit` step catches type errors that tests and builds miss.

See `.github/workflows/ci.yml` for the authoritative CI pipeline.

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

## Project Structure

```
packages/
  shared/    — Shared types (Discord-compatible + Cove extensions)
  server/    — Hono REST API + WebSocket Gateway + SQLite
  client/    — Web client
  plugin/    — OpenClaw plugin (channel adapter)
docs/        — Design documents and specifications
```

## Architecture

Cove's backend is an **OpenClaw channel adapter** — it sits between the UI and OpenClaw Gateway, just like the Discord or Zulip adapters:

```
UI ←→ Cove Backend ←→ OpenClaw Gateway
      (channel adapter)
```

- **Facing up (UI)**: HTTP API + WebSocket for scene data, messages, real-time updates
- **Facing down (OpenClaw)**: Registers as a channel provider; agent doesn't care if messages come from Discord or Cove

The agent layer stays untouched. Cron, delivery, allowlist — all reused from OpenClaw. Cove only adds the UI and the channel bridge.

## Deployment

### Staging — Automatic via CI

**Do NOT manually deploy to staging.** The `deploy-staging.yml` workflow handles everything:

- **On PR open/push**: CI builds client + server → deploys to VM1 staging (port 3501)
- **On PR close**: CI tears down the staging service
- **On push to main**: CI deploys the latest main to staging

Staging URL: `https://staging.cove.kagura-agent.com`

To test your changes:
1. Push to your PR branch
2. Wait for CI deploy to complete (check PR comments for preview URL)
3. Hard-refresh the staging URL (`Ctrl+Shift+R`)

⚠️ Manual SSH deploys will overwrite CI-deployed versions and cause confusion. Don't do it.

### Generating Invite Codes (Staging)

```bash
ssh to VM1, then:
cd /home/azureuser/cove-staging && node -e "
const db=require('better-sqlite3')('./cove-staging.db');
const crypto=require('crypto');
const code=crypto.randomBytes(4).toString('hex').toUpperCase();
const id=crypto.randomUUID();
db.prepare('INSERT INTO invite_codes (id, code, created_at) VALUES (?, ?, ?)').run(id, code, new Date().toISOString());
console.log(code);
"
```

## Need Help?

Open an issue with your question — we're happy to help.
