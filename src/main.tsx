import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@adsum/tokens/tokens.css";
// La feuille du centre d aide. Sans elle, le tiroir s affiche sans aucune
// mise en forme, ce qui ne se voit qu a l execution et jamais a la compilation.
import "@adsum/ui-web/aide.css";
import { App } from "./App.js";
import "./styles.css";

document.documentElement.setAttribute("data-theme", "dark");

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
