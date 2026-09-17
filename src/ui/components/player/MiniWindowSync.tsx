import { useEffect } from "react";
import { playerUIStore } from "../../stores/playerUIStore";
import { MINI_CLOSE_REQUEST_EVENT } from "../../../player/miniBridge";
import { closeMiniWindow, openMiniWindow } from "../../miniWindow";

/**
 * Keeps the `isWaveMiniPlayerOpen` flag and the external mini OS window in lockstep.
 *
 * The mini player lives outside the main window now (its own WebviewWindow serving
 * mini.html), so this renders nothing — opening the flag opens the window, clearing it
 * closes the window, and the window asking to close clears the flag.
 */
export function MiniWindowSync({ isOpen }: { isOpen: boolean }) {
  useEffect(() => {
    if (isOpen) {
      void openMiniWindow();
    } else {
      void closeMiniWindow();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleCloseRequest = () => {
      playerUIStore.setWaveMiniPlayerOpen(false);
    };
    window.addEventListener(MINI_CLOSE_REQUEST_EVENT, handleCloseRequest);
    return () => {
      window.removeEventListener(MINI_CLOSE_REQUEST_EVENT, handleCloseRequest);
    };
  }, []);

  return null;
}
