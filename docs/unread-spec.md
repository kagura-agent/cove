# Unread Indicators Spec — Discord-style

## Components

### 1. NEW Line (Red Separator)

**What**: Red horizontal line with "NEW" label between last-read and first-unread message.

**Appears when**: User ENTERS a channel that has unread messages (`last_read_message_id < latest_message_id`).

**Position**: Between `last_read_message_id` and the next message. Fixed, never moves.

**Disappears when**:
- User sends a message in this channel (typing = engaging = read)
- User leaves the channel

**Does NOT disappear from**: Scrolling (stays visible the entire visit until user sends a message).

**Never appears when**: User is already in the channel chatting.

### 2. Top Banner

**What**: Bar at top showing "N new messages — Mark as Read".

**Appears when**: User enters a channel with unread messages. Independent of NEW line visibility — shows whenever there are unread messages on entry.

**Disappears when**:
- User clicks "Mark as Read" → scrolls to bottom
- User scrolls to bottom manually

**Does NOT depend on**: Whether NEW line is above/below viewport. Banner and NEW line are independent.

**Actions**:
- Click "Mark as Read" → scroll to bottom, dismiss banner

### 3. Bottom Pill (New Messages Below)

**What**: Floating pill at bottom showing "N new messages ↓".

**Appears when**: User is scrolled UP (not at bottom) AND new messages arrive in real-time.

**Disappears when**: User scrolls to bottom or clicks the pill.

**Never appears on**: Channel entry (that's what the top banner is for).

## State Rules

```
Channel entry:
  compute unreadCount = messages after last_read_message_id
  if unreadCount == 0:
    → no indicators
  if unreadCount > 0:
    → show NEW line (between lastReadId and next msg)
    → show top banner ("N new messages — Mark as Read")
    → scroll to bottom

While in channel at bottom, new message arrives:
  → auto-ack, no indicators

While in channel scrolled up, new message arrives:
  → show/increment bottom pill ("N new messages ↓")

User sends a message:
  → clear NEW line (user is engaged)

User scrolls to bottom:
  → clear top banner
  → clear bottom pill

User clicks "Mark as Read":
  → scroll to bottom
  → clear top banner

User leaves channel:
  → clear all indicators
```

## Key Principles

1. NEW line and banner are ENTRY indicators — computed once, frozen
2. Bottom pill is a REAL-TIME indicator — only for messages arriving while scrolled up
3. Normal chatting at bottom → nothing ever appears
4. NEW line and banner are independent (no dependency between them)
5. NEW line persists through scrolling, only cleared by sending a message or leaving
