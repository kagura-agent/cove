import React from "react";

type ToggleState = "allow" | "neutral" | "deny";

interface Props {
  value: ToggleState;
  onChange: (value: ToggleState) => void;
  disabled?: boolean;
  label: string;
}

export function ThreeStateToggle({ value, onChange, disabled, label }: Props) {
  const states: ToggleState[] = ["allow", "neutral", "deny"];
  const labels = { allow: "✓", neutral: "—", deny: "✕" };
  const colors = {
    allow: { bg: "#248046", text: "#fff" },
    neutral: { bg: "#4e5058", text: "#b5bac1" },
    deny: { bg: "#da373c", text: "#fff" },
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
      <span style={{ color: disabled ? "#72767d" : "#b5bac1", fontSize: 14 }}>{label}</span>
      <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", border: "1px solid #3f4147" }}>
        {states.map((state) => {
          const active = value === state;
          const { bg, text } = colors[state];
          return (
            <button
              key={state}
              disabled={disabled}
              onClick={() => onChange(state)}
              style={{
                padding: "4px 10px",
                border: "none",
                backgroundColor: active ? bg : "#2b2d31",
                color: active ? text : "#72767d",
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                opacity: disabled ? 0.5 : 1,
                minWidth: 36,
              }}
            >
              {labels[state]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
