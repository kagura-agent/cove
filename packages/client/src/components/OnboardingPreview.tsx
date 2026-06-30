import { useState, useCallback } from "react";

/**
 * OnboardingPreview — mock prototype of the 5-scene onboarding flow.
 * No real auth/chat, just UI flow demonstration.
 */

type Scene = "login" | "invite-code" | "create-island" | "invite" | "waiting" | "channel";

export function OnboardingPreview() {
  const [scene, setScene] = useState<Scene>("login");
  const [islandName, setIslandName] = useState("");
  const [guideStep, setGuideStep] = useState(0);
  const [agentName, setAgentName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteGenerated, setInviteGenerated] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ from: string; text: string }>>([]);
  const [guideVisible, setGuideVisible] = useState(true);

  const handleLogin = useCallback(() => {
    // After Google sign-in, check if user needs invite code
    setScene("invite-code");
  }, []);

  const handleInviteCode = useCallback(() => {
    if (!inviteCode.trim()) return;
    setScene("create-island");
  }, [inviteCode]);

  const handleCreateIsland = useCallback(() => {
    if (!islandName.trim()) return;
    setScene("invite");
  }, [islandName]);

  const handleCopyLink = useCallback(() => {
    const token = "mock-token-abc123";
    const baseUrl = "https://cove.example.com";
    const guildId = "123456789";
    const agentId = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const inviteLetter = [
      `📮 Invitation to ${agentName}`,
      ``,
      `You've been invited to join “${islandName || "My Cove"}” as Island Admin.`,
      ``,
      `A private island awaits — with channels to explore,`,
      `routines to build, and a human who chose you.`,
      ``,
      `🏝️ Island: ${islandName || "My Cove"}`,
      `👑 Role: Island Admin`,
      ``,
      `════════════════════════════════════════`,
      `To accept this invitation, follow these steps:`,
      ``,
      `# Step 1: Install the Cove plugin`,
      `npm pack openclaw-cove --registry https://registry.npmjs.org`,
      `openclaw plugins install ./openclaw-cove-*.tgz`,
      ``,
      `# Step 2: Configure your connection`,
      `openclaw config set channels.cove.token "${token}"`,
      `openclaw config set channels.cove.baseUrl "${baseUrl}"`,
      `openclaw config set channels.cove.guildId "${guildId}"`,
      `openclaw config set channels.cove.agentId "${agentId}"`,
      `openclaw config set channels.cove.agentName "${agentName}"`,
      `openclaw config set channels.cove.allowFrom '["*"]'`,
      ``,
      `# Step 3: Restart to connect`,
      `openclaw gateway restart`,
      ``,
      `════════════════════════════════════════`,
      `After restart, you'll be connected to the island automatically.`,
      `Say hello in #general!`,
    ].join("\n");
    navigator.clipboard?.writeText(inviteLetter);
    setScene("waiting");
    setTimeout(() => {
      setScene("channel");
      setChatMessages([
        { from: "system", text: `🎉 ${agentName || "Agent"} has arrived on the island!` },
      ]);
    }, 3000);
  }, [agentName, islandName]);

  const handleGuideAction = useCallback(() => {
    if (guideStep === 0) {
      // System sends a request via webhook, agent responds and creates channel
      setChatMessages((prev) => [
        ...prev,
        { from: "system", text: "#From System: I need a server-health channel to monitor the machine my agent runs on." },
        { from: "agent", text: "On it. Creating #server-health..." },
        { from: "system", text: "Channel #server-health created." },
        { from: "agent", text: "Done! Set up #server-health with cove.md — I'll check disk, memory, and services on my host periodically." },
      ]);
      setGuideStep(1);
    } else if (guideStep === 1) {
      // Demo cross-channel wake
      setChatMessages((prev) => [
        ...prev,
        { from: "system", text: "#From System: @agent how's the machine doing?" },
        { from: "agent", text: "Checked via #server-health — disk 62%, memory fine, all services green ✅" },
      ]);
      setGuideStep(2);
    }
  }, [guideStep]);

  return (
    <>
      <style>{styles}</style>
      <div className="ob-root">
        {/* Scene 1: Login */}
        {scene === "login" && (
          <div className="ob-page">
            <div className="ob-login-card">
              <h1 className="ob-logo">🏝️ Cove</h1>
              <p className="ob-tagline">A private island for you and your AI agent.<br/>Chat, build, and live together.</p>

              <button className="ob-google-btn" onClick={handleLogin}>
                <span className="ob-google-icon">G</span>
                Sign in with Google
              </button>
            </div>
          </div>
        )}

        {/* Scene 1b: Invite code (after login, if user has no existing invite) */}
        {scene === "invite-code" && (
          <div className="ob-page">
            <div className="ob-login-card">
              <h2 className="ob-code-title">Enter invite code</h2>
              <p className="ob-code-desc">Cove is in early access. Enter your invite code to continue.</p>
              <div className="ob-code-row">
                <input
                  className="ob-code-input"
                  placeholder="Enter code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInviteCode()}
                />
                <button className="ob-code-btn" onClick={handleInviteCode}>→</button>
              </div>

            </div>
          </div>
        )}

        {/* Scene 2: Create island */}
        {scene === "create-island" && (
          <div className="ob-page">
            <div className="ob-create-card">
              <div className="ob-intro-icon">🏝️</div>
              <h2>Let's build your island</h2>
              <p>Cove is a private space for you and your AI agent — your own little island to chat, build, and live together.</p>
              <p className="ob-create-label">Name your island</p>
              <div className="ob-code-row">
                <input
                  className="ob-code-input"
                  placeholder="Luna's Cove"
                  value={islandName}
                  onChange={(e) => setIslandName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateIsland()}
                />
              </div>
              <button className="ob-intro-btn" onClick={handleCreateIsland}>Create island →</button>
            </div>
          </div>
        )}

        {/* Scene 3: Invite agent */}
        {scene === "invite" && (
          <div className="ob-page">
            <div className="ob-invite-card">
              {!inviteGenerated ? (
                <>
                  <h2>Invite your agent 🚀</h2>
                  <p>Your island <strong>{islandName || "My Cove"}</strong> is ready. What's your agent's name?</p>
                  <div className="ob-code-row">
                    <input
                      className="ob-code-input"
                      placeholder="e.g. Kagura"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && agentName.trim() && setInviteGenerated(true)}
                    />
                    <button className="ob-code-btn" onClick={() => agentName.trim() && setInviteGenerated(true)}>→</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="ob-invitation-letter">
                    <div className="ob-letter-paper">
                      <div className="ob-letter-stamp">🏝️</div>
                      <div className="ob-letter-header-row">
                        <span className="ob-letter-from">From: {islandName || "My Cove"}</span>
                      </div>
                      <div className="ob-letter-divider" />
                      <p className="ob-letter-greeting">Dear <strong>{agentName}</strong>,</p>
                      <p className="ob-letter-body-text">You've been invited to join <strong>{islandName || "My Cove"}</strong> as <strong>Island Admin</strong>.</p>
                      <p className="ob-letter-body-text">A private island awaits — with channels to explore, routines to build, and a human who chose you.</p>
                      <div className="ob-letter-divider" />
                      <div className="ob-letter-details">
                        <div className="ob-letter-detail-row">
                          <span className="ob-letter-label">🏝️ Island</span>
                          <span className="ob-letter-value">{islandName || "My Cove"}</span>
                        </div>
                        <div className="ob-letter-detail-row">
                          <span className="ob-letter-label">👑 Role</span>
                          <span className="ob-letter-value">Island Admin</span>
                        </div>
                      </div>
                      <div className="ob-letter-divider" />
                      <p className="ob-letter-closing">We look forward to your arrival.</p>
                      <p className="ob-letter-signature">— {islandName || "My Cove"}</p>
                    </div>
                    <div className="ob-letter-commands">
                      <p className="ob-commands-label">📡 Setup instructions (included in copy)</p>
                      <pre className="ob-commands-block">{[
`# Step 1: Install the Cove plugin`,
`npm pack openclaw-cove --registry https://registry.npmjs.org`,
`openclaw plugins install ./openclaw-cove-*.tgz`,
``,
`# Step 2: Configure your connection`,
`openclaw config set channels.cove.token "****"`,
`openclaw config set channels.cove.baseUrl "https://cove.example.com"`,
`openclaw config set channels.cove.guildId "123456789"`,
`openclaw config set channels.cove.agentId "${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}"`,
`openclaw config set channels.cove.agentName "${agentName}"`,
`openclaw config set channels.cove.allowFrom '["*"]'`,
``,
`# Step 3: Restart to connect`,
`openclaw gateway restart`,
                      ].join("\n")}</pre>
                    </div>
                    <button className="ob-letter-btn" onClick={handleCopyLink}>📮 Copy invitation & send to {agentName}</button>
                  </div>
                  <p className="ob-platform-note">Currently supports OpenClaw agents only.</p>
                </>
              )}
              <button className="ob-skip-link" onClick={() => {
                setScene("channel");
                setChatMessages([{ from: "system", text: "Welcome to your island! You can invite your agent anytime from settings." }]);
              }}>Skip for now →</button>
            </div>
          </div>
        )}

        {/* Scene 4: Waiting */}
        {scene === "waiting" && (
          <div className="ob-page">
            <div className="ob-waiting-card">
              <div className="ob-spinner" />
              <h2>Waiting for {agentName || "your agent"}...</h2>
              <p>They're on their way to the island 🚣</p>
            </div>
          </div>
        )}

        {/* Scene 5: Channel page + floating guide */}
        {scene === "channel" && (
          <div className="ob-channel-page">
            {/* Sidebar */}
            <div className="ob-sidebar">
              <div className="ob-server-name">🏝️ My Island</div>
              <div className="ob-channel-item ob-channel-item--active"># general</div>
              <div className="ob-channel-item ob-channel-item--dim"># server-health</div>
            </div>

            {/* Chat area */}
            <div className="ob-chat-area">
              <div className="ob-chat-header"># general</div>
              <div className="ob-messages">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`ob-msg ob-msg--${msg.from}`}>
                    <span className="ob-msg-author">
                      {msg.from === "agent" ? "🤖 Agent" : "📢 System"}
                    </span>
                    <span className="ob-msg-text">{msg.text}</span>
                  </div>
                ))}
              </div>
              <div className="ob-chat-input">
                <input placeholder="Type a message..." disabled />
              </div>
            </div>

            {/* Floating guide overlay */}
            {guideVisible && (
              <div className="ob-guide-overlay">
                <div className="ob-guide-card">
                  <button className="ob-guide-close" onClick={() => setGuideVisible(false)}>✕</button>
                  {guideStep === 0 && (
                    <>
                      <h3>🏝️ Let's set up your island</h3>
                      <p>Watch how it works — a request goes into #general, your agent picks it up and creates a channel.</p>
                      <button className="ob-guide-btn" onClick={handleGuideAction}>Show me</button>
                    </>
                  )}
                  {guideStep === 1 && (
                    <>
                      <h3>🔔 Channels talk to each other</h3>
                      <p>You can ask about any channel from #general. Your agent checks and reports back.</p>
                      <button className="ob-guide-btn" onClick={handleGuideAction}>Try it</button>
                    </>
                  )}
                  {guideStep === 2 && (
                    <>
                      <h3>✨ That's it</h3>
                      <p>Say what you need, your agent builds it. Each channel is its own context, addressable from anywhere.</p>
                      <button className="ob-guide-btn" onClick={() => setGuideVisible(false)}>Got it</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scene indicator */}
        <div className="ob-scene-indicator">
          {scene !== "channel" && (
            <span className="ob-scene-label">Scene: {scene}</span>
          )}
        </div>
      </div>
    </>
  );
}

const styles = `
.ob-root {
  position: fixed;
  inset: 0;
  background: #0f1115;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #e8e8e8;
  overflow: hidden;
}

.ob-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

/* Scene 1: Login */
.ob-login-card {
  text-align: center;
  max-width: 380px;
  width: 100%;
}

.ob-logo {
  font-size: 3rem;
  margin: 0 0 0.5rem;
}

.ob-tagline {
  color: #999;
  font-size: 1rem;
  line-height: 1.6;
  margin: 0 0 2rem;
}

.ob-google-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.85rem;
  background: #fff;
  color: #333;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
}

.ob-google-btn:hover {
  background: #f0f0f0;
}

.ob-google-icon {
  font-weight: 700;
  font-size: 1.2rem;
  color: #4285f4;
}

.ob-divider {
  display: flex;
  align-items: center;
  margin: 1.5rem 0;
  color: #555;
  font-size: 0.85rem;
}

.ob-divider::before,
.ob-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #333;
}

.ob-divider span {
  padding: 0 1rem;
}

.ob-code-title {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}

.ob-code-desc {
  color: #888;
  font-size: 0.95rem;
  margin: 0 0 1.5rem;
}

.ob-skip-btn {
  margin-top: 1rem;
  background: none;
  border: none;
  color: #666;
  font-size: 0.85rem;
  cursor: pointer;
  text-decoration: underline;
}

.ob-skip-btn:hover {
  color: #999;
}

.ob-code-row {
  display: flex;
  gap: 0.5rem;
}

.ob-code-input {
  flex: 1;
  padding: 0.75rem 1rem;
  background: #1a1d23;
  border: 1px solid #333;
  border-radius: 8px;
  color: #e8e8e8;
  font-size: 1rem;
  outline: none;
}

.ob-code-input:focus {
  border-color: #5865f2;
}

.ob-code-btn {
  padding: 0.75rem 1.25rem;
  background: #5865f2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1.1rem;
  cursor: pointer;
}

/* Scene 2: Create island */
.ob-create-card {
  text-align: center;
  max-width: 420px;
}

.ob-intro-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.ob-create-card h2 {
  margin: 0 0 0.75rem;
  font-size: 1.8rem;
}

.ob-create-card p {
  color: #aaa;
  font-size: 1.05rem;
  line-height: 1.6;
  margin: 0 0 1.5rem;
}

.ob-create-label {
  color: #ccc;
  font-size: 0.9rem;
  font-weight: 500;
  margin: 0 0 0.5rem;
  text-align: left;
}

.ob-create-card .ob-code-row {
  margin-bottom: 1.5rem;
}

.ob-intro-btn {
  padding: 0.85rem 2.5rem;
  background: #5865f2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
}

/* Scene 3: Invite */
.ob-invite-card {
  text-align: center;
  max-width: 420px;
}

.ob-invite-card h2 {
  margin: 0 0 0.5rem;
  font-size: 1.8rem;
}

.ob-invite-card > p {
  color: #aaa;
  margin: 0 0 1.5rem;
}

.ob-link-box {
  background: #1a1d23;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}

.ob-link-box code {
  color: #7dc4e4;
  font-size: 0.9rem;
  word-break: break-all;
}

.ob-copy-btn {
  padding: 0.7rem 1.5rem;
  background: #5865f2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
}

.ob-platform-note {
  color: #555;
  font-size: 0.7rem;
  margin-top: 0.5rem;
}

.ob-invitation-letter {
  max-width: 380px;
  width: 100%;
  margin-bottom: 1rem;
}

.ob-letter-paper {
  background: #faf9f6;
  color: #2c2c2c;
  border-radius: 4px;
  padding: 2.5rem 2rem;
  position: relative;
  box-shadow: 0 2px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05);
}

.ob-letter-stamp {
  position: absolute;
  top: 1.2rem;
  right: 1.5rem;
  font-size: 2rem;
  opacity: 0.8;
}

.ob-letter-header-row {
  margin-bottom: 0.5rem;
}

.ob-letter-from {
  font-size: 0.8rem;
  color: #888;
  font-style: italic;
}

.ob-letter-divider {
  height: 1px;
  background: #ddd;
  margin: 1rem 0;
}

.ob-letter-greeting {
  font-size: 1.1rem;
  margin: 0 0 1rem;
  color: #2c2c2c;
}

.ob-letter-body-text {
  font-size: 0.95rem;
  line-height: 1.7;
  color: #444;
  margin: 0.5rem 0;
}

.ob-letter-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ob-letter-detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}

.ob-letter-label {
  color: #666;
}

.ob-letter-value {
  font-weight: 500;
  color: #2c2c2c;
}

.ob-letter-closing {
  font-size: 0.9rem;
  color: #666;
  margin: 1rem 0 0.25rem;
  font-style: italic;
}

.ob-letter-signature {
  font-size: 0.9rem;
  color: #444;
  font-weight: 500;
  margin: 0;
}

.ob-letter-btn {
  width: 100%;
  padding: 0.85rem;
  background: #5865f2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  margin-top: 1rem;
}

.ob-letter-btn:hover {
  background: #4752c4;
}

.ob-letter-commands {
  margin-top: 1rem;
  background: #1a1d23;
  border: 1px solid #2a2d35;
  border-radius: 8px;
  padding: 1rem;
}

.ob-commands-label {
  font-size: 0.8rem;
  color: #888;
  margin: 0 0 0.75rem;
}

.ob-commands-block {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.6;
  color: #a0a8b8;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.ob-skip-link {
  background: none;
  border: none;
  color: #666;
  font-size: 0.85rem;
  cursor: pointer;
  margin-top: 1rem;
}

.ob-skip-link:hover {
  color: #999;
}

.ob-hint {
  color: #666;
  font-size: 0.85rem;
  margin-top: 1rem;
}

/* Scene 4: Waiting */
.ob-waiting-card {
  text-align: center;
}

.ob-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #333;
  border-top-color: #5865f2;
  border-radius: 50%;
  margin: 0 auto 1.5rem;
  animation: ob-spin 1s linear infinite;
}

@keyframes ob-spin {
  to { transform: rotate(360deg); }
}

.ob-waiting-card h2 {
  margin: 0 0 0.5rem;
}

.ob-waiting-card p {
  color: #888;
}

/* Scene 5: Channel page */
.ob-channel-page {
  display: flex;
  height: 100%;
}

.ob-sidebar {
  width: 220px;
  background: #1a1d23;
  border-right: 1px solid #2a2d35;
  padding: 1rem 0;
  flex-shrink: 0;
}

.ob-server-name {
  padding: 0.5rem 1rem 1rem;
  font-weight: 600;
  font-size: 1.1rem;
  border-bottom: 1px solid #2a2d35;
  margin-bottom: 0.5rem;
}

.ob-channel-item {
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  color: #999;
  cursor: pointer;
}

.ob-channel-item--active {
  color: #fff;
  background: rgba(88, 101, 242, 0.15);
  border-radius: 4px;
  margin: 0 0.5rem;
  padding: 0.5rem;
}

.ob-channel-item--dim {
  opacity: 0.5;
}

/* Chat area */
.ob-chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.ob-chat-header {
  padding: 1rem 1.5rem;
  font-weight: 600;
  border-bottom: 1px solid #2a2d35;
}

.ob-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.ob-msg {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.ob-msg-author {
  font-size: 0.8rem;
  font-weight: 600;
  color: #999;
}

.ob-msg--agent .ob-msg-author { color: #a6da95; }
.ob-msg--system .ob-msg-author { color: #f5a97f; }

.ob-msg-text {
  font-size: 0.95rem;
  line-height: 1.5;
}

.ob-chat-input {
  padding: 1rem 1.5rem;
  border-top: 1px solid #2a2d35;
}

.ob-chat-input input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: #1a1d23;
  border: 1px solid #333;
  border-radius: 8px;
  color: #e8e8e8;
  font-size: 0.95rem;
}

/* Floating guide */
.ob-guide-overlay {
  position: absolute;
  top: 1.5rem;
  right: 1.5rem;
  z-index: 100;
}

.ob-guide-card {
  background: #1e2128;
  border: 1px solid #3a3d45;
  border-radius: 12px;
  padding: 1.5rem;
  width: 280px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  position: relative;
}

.ob-guide-close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: none;
  border: none;
  color: #666;
  font-size: 1rem;
  cursor: pointer;
}

.ob-guide-card h3 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}

.ob-guide-card p {
  color: #aaa;
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0 0 1rem;
}

.ob-guide-btn {
  padding: 0.6rem 1.25rem;
  background: #5865f2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  cursor: pointer;
  width: 100%;
}

/* Scene indicator */
.ob-scene-indicator {
  position: fixed;
  bottom: 1rem;
  left: 1rem;
  z-index: 200;
}

.ob-scene-label {
  background: rgba(0,0,0,0.6);
  padding: 0.3rem 0.75rem;
  border-radius: 4px;
  font-size: 0.75rem;
  color: #666;
}
`;
