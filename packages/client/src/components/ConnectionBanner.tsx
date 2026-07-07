type Status = "connecting" | "connected" | "disconnected";

interface ConnectionBannerProps {
  status: Status;
}

export function ConnectionBanner({ status }: ConnectionBannerProps) {
  if (status === "connected") return null;

  const modifier =
    status === "connecting"
      ? "connection-banner--connecting"
      : "connection-banner--disconnected";

  return (
    <div className={`connection-banner ${modifier}`} role="status" aria-live="polite">
      {status === "connecting" && "Connecting..."}
      {status === "disconnected" && "Disconnected"}
    </div>
  );
}
