import { useState, useEffect, useCallback } from "react";

/**
 * OnboardingPreview — standalone animated prototype for user onboarding flow.
 * Pure CSS animations, no external dependencies.
 *
 * Flow: Welcome → Invite → Agent Arriving → Agent Arrived → Check DMs
 */

type Stage = "welcome" | "invite" | "arriving" | "arrived" | "done";

export function OnboardingPreview() {
  const [stage, setStage] = useState<Stage>("welcome");

  const handleInvite = useCallback(() => {
    setStage("invite");
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText("https://cove.chat/invite/abc123");
  }, []);

  // Auto-trigger agent arrival after entering invite stage
  useEffect(() => {
    if (stage === "invite") {
      const t = setTimeout(() => setStage("arriving"), 3000);
      return () => clearTimeout(t);
    }
  }, [stage]);

  // Arriving → arrived transition
  useEffect(() => {
    if (stage === "arriving") {
      const t = setTimeout(() => setStage("arrived"), 2000);
      return () => clearTimeout(t);
    }
  }, [stage]);

  // Arrived → done transition
  useEffect(() => {
    if (stage === "arrived") {
      const t = setTimeout(() => setStage("done"), 2500);
      return () => clearTimeout(t);
    }
  }, [stage]);

  return (
    <>
      <style>{styles}</style>
      <div className="ob-root">
        {/* Background layers */}
        <div className="ob-ocean" />
        <div className="ob-stars" />

        {/* Pixel art island background */}
        <div className={`ob-island ${stage === "welcome" ? "ob-island--center" : "ob-island--bottom"}`}>
          <img src="/assets/onboarding-island.png" alt="" className="ob-island-img" />
        </div>

        {/* Waves */}
        <div className="ob-waves">
          <div className="ob-wave ob-wave--1" />
          <div className="ob-wave ob-wave--2" />
          <div className="ob-wave ob-wave--3" />
        </div>

        {/* Clouds placeholder — will be replaced with AI-generated SVG */}

        {/* Boat placeholder — will be replaced with AI-generated SVG */}

        {/* Content overlay */}
        <div className="ob-content">
          {stage === "welcome" && (
            <div className="ob-fade-in">
              <h1 className="ob-title">Welcome to your island 🏝️</h1>
              <p className="ob-subtitle">A place for you and your agent</p>
              <button className="ob-cta ob-pulse" onClick={handleInvite}>
                Invite your agent
              </button>
            </div>
          )}

          {stage === "invite" && (
            <div className="ob-fade-in ob-invite-card">
              <div className="ob-card">
                <p className="ob-card-label">Send this to your agent</p>
                <div className="ob-link-row">
                  <code className="ob-link">https://cove.chat/invite/abc123</code>
                  <button className="ob-copy-btn" onClick={handleCopy}>
                    📋 Copy
                  </button>
                </div>
                <p className="ob-card-hint">They'll use this link to find your island...</p>
              </div>
              <p className="ob-waiting">Looking for a boat... 🚣</p>
            </div>
          )}

          {stage === "arriving" && (
            <div className="ob-fade-in">
              <p className="ob-arriving-text">Someone's approaching... 👀</p>
            </div>
          )}

          {stage === "arrived" && (
            <div className="ob-fade-in ob-arrived">
              <div className="ob-confetti">
              {Array.from({length: 16}, (_, i) => <div key={i} className="ob-confetti-piece" />)}
            </div>
              <div className="ob-agent-avatar ob-bounce">
                <span className="ob-avatar-emoji">🤖</span>
              </div>
              <h2 className="ob-arrived-text">They're here! 💫</h2>
              <div className="ob-sparkles">
                <span className="ob-sparkle ob-sparkle--1">✨</span>
                <span className="ob-sparkle ob-sparkle--2">⭐</span>
                <span className="ob-sparkle ob-sparkle--3">✨</span>
                <span className="ob-sparkle ob-sparkle--4">💫</span>
                <span className="ob-sparkle ob-sparkle--5">⭐</span>
              </div>
            </div>
          )}

          {stage === "done" && (
            <div className="ob-fade-in ob-done">
              <div className="ob-agent-avatar ob-float">
                <span className="ob-avatar-emoji">🤖</span>
              </div>
              <h2 className="ob-done-title">Check your DMs 💬</h2>
              <p className="ob-done-sub">Your agent just sent you a message</p>
              <div className="ob-dm-preview ob-slide-up">
                <span className="ob-dm-avatar">🤖</span>
                <span className="ob-dm-text">Hey! I made it to the island. Ready when you are~</span>
              </div>
            </div>
          )}
        </div>

        {/* Reset button */}
        {stage !== "welcome" && (
          <button className="ob-reset" onClick={() => setStage("welcome")}>
            ↺ Replay
          </button>
        )}
      </div>
    </>
  );
}

