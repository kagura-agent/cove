// Cove Chat UI — main entry point
import "./styles.css";

const API_BASE = (import.meta.env.VITE_COVE_API_URL as string) || "";

// ── Types ──

interface Channel {
  id: string;
  name: string;
  topic?: string;
  icon?: string;
  type?: number;
}

interface Author {
  id: string;
  username: string;
  avatar?: string | null;
}

interface Message {
  id: string;
  channel_id: string;
  content: string;
  author: Author;
  timestamp: string;
}

// ── User identity ──

function getUser(): { id: string; username: string } {
  const saved = localStorage.getItem("cove-user");
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through */ }
  }
  const username = prompt("Welcome to Cove 🏝️\nWhat's your name?") || "Islander";
  const id = username.toLowerCase().replace(/[^a-z0-9]/g, "-") || "islander";
  const user = { id, username };
  localStorage.setItem("cove-user", JSON.stringify(user));
  return user;
}

const currentUser = getUser();

// ── DOM refs ──

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const channelList = $("#channel-list");
const messagesEl = $("#messages");
const chatHeader = {
  icon: $("#channel-icon"),
  name: $("#channel-name"),
  topic: $("#channel-topic"),
};
const mobileTitle = $("#mobile-title");
const messageForm = $<HTMLFormElement>("#message-form");
const messageInput = $<HTMLInputElement>("#message-input");
const sidebar = $("#sidebar");
const sidebarOverlay = $("#sidebar-overlay");
const sidebarToggle = $("#sidebar-toggle");

// ── State ──

let channels: Channel[] = [];
let activeChannelId: string | null = null;
let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ── API helpers ──

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers as Record<string, string>),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Channel list ──

async function loadChannels() {
  channelList.innerHTML = '<div class="loading">Loading scenes…</div>';
  try {
    channels = await api<Channel[]>("/api/v10/guilds/cove/channels");
    renderChannels();
    if (channels.length > 0 && !activeChannelId) {
      selectChannel(channels[0].id);
    }
  } catch (err) {
    channelList.innerHTML = '<div class="loading">⚠️ Failed to load scenes</div>';
    console.error("loadChannels:", err);
  }
}

const SCENE_ICONS: Record<string, string> = {
  campfire: "🔥",
  beach: "🏖️",
  forest: "🌲",
  cave: "🕳️",
  harbor: "⚓",
  market: "🏪",
  tavern: "🍺",
  garden: "🌺",
  lighthouse: "🗼",
  library: "📚",
  workshop: "🔧",
  general: "💬",
  home: "🏠",
  post: "📮",
};

function getChannelIcon(ch: Channel): string {
  if (ch.icon) return ch.icon;
  const name = ch.name.toLowerCase();
  for (const [key, icon] of Object.entries(SCENE_ICONS)) {
    if (name.includes(key)) return icon;
  }
  return "🏝️";
}

function renderChannels() {
  channelList.innerHTML = "";
  for (const ch of channels) {
    const item = document.createElement("div");
    item.className = "channel-item" + (ch.id === activeChannelId ? " active" : "");
    item.dataset.id = ch.id;

    const btn = document.createElement("button");
    btn.className = "channel-btn" + (ch.id === activeChannelId ? " active" : "");
    btn.innerHTML = `
      <span class="channel-icon">${getChannelIcon(ch)}</span>
      <span class="channel-name">${escapeHtml(ch.name)}</span>
    `;
    btn.addEventListener("click", () => selectChannel(ch.id));

    const delBtn = document.createElement("button");
    delBtn.className = "channel-delete";
    delBtn.textContent = "×";
    delBtn.title = "Delete channel";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete #${ch.name}? All messages will be lost.`)) return;
      try {
        await api(`/api/v10/channels/${ch.id}`, { method: "DELETE" });
        if (activeChannelId === ch.id) activeChannelId = null;
        await loadChannels();
      } catch (err) { console.error("delete channel:", err); }
    });

    item.appendChild(btn);
    item.appendChild(delBtn);
    channelList.appendChild(item);
  }

  // Add channel button
  const addBtn = document.createElement("button");
  addBtn.className = "channel-btn channel-add";
  addBtn.innerHTML = `<span class="channel-icon">➕</span><span class="channel-name">New channel</span>`;
  addBtn.addEventListener("click", async () => {
    const name = prompt("Channel name:");
    if (!name?.trim()) return;
    const icon = prompt("Emoji icon (optional):", "🏝️") || "🏝️";
    try {
      await api("/api/v10/guilds/cove/channels", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), icon }),
      });
      await loadChannels();
    } catch (err) { console.error("create channel:", err); }
  });
  channelList.appendChild(addBtn);
}

// ── Select channel ──

async function selectChannel(id: string) {
  activeChannelId = id;
  const ch = channels.find((c) => c.id === id);
  if (!ch) return;

  const icon = getChannelIcon(ch);
  chatHeader.icon.textContent = icon;
  chatHeader.name.textContent = ch.name;
  chatHeader.topic.textContent = ch.topic || "A cozy scene";
  mobileTitle.textContent = `${icon} ${ch.name}`;

  channelList.querySelectorAll(".channel-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.id === id);
  });

  closeSidebar();
  messageForm.classList.remove("hidden");
  await loadMessages(id);
  messageInput.focus();
}

// ── Clear messages ──

