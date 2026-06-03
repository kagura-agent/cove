# Cove Design System

## Principles

1. **No magic numbers** — All spacing, sizing, typography use CSS custom property tokens
2. **Layout skeleton = fixed dimensions** — Headers, footers, sidebars use fixed height/width tokens, not padding
3. **Content spacing = spacing scale** — Gaps, margins, padding inside content areas use `--space-*` tokens
4. **Alignment by shared tokens** — Adjacent panels align because they reference the same token, not because they happen to have matching values

## Tokens

### Layout (fixed dimensions — for structural alignment)
| Token | Value | Used by |
|-------|-------|---------|
| `--header-height` | 48px | Sidebar header, ChatArea header |
| `--footer-height` | 52px | UserBar, MessageInput |
| `--sidebar-width` | 240px | Sidebar |
| `--member-list-width` | 240px | MemberList |

### Spacing Scale (4px base — for content padding/gaps)
| Token | Value |
|-------|-------|
| `--space-xxs` | 2px |
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 12px |
| `--space-lg` | 16px |
| `--space-xl` | 20px |
| `--space-xxl` | 24px |
| `--space-3xl` | 32px |

### Content Alignment
| Token | Value | Purpose |
|-------|-------|---------|
| `--content-pad` | 16px | Universal left/right padding for all content areas |
| `--avatar-size` | 40px | Message avatars |
| `--avatar-size-sm` | 32px | Member list avatars |
| `--avatar-size-xs` | 28px | UserBar avatar |
| `--content-gap` | 16px | Gap between avatar and text |
| `--content-start` | 72px (calc) | Where text content starts (pad + avatar + gap) |

### Typography
| Token | Value |
|-------|-------|
| `--font-size-xs` | 10px |
| `--font-size-sm` | 12px |
| `--font-size-md` | 14px |
| `--font-size-lg` | 16px |
| `--font-size-xl` | 20px |

### Input
| Token | Value |
|-------|-------|
| `--input-radius` | 8px |

## Rules

### ✅ Do
- Use `height: var(--header-height)` for layout skeleton elements
- Use `padding: var(--space-md) var(--content-pad)` for content areas
- Use `width: var(--avatar-size)` for avatars
- Add new tokens to `:root` in `index.css` when a value is used in 2+ components

### ❌ Don't
- Use `minHeight` for layout skeleton — content differences will break alignment
- Hardcode pixel values in component files
- Use padding to determine panel height — padding + content height ≠ consistent height
- Create one-off spacing values outside the 4px scale

## Verification
Use Chrome Layout Inspector extension to draw guide lines and verify:
- Header bottom edges align horizontally across sidebar and chat area
- Footer top edges align horizontally across UserBar and MessageInput
- Content left edges align vertically (avatars at `--content-pad`, text at `--content-start`)
