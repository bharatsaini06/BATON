import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { loadStore } from "./store";

void loadStore();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
