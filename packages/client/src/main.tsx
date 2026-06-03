import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Theme initialization happens in useThemeStore (reads localStorage, applies data-theme)
import "./stores/useThemeStore";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