async function clearMessages() {
  if (!activeChannelId) return;
  if (!confirm("Clear all messages in this channel?")) return;
  try {
    await api(`/api/v10/channels/${activeChannelId}/messages`, { method: "DELETE" });
    await loadMessages(activeChannelId);
  } catch (err) {
    console.error("clear:", err);
  }
}

// ── Messages ──

async function loadMessages(channelId: string) {
  messagesEl.innerHTML = '<div class="loading">Loading messages…</div>';
  try {
    const msgs = await api<Message[]>(
      `/api/v10/channels/${channelId}/messages?limit=50`
    );
    renderMessages(msgs.reverse());
  } catch (err) {
    messagesEl.innerHTML =
      '<div class="empty-state"><span class="empty-emoji">😵</span><p>Failed to load messages</p></div>';
    console.error("loadMessages:", err);
  }
}

function renderMessages(msgs: Message[]) {
  if (msgs.length === 0) {
    messagesEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-emoji">🌊</span>
        <p>No messages yet — be the first!</p>
      </div>`;
    return;
  }

  messagesEl.innerHTML = "";
  for (const msg of msgs) {
    appendMessage(msg, false);
  }
  scrollToBottom();
}

function appendMessage(msg: Message, scroll = true) {
  const empty = messagesEl.querySelector(".empty-state");
  if (empty) empty.remove();

  const isSelf = msg.author.id === currentUser.id;
  const div = document.createElement("div");
  div.className = `msg ${isSelf ? "msg-self" : "msg-other"}`;
  div.dataset.id = msg.id;

  const time = formatTime(msg.timestamp);
  div.innerHTML = `
    <div class="msg-author">${escapeHtml(msg.author.username)}</div>
    <div class="msg-content">${escapeHtml(msg.content)}</div>
    <div class="msg-time">${time}</div>
  `;

  messagesEl.appendChild(div);
  if (scroll) scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// ── Send message ──

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = messageInput.value.trim();
  if (!content || !activeChannelId) return;

  messageInput.value = "";
  messageInput.focus();

  try {
    await api(`/api/v10/channels/${activeChannelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        userId: currentUser.id,
        username: currentUser.username,
      }),
    });
  } catch (err) {
    console.error("send:", err);
    messageInput.value = content;
  }
});

// ── WebSocket gateway ──

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/gateway`;
}

function connectGateway() {
  setupWs(getWsUrl());
}

function setupWs(url: string) {
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  updateConnStatus("connecting");
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[ws] connected");
    updateConnStatus("connected");
    // Identify with user info
    ws!.send(JSON.stringify({
      op: 2,
      d: { token: "user", user: currentUser },
    }));
  };

  ws.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      handleWsEvent(payload);
    } catch { /* ignore non-JSON */ }
  };

  ws.onclose = () => {
    console.log("[ws] closed");
    updateConnStatus("disconnected");
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error("[ws] error:", err);
  };
}

function handleWsEvent(payload: { t?: string; op?: number; d?: unknown }) {
  if (payload.op === 1 || payload.op === 10) {
    ws?.send(JSON.stringify({ op: 1, d: null }));
    return;
  }

  if (payload.t === "MESSAGE_CREATE") {
    const msg = payload.d as Message;
    if (msg.channel_id === activeChannelId) {
      if (messagesEl.querySelector(`[data-id="${msg.id}"]`)) return;
      appendMessage(msg, true);
    }
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(() => {
    console.log("[ws] reconnecting...");
    connectGateway();
  }, 3000);
}

// ── Connection status indicator ──

function updateConnStatus(state: "connected" | "connecting" | "disconnected") {
  let statusEl = document.querySelector(".conn-status");
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "conn-status";
    const chatArea = $("#chat-area");
    chatArea.insertBefore(statusEl, chatArea.firstChild);
  }

  const labels = {
    connected: "Connected",
    connecting: "Connecting…",
    disconnected: "Disconnected",
  };

  statusEl.innerHTML = `
    <span class="conn-dot ${state}"></span>
    <span>${labels[state]}</span>
  `;

  if (state === "connected") {
    setTimeout(() => { statusEl?.remove(); }, 2000);
  }
}

// ── Mobile sidebar ──

function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("open");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
});

sidebarOverlay.addEventListener("click", closeSidebar);

// Clear buttons
document.getElementById("clear-btn")?.addEventListener("click", clearMessages);
document.getElementById("clear-btn-mobile")?.addEventListener("click", clearMessages);

// ── Utilities ──

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return time;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  } catch {
    return "";
  }
}

// ── Init ──

async function init() {
  // Show username in sidebar
  const sidebarHeader = $(".sidebar-header");
  if (sidebarHeader) {
    const userTag = document.createElement("div");
    userTag.className = "user-tag";
    userTag.textContent = `👤 ${currentUser.username}`;
    userTag.title = "Click to change name";
    userTag.style.cursor = "pointer";
    userTag.style.fontSize = "0.8rem";
    userTag.style.opacity = "0.7";
    userTag.style.marginTop = "4px";
    userTag.addEventListener("click", () => {
      const newName = prompt("Change your name:", currentUser.username);
      if (newName && newName.trim()) {
        currentUser.username = newName.trim();
        currentUser.id = newName.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
        localStorage.setItem("cove-user", JSON.stringify(currentUser));
        userTag.textContent = `👤 ${currentUser.username}`;
      }
    });
    sidebarHeader.appendChild(userTag);
  }

  await loadChannels();
  connectGateway();
}

init();