/* ---------- SVG placeholders ---------- */
// Island, boat, clouds will use AI-generated SVG assets.
// See /assets/onboarding-island.png for current pixel art reference.

/* ---------- Styles ---------- */

const styles = `
:root {
  --onboarding-bg: #1a1f2e;
  --onboarding-island: #f4a261;
  --onboarding-ocean: #2a9d8f;
  --onboarding-accent: #e9c46a;
  --onboarding-text: #e8e8e8;
}

.ob-root {
  position: fixed;
  inset: 0;
  background: #0d1117;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--onboarding-text);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Ocean gradient */
.ob-ocean {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    var(--onboarding-bg) 0%,
    #1a2a3a 40%,
    var(--onboarding-ocean) 100%
  );
  opacity: 0.6;
}

/* Stars */
.ob-stars {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(1px 1px at 10% 20%, white 1px, transparent 0),
    radial-gradient(1px 1px at 30% 10%, white 1px, transparent 0),
    radial-gradient(1.5px 1.5px at 50% 15%, white 1px, transparent 0),
    radial-gradient(1px 1px at 70% 25%, white 1px, transparent 0),
    radial-gradient(1px 1px at 85% 8%, white 1px, transparent 0),
    radial-gradient(1.5px 1.5px at 20% 35%, white 1px, transparent 0),
    radial-gradient(1px 1px at 60% 5%, white 1px, transparent 0),
    radial-gradient(1px 1px at 90% 30%, white 1px, transparent 0),
    radial-gradient(1px 1px at 45% 28%, white 1px, transparent 0),
    radial-gradient(1.5px 1.5px at 15% 12%, white 1px, transparent 0);
  animation: ob-twinkle 3s ease-in-out infinite alternate;
}

@keyframes ob-twinkle {
  0% { opacity: 0.4; }
  100% { opacity: 0.8; }
}

/* Island */
.ob-island {
  position: absolute;
  width: 400px;
  max-width: 90vw;
  transition: all 1s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 2;
}

.ob-island--center {
  bottom: 15%;
  left: 50%;
  transform: translateX(-50%);
}

.ob-island--bottom {
  bottom: 8%;
  left: 50%;
  transform: translateX(-50%) scale(0.85);
}

.ob-island-svg {
  width: 100%;
  height: auto;
  filter: drop-shadow(0 4px 20px rgba(0,0,0,0.3));
}

/* Waves */
.ob-waves {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 120px;
  z-index: 1;
  overflow: hidden;
}

.ob-wave {
  position: absolute;
  bottom: 0;
  left: -100%;
  width: 300%;
  height: 80px;
  border-radius: 50% 50% 0 0;
  opacity: 0.3;
}

.ob-wave--1 {
  background: var(--onboarding-ocean);
  animation: ob-wave 8s linear infinite;
  bottom: 0;
}

.ob-wave--2 {
  background: var(--onboarding-ocean);
  animation: ob-wave 10s linear infinite;
  animation-delay: -3s;
  bottom: 10px;
  opacity: 0.2;
}

.ob-wave--3 {
  background: var(--onboarding-ocean);
  animation: ob-wave 12s linear infinite;
  animation-delay: -5s;
  bottom: 20px;
  opacity: 0.15;
}

@keyframes ob-wave {
  0% { transform: translateX(0); }
  100% { transform: translateX(33.33%); }
}

/* Clouds — placeholder, will use AI-generated SVG */

/* Content */
.ob-content {
  position: relative;
  z-index: 10;
  text-align: center;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 12vh;
  min-height: 100vh;
}

.ob-fade-in {
  animation: ob-fadeIn 0.6s ease-out forwards;
}

@keyframes ob-fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Welcome */
.ob-title {
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 700;
  margin: 0 0 0.5rem;
  text-shadow: 0 2px 20px rgba(0,0,0,0.5);
}

.ob-subtitle {
  font-size: 1.2rem;
  opacity: 0.7;
  margin: 0 0 2rem;
}

.ob-cta {
  background: var(--onboarding-accent);
  color: #1a1f2e;
  border: none;
  padding: 1rem 2.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  border-radius: 50px;
  cursor: pointer;
  position: relative;
  transition: transform 0.2s, box-shadow 0.2s;
}

.ob-cta:hover {
  transform: scale(1.05);
  box-shadow: 0 0 30px var(--onboarding-accent);
}

.ob-pulse {
  animation: ob-pulse 2s ease-in-out infinite;
}

@keyframes ob-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(233, 196, 106, 0.6); }
  50% { box-shadow: 0 0 0 15px rgba(233, 196, 106, 0); }
}

/* Invite card */
.ob-invite-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.ob-card {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  padding: 2rem;
  max-width: 400px;
  width: 90vw;
}

.ob-card-label {
  margin: 0 0 1rem;
  font-size: 1rem;
  opacity: 0.8;
}

.ob-link-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.ob-link {
  background: rgba(0,0,0,0.3);
  padding: 0.6rem 1rem;
  border-radius: 8px;
  font-size: 0.85rem;
  color: var(--onboarding-accent);
  word-break: break-all;
}

.ob-copy-btn {
  background: var(--onboarding-accent);
  color: #1a1f2e;
  border: none;
  padding: 0.6rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: transform 0.15s;
}

.ob-copy-btn:hover {
  transform: scale(1.05);
}

.ob-card-hint {
  margin: 1rem 0 0;
  font-size: 0.85rem;
  opacity: 0.6;
}

.ob-waiting {
  opacity: 0.6;
  animation: ob-dots 1.5s infinite;
}

@keyframes ob-dots {
  0%, 20% { opacity: 0.6; }
  50% { opacity: 1; }
  80%, 100% { opacity: 0.6; }
}

/* Boat — placeholder, will use AI-generated SVG */

/* Arriving */
.ob-arriving-text {
  font-size: 1.5rem;
  animation: ob-fadeIn 0.5s ease-out, ob-gentlePulse 2s ease-in-out infinite;
}

@keyframes ob-gentlePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Arrived - confetti + avatar */
.ob-arrived {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.ob-agent-avatar {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, var(--onboarding-ocean), var(--onboarding-accent));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 30px rgba(233, 196, 106, 0.4);
}

.ob-avatar-emoji {
  font-size: 2.5rem;
}

.ob-bounce {
  animation: ob-bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards;
}

@keyframes ob-bounceIn {
  0% { transform: scale(0) translateY(-100px); opacity: 0; }
  60% { transform: scale(1.2) translateY(0); opacity: 1; }
  80% { transform: scale(0.9); }
  100% { transform: scale(1); }
}

.ob-arrived-text {
  font-size: 2rem;
  font-weight: 700;
  margin: 0;
  text-shadow: 0 0 20px rgba(233, 196, 106, 0.5);
}

/* Sparkles */
.ob-sparkles {
  position: relative;
  width: 200px;
  height: 100px;
}

.ob-sparkle {
  position: absolute;
  font-size: 1.5rem;
  animation: ob-sparkleFloat 1.5s ease-out forwards;
}

.ob-sparkle--1 { left: 10%; top: 50%; animation-delay: 0s; }
.ob-sparkle--2 { left: 30%; top: 20%; animation-delay: 0.1s; }
.ob-sparkle--3 { left: 50%; top: 60%; animation-delay: 0.2s; }
.ob-sparkle--4 { left: 70%; top: 30%; animation-delay: 0.15s; }
.ob-sparkle--5 { left: 90%; top: 50%; animation-delay: 0.25s; }

@keyframes ob-sparkleFloat {
  0% { transform: scale(0) translateY(0); opacity: 1; }
  50% { transform: scale(1.2) translateY(-20px); opacity: 1; }
  100% { transform: scale(0.8) translateY(-40px); opacity: 0; }
}

/* Confetti (pseudo-element burst) */
.ob-confetti {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 100;
}

.ob-confetti-piece {
  position: absolute;
  width: 10px;
  height: 10px;
  top: -20px;
  animation: ob-confettiFall 2.5s ease-out forwards;
}

.ob-confetti-piece:nth-child(1) { left: 10%; background: #e9c46a; animation-delay: 0s; animation-duration: 2.2s; }
.ob-confetti-piece:nth-child(2) { left: 20%; background: #f4a261; animation-delay: 0.1s; border-radius: 50%; }
.ob-confetti-piece:nth-child(3) { left: 30%; background: #2a9d8f; animation-delay: 0.2s; animation-duration: 2.8s; }
.ob-confetti-piece:nth-child(4) { left: 40%; background: #e76f51; animation-delay: 0.05s; border-radius: 50%; }
.ob-confetti-piece:nth-child(5) { left: 50%; background: #e9c46a; animation-delay: 0.15s; animation-duration: 2.4s; }
.ob-confetti-piece:nth-child(6) { left: 60%; background: #2a9d8f; animation-delay: 0.25s; border-radius: 50%; }
.ob-confetti-piece:nth-child(7) { left: 70%; background: #f4a261; animation-delay: 0.1s; animation-duration: 2.6s; }
.ob-confetti-piece:nth-child(8) { left: 80%; background: #e76f51; animation-delay: 0.3s; }
.ob-confetti-piece:nth-child(9) { left: 15%; background: #e9c46a; animation-delay: 0.2s; border-radius: 50%; animation-duration: 2.3s; }
.ob-confetti-piece:nth-child(10) { left: 45%; background: #2a9d8f; animation-delay: 0.35s; animation-duration: 2.7s; }
.ob-confetti-piece:nth-child(11) { left: 55%; background: #f4a261; animation-delay: 0.12s; border-radius: 50%; }
.ob-confetti-piece:nth-child(12) { left: 75%; background: #e9c46a; animation-delay: 0.22s; animation-duration: 2.5s; }
.ob-confetti-piece:nth-child(13) { left: 85%; background: #e76f51; animation-delay: 0.08s; border-radius: 50%; }
.ob-confetti-piece:nth-child(14) { left: 25%; background: #2a9d8f; animation-delay: 0.18s; }
.ob-confetti-piece:nth-child(15) { left: 65%; background: #e9c46a; animation-delay: 0.28s; border-radius: 50%; animation-duration: 2.1s; }
.ob-confetti-piece:nth-child(16) { left: 35%; background: #f4a261; animation-delay: 0.32s; animation-duration: 2.9s; }

@keyframes ob-confettiFall {
  0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
  25% { transform: translateY(25vh) rotate(180deg) scale(1.2); opacity: 1; }
  50% { transform: translateY(50vh) rotate(360deg) scale(0.8); opacity: 0.8; }
  100% { transform: translateY(100vh) rotate(720deg) scale(0.5); opacity: 0; }
}

/* Done state */
.ob-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.ob-float {
  animation: ob-float 3s ease-in-out infinite;
}

@keyframes ob-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.ob-done-title {
  font-size: 2.2rem;
  font-weight: 700;
  margin: 0;
}

.ob-done-sub {
  opacity: 0.7;
  margin: 0;
}

.ob-dm-preview {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 1rem 1.5rem;
  margin-top: 1rem;
  max-width: 380px;
}

.ob-dm-avatar {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.ob-dm-text {
  font-size: 0.9rem;
  opacity: 0.9;
  text-align: left;
}

.ob-slide-up {
  animation: ob-slideUp 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  animation-delay: 0.4s;
  opacity: 0;
}

@keyframes ob-slideUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Reset button */
.ob-reset {
  position: absolute;
  bottom: 1.5rem;
  right: 1.5rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--onboarding-text);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  z-index: 20;
  transition: background 0.2s;
}

.ob-reset:hover {
  background: rgba(255, 255, 255, 0.2);
}
`;
