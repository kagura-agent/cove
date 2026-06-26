---
name: "cove-qa"
description: "QA methodology for Cove: feature-level testing, real browser interaction, visual regression, exploratory testing."
status: proposal
version: "v1"
date: "2026-06-26T05:41:33.672Z"
---

# Cove QA

Quality assurance methodology for Cove. Defines how to test properly — not just verify fixes, but validate features.

## Core Principle

**Test the feature, not just the fix.**

When you receive a QA task, your job is NOT to mechanically verify a list of fixes. Your job is to validate that the **entire feature works correctly** from a real user's perspective.

## Testing Levels (all required)

### 1. Functional Testing (必须真机操作)
- Open staging in a real browser
- Perform every operation as a real user would
- **Do not substitute source code review for functional testing**
- "源码确认" is NOT a valid test result — you must trigger the behavior

### 2. Visual Regression
- Check text visibility (color vs background)
- Check layout stability (no jumping/shifting on interaction)
- Check spacing and alignment
- Check responsive behavior (scroll, overflow, resize)
- **Screenshot every state** — before interaction, during, after

### 3. Interaction Testing
- Hover states (does hovering cause layout shifts?)
- Click → immediate feedback (does UI update instantly?)
- Scrollbar behavior (does scrollbar appearing shift content?)
- Keyboard interaction (Escape to close, Tab navigation)
- Multi-click (does clicking twice cause duplicates?)

### 4. State Consistency
- After operation: does UI reflect the change?
- After refresh: is the change persisted?
- After another user's action: does WS event update the UI?
- Edge cases: empty states, max items, concurrent operations

### 5. Exploratory Testing
Go beyond the provided test steps:
- What happens if I do operations in unexpected order?
- What happens at the boundary (0 items, 100 items)?
- What related features might be affected?

## Blocked Path Escalation

If you cannot test something (e.g., "SSH not available", "no owner token"):
- **DO NOT skip it and report pass**
- Report as ⚠️ BLOCKED with the specific reason
- Suggest how to unblock (e.g., "need owner account setup on staging")
- This is a **blocker**, not a footnote

## Test Scope Rules

When receiving a QA task for a feature (not a hotfix):

1. **Primary scope**: All operations the feature enables (full CRUD, all user roles)
2. **Secondary scope**: UI/UX quality (colors, layout, transitions, feedback)
3. **Regression scope**: Related features that might be affected
4. **Do NOT limit yourself to the test steps provided** — those are starting points, not boundaries

## Report Format

```
🧪 QA PR #XXX (commit) — ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

## Functional
- [operation]: ✅/❌ (screenshot)

## Visual
- [check]: ✅/❌ (screenshot)

## Interaction
- [behavior]: ✅/❌

## Exploratory Findings
- [anything unexpected]

## Blocked
- [what couldn't be tested and why]
```

## Anti-Patterns (DO NOT)

- ❌ "源码确认 .catch(() => alert(...))" — test it for real
- ❌ Skipping owner/admin test paths because of access issues — escalate as blocked
- ❌ Only testing the happy path listed in test steps
- ❌ Reporting ✅ PASS when visual/interaction issues exist
- ❌ Testing API responses without testing UI behavior
- ❌ "回归全绿" without actually clicking through related features

## Testing Tools

- Browser automation (primary — open staging, click through, screenshot)
- API calls (secondary — verify data persistence)
- Source code review (context only — NEVER a substitute for functional testing)