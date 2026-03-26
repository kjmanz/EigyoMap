import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import { App } from "./App";

registerSW({ immediate: true });

/** GitHub Pages 等のサブパス配信用（Vite の `base` と一致） */
function routerBasename(): string | undefined {
  const b = import.meta.env.BASE_URL;
  if (b === "/" || b === "") return undefined;
  return b.endsWith("/") ? b.slice(0, -1) : b;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
