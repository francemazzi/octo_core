import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard.js";
import { Mascot } from "./Mascot.js";
import "./app.css";
import "./dashboard.css";
import "./mascot.css";

const view = new URLSearchParams(window.location.search).get("view") ?? "dashboard";
document.documentElement.dataset.view = view;

const root = document.getElementById("root");
if (!root) throw new Error("missing root");
createRoot(root).render(<StrictMode>{view === "mascot" ? <Mascot /> : <Dashboard />}</StrictMode>);
