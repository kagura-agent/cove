type Status = "connecting" | "connected" | "disconnected";

interface ConnectionBannerProps {
  status: Status;
  serverName?: string;
  serverIcon?: string | null;
}

export function ConnectionBanner({ status, serverName, serverIcon }: ConnectionBannerProps) {
  const modifier =
    status === "connecting"
      ? "connection-banner--connecting"
      : status === "disconnected"
        ? "connection-banner--disconnected"
        : "connection-banner--normal";

  return (
    <div className={`connection-banner ${modifier}`} role="status" aria-live="polite">
      {status === "connecting" && "Connecting..."}
      {status === "disconnected" && "Disconnected"}
      {status === "connected" && (
        <>
          {serverIcon ? (
            <img className="connection-banner__icon" src={serverIcon} alt="" />
          ) : serverName ? (
            <span className="connection-banner__fallback">{serverName[0].toUpperCase()}</span>
          ) : null}
          {serverName || ""}
        </>
      )}
    </div>
  );
}
