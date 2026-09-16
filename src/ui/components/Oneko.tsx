import { useEffect, useRef } from "react";
import classicGif from "@/assets/oneko/oneko-classic.gif";
import dogGif from "@/assets/oneko/oneko-dog.gif";
import toraGif from "@/assets/oneko/oneko-tora.gif";
import maiaGif from "@/assets/oneko/oneko-maia.gif";
import vaporwaveGif from "@/assets/oneko/oneko-vaporwave.gif";
import {
  setOnekoKuroneko,
  useOnekoEnabled,
  useOnekoKuroneko,
  useOnekoVariant,
  type OnekoVariant,
} from "../settings/playerAddons";

const VARIANT_ASSETS: Record<OnekoVariant, string> = {
  classic: classicGif,
  dog: dogGif,
  tora: toraGif,
  maia: maiaGif,
  vaporwave: vaporwaveGif,
};

const SPRITE_SETS: Record<string, [number, number][]> = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
  scratchSelf: [
    [-5, 0],
    [-6, 0],
    [-7, 0],
  ],
  scratchWallN: [
    [0, 0],
    [0, -1],
  ],
  scratchWallS: [
    [-7, -1],
    [-6, -2],
  ],
  scratchWallE: [
    [-2, -2],
    [-2, -3],
  ],
  scratchWallW: [
    [-4, 0],
    [-4, -1],
  ],
  tired: [[-3, -2]],
  sleeping: [
    [-2, 0],
    [-2, -1],
  ],
  N: [
    [-1, -2],
    [-1, -3],
  ],
  NE: [
    [0, -2],
    [0, -3],
  ],
  E: [
    [-3, 0],
    [-3, -1],
  ],
  SE: [
    [-5, -1],
    [-5, -2],
  ],
  S: [
    [-6, -3],
    [-7, -2],
  ],
  SW: [
    [-5, -3],
    [-6, -1],
  ],
  W: [
    [-4, -2],
    [-4, -3],
  ],
  NW: [
    [-1, 0],
    [-1, -1],
  ],
};

/**
 * 1:1 authentic Spicetify Oneko implementation directly from kyrie25/spicetify-oneko / adryd325/oneko.js.
 *
 * Supports:
 * - 32x32 pixel spritesheet coordinate mapping across all original directions and moods.
 * - Cursor chasing at 100ms intervals with acceleration and boundary clamping.
 * - Interactive dragging: dragging the cat makes it scratch/claw in the opposite direction.
 * - Double-click: makes the cat walk to the player seekbar and curl up asleep on top of the bar!
 * - Right-click: toggles Kuroneko (inverts 100% colors to become a black cat).
 * - Variants: Classic, Dog, Tora, Maia, Vaporwave.
 */
