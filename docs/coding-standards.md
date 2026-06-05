# Cove Coding Standards

This document defines the engineering standards for the Cove project. All PRs must comply. Code review should verify adherence.

## 1. CSS & Layout

### 1.1 Global box-sizing
All elements use `border-box`. This is set globally in `index.css`:
```css
*, *::before, *::after { box-sizing: border-box; }
```
Never override to `content-box`.

### 1.2 No hardcoded pixel values in components
Components must reference CSS variables (design tokens) for all sizing, spacing, and typography. No raw numbers in `CSSProperties` objects.

```tsx
// ❌ Wrong
style={{ padding: "8px 16px", fontSize: 14, height: 36 }}

// ✅ Correct
style={{ padding: "var(--space-sm) var(--space-lg)", fontSize: "var(--font-size-md)", height: "var(--control-height-md)" }}
```

**Exceptions:** `0`, `1px` borders, unitless `lineHeight`, and true one-off values (e.g., `maxHeight` for scroll limits) may stay as literals.

### 1.3 Design tokens are the single source of truth
All tokens are defined in `packages/client/src/index.css` under `:root`. If a new size/spacing/color is needed, add a token first, then reference it. Never introduce a magic number.

**Available token categories:**
- **Layout:** `--header-height`, `--footer-height`, `--sidebar-width`, `--member-list-width`
- **Spacing:** `--space-xxs` through `--space-3xl` (4px base scale)
- **Typography:** `--font-size-xs` through `--font-size-xl`
- **Control sizing:** `--control-height-sm/md/lg`, `--icon-button-size-sm/md`
- **Colors:** semantic tokens per theme (backgrounds, text, borders, accents, status)
- **Radii:** `--input-radius`
- **Avatars:** `--avatar-size`, `--avatar-size-sm`, `--avatar-size-xs`

### 1.4 Layout with CSS Grid
The app shell uses CSS Grid for structural layout:
```
grid-template-columns: sidebar | main-content
grid-template-rows: body | footer
```
Sidebar and main panel share the footer grid row, guaranteeing alignment. Do not use manual pixel matching between panels.

### 1.5 Components don't control their own outer spacing
A component manages its interior. The parent decides margin, gap, and placement. This keeps components reusable without alignment drift.

### 1.6 One token controls one dimension
A dimension (e.g., footer height) is defined in exactly one place. All consumers reference that single variable. Never duplicate a value across components.

## 2. TypeScript & Code Style

### 2.1 Strict typing
- No `any` types. Use `unknown` + type narrowing when needed.
- All function parameters and return types should be inferable or explicit.

### 2.2 Error responses follow Discord format
```json
{ "message": "Human-readable error", "code": 10003 }
```
Use Discord error codes where applicable (see `docs/discord-reference.md`). For custom errors without a Discord equivalent, omit the `code` field.

### 2.3 IDs are Snowflakes
All entity IDs (users, channels, messages, guilds, members) are Snowflake strings. Auth tokens use `crypto.randomUUID()` — never Snowflakes.

### 2.4 Timestamps are integers
Store timestamps as Unix milliseconds (integer) in SQLite. Convert to ISO 8601 strings only at the API response layer.

## 3. Database

### 3.1 Foreign key constraints
All FK relationships must be declared with appropriate `ON DELETE` behavior (`CASCADE`, `SET NULL`). FK enforcement is enabled via `PRAGMA foreign_keys = ON`.

### 3.2 Indexes for query paths
Every query pattern used in routes/repos must have a supporting index. Add indexes in `createAllTables` and migration steps.

### 3.3 Migrations
- Migrations are numbered and sequential (V1→V2→V3...).
- Each migration runs inside a transaction.
- After migration, run `PRAGMA foreign_key_check` — hard error on violations.
- Staging data issues: delete the DB and start fresh. Do not add auto-cleanup code to mask dirty data.

## 4. API & Protocol

### 4.1 Discord compatibility
Align with Discord's API conventions where applicable:
- Gateway opcodes must not collide with Discord's definitions
- REST endpoints follow Discord URL patterns (`/channels/:id/messages`, etc.)
- Gateway events use Discord event names (`MESSAGE_CREATE`, `CHANNEL_DELETE`, etc.)

### 4.2 Ownership checks
All mutation endpoints (PATCH, DELETE) must verify the actor has permission. At minimum, check that the actor owns the resource or is a guild member.

### 4.3 `@me` alias
User endpoints must resolve `@me` to the authenticated user's ID before any ownership check.

## 5. CI & Verification

### 5.1 Local verification must cover all CI steps
Before pushing, run:
```bash
pnpm -r build
pnpm -r exec tsc --noEmit
npm test
npx esbuild packages/server/dist/index.js \
  --bundle --platform=node --format=esm \
  --outfile=/dev/null \
  --external:better-sqlite3 --external:ws \
  --alias:@cove/shared=./packages/shared/src/index.ts
```

### 5.2 No manual staging deploys
CI handles all staging deployments. Never SSH to VM1 to manually build/deploy — it overwrites CI-deployed versions and causes version mismatch.

### 5.3 Staging data
Staging is a development environment. When the DB has issues, delete it and start fresh. Do not write auto-cleanup code to work around dirty data.

## 6. Code Review Checklist

Reviewers should verify:

- [ ] No hardcoded pixel values — all sizing/spacing/typography references CSS tokens
- [ ] New CSS values use existing tokens or define new ones in `index.css`
- [ ] Layout changes use Grid/Flexbox, not manual pixel calculation
- [ ] Error responses use Discord-compatible format
- [ ] Mutation endpoints have ownership/permission checks
- [ ] New DB columns have proper FK constraints and NOT NULL where appropriate
- [ ] Timestamps stored as integers, not ISO strings
- [ ] IDs are Snowflakes (except auth tokens)
- [ ] All CI steps pass locally before push
- [ ] No `resolveId`-style workarounds — fix the root cause

---

_This document is maintained alongside the codebase. Update it when new standards are established._
