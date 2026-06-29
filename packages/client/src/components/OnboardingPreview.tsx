import { useState, useCallback } from "react";

/**
 * OnboardingPreview — mock prototype of the 5-scene onboarding flow.
 * No real auth/chat, just UI flow demonstration.
 */

type Scene = "login" | "intro" | "invite" | "waiting" | "channel";

export function OnboardingPreview() {
  const [scene, setScene] = useState<Scene>("login");
  const [introPage, setIntroPage] = useState(0);
  const [guideStep, setGuideStep] = useState(0);
  const [inviteCode, setInviteCode] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ from: string; text: string }>>([]);
  const [guideVisible, setGuideVisible] = useState(true);

  const handleLogin = useCallback(() => {
    if (!inviteCode.trim()) return;
    setScene("intro");
  }, [inviteCode]);

  const handleIntroNext = useCallback(() => {
    if (introPage < 2) {
      setIntroPage((p) => p + 1);
    } else {
      setScene("invite");
    }
  }, [introPage]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard?.writeText("https://cove.chat/invite/abc123");
    setScene("waiting");
    // Simulate agent connecting after 3s
    setTimeout(() => {
      setScene("channel");
      setChatMessages([
        { from: "system", text: "🏝️ Your agent has arrived on the island!" },
      ]);
    }, 3000);
  }, []);

  const handleGuideAction = useCallback(() => {
    if (guideStep === 0) {
      // Send intro to agent
      setChatMessages((prev) => [
        ...prev,
        { from: "cove", text: "Welcome to Cove! This is a private island for you and your agent. You can chat, build tools, and create routines together here." },
        { from: "agent", text: "Thanks! I'm excited to be here. What should we set up first?" },
      ]);
      setGuideStep(1);
    } else if (guideStep === 1) {
      // Create health channel
      setChatMessages((prev) => [
        ...prev,
        { from: "cove", text: "Let's set up your first channel: #server-health — your agent will monitor the island's wellbeing here." },
        { from: "agent", text: "Done! I've created #server-health. I'll keep an eye on things for you 👀" },
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

              <button className="ob-google-btn">
                <span className="ob-google-icon">G</span>
                Sign in with Google
              </button>

              <div className="ob-divider"><span>or enter invite code</span></div>

              <div className="ob-code-row">
                <input
                  className="ob-code-input"
                  placeholder="Invite code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
                <button className="ob-code-btn" onClick={handleLogin}>→</button>
              </div>
            </div>
          </div>
        )}

        {/* Scene 2: Intro carousel */}
        {scene === "intro" && (
          <div className="ob-page">
            <div className="ob-intro-card">
              {introPage === 0 && (
                <>
                  <div className="ob-intro-icon">🏝️</div>
                  <h2>What is Cove?</h2>
                  <p>Your private space with your AI agent — an island that belongs to just the two of you.</p>
                </>
              )}
              {introPage === 1 && (
                <>
                  <div className="ob-intro-icon">💬</div>
                  <h2>What can you do here?</h2>
                  <p>Chat with your agent, set up routines, build tools, and organize your world into channels.</p>
                </>
              )}
              {introPage === 2 && (
                <>
                  <div className="ob-intro-icon">🌊</div>
                  <h2>Your island awaits</h2>
                  <p>First, let's invite your agent to join you. They'll need a link to find the island.</p>
                </>
              )}
              <div className="ob-intro-dots">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`ob-dot ${i === introPage ? "ob-dot--active" : ""}`} />
                ))}
              </div>
              <button className="ob-intro-btn" onClick={handleIntroNext}>
                {introPage < 2 ? "Next" : "Let's go →"}
              </button>
            </div>
          </div>
        )}

        {/* Scene 3: Invite agent */}
        {scene === "invite" && (
          <div className="ob-page">
            <div className="ob-invite-card">
              <h2>Invite your agent 🚀</h2>
              <p>Send this link to your agent. They'll use it to find your island.</p>
              <div className="ob-link-box">
                <code>https://cove.chat/invite/abc123</code>
                <button className="ob-copy-btn" onClick={handleCopyLink}>Copy & Continue</button>
              </div>
              <p className="ob-hint">After copying, send this to your agent in whatever chat you use with them.</p>
            </div>
          </div>
        )}

        {/* Scene 4: Waiting */}
        {scene === "waiting" && (
          <div className="ob-page">
            <div className="ob-waiting-card">
              <div className="ob-spinner" />
              <h2>Waiting for your agent...</h2>
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
                      {msg.from === "cove" ? "🏝️ Cove" : msg.from === "agent" ? "🤖 Agent" : "📢 System"}
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
                      <h3>🎉 Your agent is here!</h3>
                      <p>Let's introduce Cove to your agent so they know how things work here.</p>
                      <button className="ob-guide-btn" onClick={handleGuideAction}>Send introduction</button>
                    </>
                  )}
                  {guideStep === 1 && (
                    <>
                      <h3>🏥 Island Health Center</h3>
                      <p>Want your agent to keep an eye on the island? Set up a health monitoring channel.</p>
                      <button className="ob-guide-btn" onClick={handleGuideAction}>Set it up</button>
                    </>
                  )}
                  {guideStep === 2 && (
                    <>
                      <h3>✅ You're all set!</h3>
                      <p>Your island is ready. Explore, chat with your agent, and make it your own.</p>
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

/* Scene 2: Intro */
.ob-intro-card {
  text-align: center;
  max-width: 400px;
}

.ob-intro-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.ob-intro-card h2 {
  margin: 0 0 0.75rem;
  font-size: 1.8rem;
}

.ob-intro-card p {
  color: #aaa;
  font-size: 1.1rem;
  line-height: 1.6;
  margin: 0 0 2rem;
}

.ob-intro-dots {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-bottom: 1.5rem;
}

.ob-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #333;
}

.ob-dot--active {
  background: #5865f2;
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

.ob-msg--cove .ob-msg-author { color: #7dc4e4; }
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
