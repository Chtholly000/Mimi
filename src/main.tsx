import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./linux.css";

// Cosmetic platform styling must be ready before the first window paints.
// This is not used to select native capabilities or permission behavior.
const userAgent = navigator.userAgent;
if (/\bLinux\b/i.test(userAgent) && !/\b(Android|CrOS)\b/i.test(userAgent)) {
  document.documentElement.dataset.platform = "linux";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
