# Spec: Fix CI shell injection in notification workflows

**Issue:** #393
**Status:** Draft

## Problem

`notify-issue-close.yml` and `notify-cove.yml` interpolate GitHub event fields directly into bash via `${{ }}`:

```yaml
TITLE="${{ github.event.issue.title }}"
```

Issue/PR titles containing backticks, double quotes, or `$()` are interpreted by bash — causing either workflow failures (exit code 127) or arbitrary command execution on the runner.

**Evidence:** #392's title has backticks → all 3 notification runs failed (runs 27934445558, 27934646285, 27934686236).

## Solution

Follow [GitHub's security guidance](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-an-intermediate-environment-variable): move untrusted strings to `env:` and read them as shell variables. Build JSON payloads with `jq` instead of string interpolation.

### Before / After

**notify-issue-close.yml:**

Before:
```yaml
- name: Build notification message
  id: msg
  run: |
    ACTION="${{ github.event.action }}"
    NUM="${{ github.event.issue.number }}"
    TITLE="${{ github.event.issue.title }}"
    URL="${{ github.event.issue.html_url }}"
    ACTOR="${{ github.actor }}"
    ...

- name: Send to Cove #cove-product
  run: |
    curl -s -X POST "${{ secrets.COVE_PRODUCT_WEBHOOK_URL }}" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"${{ steps.msg.outputs.message }}\", \"username\": \"GitHub\"}"
```

After:
```yaml
- name: Build notification message
  id: msg
  env:
    ACTION: ${{ github.event.action }}
    NUM: ${{ github.event.issue.number }}
    TITLE: ${{ github.event.issue.title }}
    URL: ${{ github.event.issue.html_url }}
    ACTOR: ${{ github.actor }}
    LABEL: ${{ github.event.label.name }}
    ASSIGNEE: ${{ github.event.assignee.login }}
  run: |
    case "$ACTION" in
      opened)   EMOJI="🆕"; TEXT="Issue #${NUM} created by ${ACTOR}" ;;
      closed)   EMOJI="✅"; TEXT="Issue #${NUM} closed by ${ACTOR}" ;;
      reopened) EMOJI="🔓"; TEXT="Issue #${NUM} reopened by ${ACTOR}" ;;
      labeled)  EMOJI="🏷️"; TEXT="Issue #${NUM} labeled [${LABEL}] by ${ACTOR}" ;;
      unlabeled) EMOJI="🏷️"; TEXT="Issue #${NUM} unlabeled [${LABEL}] by ${ACTOR}" ;;
      assigned) EMOJI="👤"; TEXT="Issue #${NUM} assigned to ${ASSIGNEE} by ${ACTOR}" ;;
      unassigned) EMOJI="👤"; TEXT="Issue #${NUM} unassigned ${ASSIGNEE} by ${ACTOR}" ;;
      *)        EMOJI="📌"; TEXT="Issue #${NUM} [${ACTION}] by ${ACTOR}" ;;
    esac
    MSG=$(printf '%s\n%s\n%s' "$EMOJI $TEXT" "$TITLE" "$URL")
    DELIMITER=$(openssl rand -hex 8)
    echo "message<<$DELIMITER" >> "$GITHUB_OUTPUT"
    echo "$MSG" >> "$GITHUB_OUTPUT"
    echo "$DELIMITER" >> "$GITHUB_OUTPUT"

- name: Send to Cove #cove-product
  env:
    MSG: ${{ steps.msg.outputs.message }}
    WEBHOOK_URL: ${{ secrets.COVE_PRODUCT_WEBHOOK_URL }}
  run: |
    if [ -z "$WEBHOOK_URL" ]; then echo '::warning::WEBHOOK_URL is empty, skipping'; exit 0; fi
    PAYLOAD=$(jq -nc --arg content "$MSG" '{content: $content, username: "GitHub"}')
    curl -sfS -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d "$PAYLOAD"
```

**notify-cove.yml** — same pattern: move `${{ github.event.pull_request.title }}` to `env:`, use `jq` for JSON.

## Scope

Files changed:
- `.github/workflows/notify-issue-close.yml`
- `.github/workflows/notify-cove.yml`

## Verification

- After merge, create a test issue titled `` `whoami` $(echo hi) `` → workflow should succeed
- Notification message should contain the literal special characters, not execute them
- Close the test issue → notification should also succeed
