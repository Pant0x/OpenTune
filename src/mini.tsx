import React from "react";
import ReactDOM from "react-dom/client";
import "./ui/styles/global.css";
import { applyTheme } from "./ui/settings/theme";
import { MiniPlayer } from "./mini/MiniPlayer";
import { startMiniPlayerBridge } from "./mini/playerBridge";

// The mini window shares the origin (and therefore localStorage) with the main window, so the
// stored theme preference applies here too. No engine boot, no session restore — this window
// is a remote control, the main window owns playback.
applyTheme();
startMiniPlayerBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MiniPlayer />
  </React.StrictMode>,
);