export function Oneko() {
  const enabled = useOnekoEnabled();
  const variant = useOnekoVariant();
  const kuroNeko = useOnekoKuroneko();
  const nekoElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const el = nekoElRef.current;
    if (!el) return;

    let nekoPosX = 64;
    let nekoPosY = 64;
    let mousePosX = window.innerWidth / 2;
    let mousePosY = window.innerHeight / 2;
    let frameCount = 0;
    let idleTime = 0;
    let idleAnimation: string | null = null;
    let idleAnimationFrame = 0;
    let forceSleep = false;
    let grabbing = false;
    let grabStop = true;
    let nudge = false;

    const nekoSpeed = 10;

    const getSprite = (name: string, frame: number): [number, number] => {
      const set = SPRITE_SETS[name] ?? SPRITE_SETS.idle;
      return set[frame % set.length];
    };

    const setSprite = (name: string, frame: number) => {
      const sprite = getSprite(name, frame);
      el.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
    };

    const resetIdleAnimation = () => {
      idleAnimation = null;
      idleAnimationFrame = 0;
    };

    const sleep = () => {
      forceSleep = !forceSleep;
      nudge = false;
      if (!forceSleep) {
        resetIdleAnimation();
        return;
      }

      // Seekbar / progress bar target
      const progressBar =
        document.querySelector(".group\\/seek") ||
        document.querySelector("#playback-seekbar") ||
        document.querySelector(".playback-progressbar");

      if (progressBar) {
        const rect = progressBar.getBoundingClientRect();
        mousePosX = rect.right - 28;
        mousePosY = rect.top - 8;
      } else {
        mousePosX = window.innerWidth - 64;
        mousePosY = window.innerHeight - 64;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (forceSleep) return;
      mousePosX = e.clientX;
      mousePosY = e.clientY;
    };

    const onResize = () => {
      if (forceSleep) {
        forceSleep = false;
        sleep();
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      grabbing = true;
      let startX = e.clientX;
      let startY = e.clientY;
      let startNekoX = nekoPosX;
      let startNekoY = nekoPosY;
      let grabInterval: number | undefined;

      const onDragMove = (ev: MouseEvent) => {
        const deltaX = ev.clientX - startX;
        const deltaY = ev.clientY - startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        // Scratch in the opposite direction of the drag
        if (absDeltaX > absDeltaY && absDeltaX > 10) {
          setSprite(deltaX > 0 ? "scratchWallW" : "scratchWallE", frameCount);
        } else if (absDeltaY > absDeltaX && absDeltaY > 10) {
          setSprite(deltaY > 0 ? "scratchWallN" : "scratchWallS", frameCount);
        }

        if (grabStop || absDeltaX > 10 || absDeltaY > 10 || Math.hypot(deltaX, deltaY) > 10) {
          grabStop = false;
          window.clearTimeout(grabInterval);
          grabInterval = window.setTimeout(() => {
            grabStop = true;
            nudge = false;
            startX = ev.clientX;
            startY = ev.clientY;
            startNekoX = nekoPosX;
            startNekoY = nekoPosY;
          }, 150);
        }

        nekoPosX = startNekoX + ev.clientX - startX;
        nekoPosY = startNekoY + ev.clientY - startY;
        el.style.left = `${nekoPosX - 16}px`;
        el.style.top = `${nekoPosY - 16}px`;
      };

      const onDragEnd = () => {
        grabbing = false;
        nudge = true;
        resetIdleAnimation();
        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("mouseup", onDragEnd);
      };

      window.addEventListener("mousemove", onDragMove);
      window.addEventListener("mouseup", onDragEnd);
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setOnekoKuroneko(!kuroNeko);
    };

    const onDblClick = () => {
      sleep();
    };

    const idle = () => {
      idleTime += 1;

      // Random idle animation every ~20 seconds
      if (idleTime > 10 && Math.floor(Math.random() * 200) === 0 && idleAnimation === null) {
        const available: string[] = ["sleeping", "scratchSelf"];
        if (nekoPosX < 32) available.push("scratchWallW");
        if (nekoPosY < 32) available.push("scratchWallN");
        if (nekoPosX > window.innerWidth - 32) available.push("scratchWallE");
        if (nekoPosY > window.innerHeight - 32) available.push("scratchWallS");
        idleAnimation = available[Math.floor(Math.random() * available.length)];
      }

      if (forceSleep) {
        idleAnimation = "sleeping";
      }

      switch (idleAnimation) {
        case "sleeping":
          if (idleAnimationFrame < 8 && nudge && forceSleep) {
            setSprite("idle", 0);
            break;
          } else if (nudge) {
            nudge = false;
            resetIdleAnimation();
          }
          if (idleAnimationFrame < 8) {
            setSprite("tired", 0);
            break;
          }
          setSprite("sleeping", Math.floor(idleAnimationFrame / 4));
          if (idleAnimationFrame > 192 && !forceSleep) {
            resetIdleAnimation();
          }
          break;
        case "scratchWallN":
        case "scratchWallS":
        case "scratchWallE":
        case "scratchWallW":
        case "scratchSelf":
          setSprite(idleAnimation, idleAnimationFrame);
          if (idleAnimationFrame > 9) {
            resetIdleAnimation();
          }
          break;
        default:
          setSprite("idle", 0);
          return;
      }
      idleAnimationFrame += 1;
    };

    const frame = () => {
      frameCount += 1;

      if (grabbing) {
        if (grabStop) setSprite("alert", 0);
        return;
      }

      const diffX = nekoPosX - mousePosX;
      const diffY = nekoPosY - mousePosY;
      const distance = Math.hypot(diffX, diffY);

      // Sleep on top of seekbar
      if (forceSleep && Math.abs(diffY) < nekoSpeed && Math.abs(diffX) < nekoSpeed) {
        nekoPosX = mousePosX;
        nekoPosY = mousePosY;
        el.style.left = `${nekoPosX - 16}px`;
        el.style.top = `${nekoPosY - 16}px`;
        idle();
        return;
      }

      if ((distance < nekoSpeed || distance < 48) && !forceSleep) {
        idle();
        return;
      }

      idleAnimation = null;
      idleAnimationFrame = 0;

      if (idleTime > 1) {
        setSprite("alert", 0);
        idleTime = Math.min(idleTime, 7) - 1;
        return;
      }

      let direction = diffY / distance > 0.5 ? "N" : "";
      direction += diffY / distance < -0.5 ? "S" : "";
      direction += diffX / distance > 0.5 ? "W" : "";
      direction += diffX / distance < -0.5 ? "E" : "";
      setSprite(direction, frameCount);

      nekoPosX -= (diffX / distance) * nekoSpeed;
      nekoPosY -= (diffY / distance) * nekoSpeed;

      nekoPosX = Math.min(Math.max(16, nekoPosX), window.innerWidth - 16);
      nekoPosY = Math.min(Math.max(16, nekoPosY), window.innerHeight - 16);

      el.style.left = `${nekoPosX - 16}px`;
      el.style.top = `${nekoPosY - 16}px`;
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("resize", onResize);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("dblclick", onDblClick);

    const intervalId = window.setInterval(frame, 100);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("dblclick", onDblClick);
    };
  }, [enabled, kuroNeko]);

  if (!enabled) return null;

  const bgUrl = VARIANT_ASSETS[variant] || VARIANT_ASSETS.classic;

  return (
    <div
      ref={nekoElRef}
      id="oneko"
      title="Oneko Cat (Double-click to sleep on seekbar, Right-click for Kuroneko, Drag to throw)"
      style={{
        width: "32px",
        height: "32px",
        position: "fixed",
        backgroundImage: `url(${bgUrl})`,
        imageRendering: "pixelated",
        left: "32px",
        top: "32px",
        zIndex: 99999,
        cursor: "grab",
        filter: kuroNeko ? "invert(100%)" : "none",
        userSelect: "none",
      }}
    />
  );
}
