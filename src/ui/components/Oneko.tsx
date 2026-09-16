import { useEffect, useRef } from "react";
import { useOnekoEnabled } from "../settings/playerAddons";

export function Oneko() {
  const enabled = useOnekoEnabled();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let posX = window.innerWidth / 2;
    let posY = window.innerHeight / 2;
    let targetX = posX;
    let targetY = posY;
    let frame = 0;
    let idleCounter = 0;
    let animId: number;

    const onMouseMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      idleCounter = 0;
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    // Draw retro pixel cat
    const drawCat = (x: number, y: number, state: "run" | "sit" | "sleep", dirX: number, step: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      if (dirX < 0) {
        ctx.scale(-1, 1);
      }

      // Cat Body Colors
      const coat = "#f59e0b"; // warm amber cat
      const belly = "#fef3c7"; // cream belly
      const dark = "#b45309"; // markings
      const eyes = "#1e293b"; // dark eyes
      const nose = "#f43f5e"; // pink nose

      if (state === "sleep") {
        // Sleeping curled up cat
        ctx.fillStyle = coat;
        ctx.beginPath();
        ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = belly;
        ctx.beginPath();
        ctx.ellipse(2, 1, 8, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Ears
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(-8, -4);
        ctx.lineTo(-11, -9);
        ctx.lineTo(-5, -6);
        ctx.fill();

        // Sleeping eye line
        ctx.strokeStyle = eyes;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(4, -1);
        ctx.lineTo(8, -1);
        ctx.stroke();

        // Floating 'Z'
        const zOffset = (frame % 60) / 60;
        ctx.fillStyle = `rgba(255, 255, 255, ${1 - zOffset})`;
        ctx.font = "bold 10px monospace";
        ctx.fillText("z", 6 + zOffset * 4, -8 - zOffset * 10);
      } else if (state === "sit") {
        // Sitting cat with blinking / tail wag
        ctx.fillStyle = coat;
        // Body
        ctx.beginPath();
        ctx.ellipse(0, 2, 8, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.beginPath();
        ctx.arc(0, -7, 7, 0, Math.PI * 2);
        ctx.fill();

        // Ears
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(-6, -11);
        ctx.lineTo(-3, -15);
        ctx.lineTo(-1, -11);
        ctx.moveTo(1, -11);
        ctx.lineTo(3, -15);
        ctx.lineTo(6, -11);
        ctx.fill();

        // Eyes (blink every 80 frames)
        const isBlinking = frame % 80 > 75;
        if (!isBlinking) {
          ctx.fillStyle = eyes;
          ctx.fillRect(-4, -8, 2, 3);
          ctx.fillRect(2, -8, 2, 3);
        } else {
          ctx.strokeStyle = eyes;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(-4, -7);
          ctx.lineTo(-2, -7);
          ctx.moveTo(2, -7);
          ctx.lineTo(4, -7);
          ctx.stroke();
        }

        // Nose
        ctx.fillStyle = nose;
        ctx.fillRect(-1, -5, 2, 1);

        // Tail
        const tailWag = Math.sin(frame * 0.1) * 3;
        ctx.strokeStyle = coat;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(4, 8);
        ctx.quadraticCurveTo(10 + tailWag, 6, 12, 1);
        ctx.stroke();
      } else {
        // Running animation
        const legPhase = step % 2 === 0 ? 1 : -1;
        ctx.fillStyle = coat;

        // Torso
        ctx.beginPath();
        ctx.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.beginPath();
        ctx.arc(8, -4, 6, 0, Math.PI * 2);
        ctx.fill();

        // Ears
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(5, -9);
        ctx.lineTo(8, -13);
        ctx.lineTo(10, -8);
        ctx.fill();

        // Eye
        ctx.fillStyle = eyes;
        ctx.fillRect(8, -5, 2, 2);

        // Running Legs
        ctx.strokeStyle = dark;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";

        // Front legs
        ctx.beginPath();
        ctx.moveTo(6, 4);
        ctx.lineTo(6 + legPhase * 4, 10);
        ctx.stroke();

        // Back legs
        ctx.beginPath();
        ctx.moveTo(-6, 4);
        ctx.lineTo(-6 - legPhase * 4, 10);
        ctx.stroke();

        // Tail
        ctx.strokeStyle = coat;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-10, -1);
        ctx.quadraticCurveTo(-14, -6, -12, -10);
        ctx.stroke();
      }

      ctx.restore();
    };

    const update = () => {
      frame++;
      idleCounter++;

      const dx = targetX - posX;
      const dy = targetY - posY;
      const dist = Math.hypot(dx, dy);

      let state: "run" | "sit" | "sleep" = "run";
      let dirX = 1;

      if (dist > 18) {
        // Running towards cursor
        const speed = Math.min(dist * 0.12, 9);
        posX += (dx / dist) * speed;
        posY += (dy / dist) * speed;
        dirX = dx >= 0 ? 1 : -1;
        state = "run";
      } else {
        // Cat arrived
        dirX = 1;
        if (idleCounter > 180) {
          state = "sleep";
        } else {
          state = "sit";
        }
      }

      drawCat(posX, posY, state, dirX, Math.floor(frame / 6));

      animId = requestAnimationFrame(update);
    };

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    animId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", handleResize);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[99999] select-none"
      style={{ width: "100vw", height: "100vh" }}
      aria-hidden="true"
    />
  );
}
