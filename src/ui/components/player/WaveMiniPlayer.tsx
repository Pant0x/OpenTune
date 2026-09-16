import { useState, useEffect, useRef } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import {
  CloseIcon,
  PauseActiveIcon,
  PlayActiveIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  VolumeLoudIcon,
  VolumeMutedIcon,
  VolumeSmallIcon,
  ShuffleIcon,
  ShuffleActiveIcon,
  RepeatIcon,
  RepeatOneIcon,
} from "@/ui/icons";
import { playerController, shallowEqual, usePlayerSelector } from "../../../player/playerStore";
import { TrackArtwork } from "../TrackArtwork";
import { WaveformCanvas } from "./WaveformCanvas";
import { findActiveLineIndex, isSyncedLyrics } from "../../pages/lyricsTiming";
import type { LyricLine, Lyrics } from "../../../datasource/types";

export type WavePlayerMode = "compact" | "expanded" | "lyrics";

interface WaveMiniPlayerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WaveMiniPlayer({ isOpen, onClose }: WaveMiniPlayerProps) {
  const [mode, setMode] = useState<WavePlayerMode>("expanded");
  const playerState = usePlayerSelector(
    (player) => ({
      currentTrack: player.currentTrack,
      status: player.status,
      volume: player.volume,
      muted: player.muted,
      playbackOrderMode: player.playbackOrderMode,
      shuffleEnabled: player.shuffleEnabled,
    }),
    shallowEqual,
  );

  const track = playerState.currentTrack;
  const isPlaying = playerState.status === "playing";
  const duration = track?.durationSec || 0;
  const isShuffle = playerState.shuffleEnabled;
  const isRepeatOne = playerState.playbackOrderMode === "repeat-one";
  const isRepeatAll = playerState.playbackOrderMode === "repeat-all";

  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const updateTime = () => setCurrentTime(playerController.getCurrentTime());
    updateTime();
    const interval = window.setInterval(updateTime, 250);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  // Dragging position state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Synced lyrics for lyrics mode
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  useEffect(() => {
    if (!isOpen || !track) {
      setLyrics(null);
      return;
    }
    let active = true;
    void playerController.getLyrics(track).then((res: Lyrics | null) => {
      if (active) setLyrics(res);
    });
    return () => {
      active = false;
    };
  }, [isOpen, track?.id]);

  const synced = isSyncedLyrics(lyrics);
  const activeLineIndex = synced && lyrics?.lines ? findActiveLineIndex(lyrics.lines, currentTime) : -1;
  const lyricsScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll lyrics in lyrics mode
  useEffect(() => {
    if (mode !== "lyrics" || activeLineIndex < 0 || !lyricsScrollRef.current) return;
    const activeEl = lyricsScrollRef.current.querySelector(`[data-line-index="${activeLineIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLineIndex, mode]);

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, [role='slider'], .no-drag")) {
      return;
    }
    const currentPos = position || {
      x: window.innerWidth - 420,
      y: window.innerHeight - (mode === "compact" ? 120 : mode === "expanded" ? 580 : 680),
    };
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: currentPos.x,
      posY: currentPos.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newX = Math.max(10, Math.min(window.innerWidth - 300, dragRef.current.posX + dx));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, dragRef.current.posY + dy));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  if (!isOpen || !track) return null;

  const defaultPos = position || {
    x: Math.max(20, window.innerWidth - 420),
    y: Math.max(20, window.innerHeight - (mode === "compact" ? 110 : mode === "expanded" ? 570 : 670)),
  };

  const volumePercent = Math.round((playerState.muted ? 0 : playerState.volume) * 100);
  const VolumeGlyph = playerState.muted || volumePercent === 0
    ? VolumeMutedIcon
    : volumePercent < 50
      ? VolumeSmallIcon
      : VolumeLoudIcon;

  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  return (
    <div
      ref={containerRef}
      style={{ left: `${defaultPos.x}px`, top: `${defaultPos.y}px` }}
      onMouseDown={handleMouseDown}
      className={cn(
        "fixed z-[85] select-none rounded-2xl shadow-2xl border border-white/10 bg-[#121216]/90 backdrop-blur-2xl text-foreground transition-[width,height] duration-300 flex flex-col overflow-hidden",
        mode === "compact" && "w-[440px] h-[82px] p-2.5",
        mode === "expanded" && "w-[380px] h-[540px] p-4",
        mode === "lyrics" && "w-[380px] h-[620px] p-4",
      )}
    >
      {/* Top Bar / Header */}
      <div className="flex items-center justify-between gap-2 shrink-0 pb-2 border-b border-white/5">
        <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg text-[10px] font-bold tracking-wider uppercase">
          <button
            type="button"
            onClick={() => setMode("compact")}
            className={cn(
              "px-2 py-1 rounded-md transition-colors cursor-pointer",
              mode === "compact" ? "bg-primary text-white shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Compact
          </button>
          <button
            type="button"
            onClick={() => setMode("expanded")}
            className={cn(
              "px-2 py-1 rounded-md transition-colors cursor-pointer",
              mode === "expanded" ? "bg-primary text-white shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Expanded
          </button>
          <button
            type="button"
            onClick={() => setMode("lyrics")}
            className={cn(
              "px-2 py-1 rounded-md transition-colors cursor-pointer",
              mode === "lyrics" ? "bg-primary text-white shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Lyrics
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="size-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
          title="Close Wave Player"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* ── MODE 1: COMPACT (460x80 style) ── */}
      {mode === "compact" && (
        <div className="flex items-center gap-3 flex-1 min-w-0 pt-1">
          <div className="size-12 rounded-lg overflow-hidden shrink-0 shadow-md">
            <TrackArtwork artworkUrl={track.artworkUrl} className="size-full object-cover" />
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-bold truncate">{track.title}</span>
            <span className="text-[11px] text-muted-foreground truncate">{track.artist}</span>
            <div
              className="w-full mt-1.5 h-2 cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                void playerController.seekTo(ratio * duration);
              }}
            >
              <WaveformCanvas
                progress={progress}
                isPlaying={isPlaying}
                className="w-full h-full"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void playerController.skipToPrevious()}
              className="size-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 cursor-pointer"
            >
              <SkipPreviousIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => void playerController.togglePlayPause()}
              className="size-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:scale-105 transition-transform cursor-pointer shadow-sm"
            >
              {isPlaying ? <PauseActiveIcon size={16} /> : <PlayActiveIcon size={16} />}
            </button>
            <button
              type="button"
              onClick={() => void playerController.skipToNext()}
              className="size-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 cursor-pointer"
            >
              <SkipNextIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── MODE 2: EXPANDED (390x546 style) ── */}
      {mode === "expanded" && (
        <div className="flex flex-col flex-1 min-w-0 pt-3 gap-3">
          {/* Large Artwork */}
          <div className="relative aspect-square w-full rounded-xl overflow-hidden shadow-xl bg-muted/20">
            <TrackArtwork artworkUrl={track.artworkUrl} className="size-full object-cover" />
          </div>

          {/* Track Details */}
          <div className="flex flex-col text-center px-2">
            <h3 className="font-extrabold text-base leading-tight truncate">{track.title}</h3>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{track.artist}</p>
          </div>

          {/* Smooth Waveform Seekbar */}
          <div className="flex flex-col gap-1 w-full px-1">
            <div
              className="h-6 w-full cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                void playerController.seekTo(ratio * duration);
              }}
            >
              <WaveformCanvas
                progress={progress}
                isPlaying={isPlaying}
                className="w-full h-full"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground font-semibold px-0.5">
              <span>{formatMinutesSeconds(currentTime)}</span>
              <span>{formatMinutesSeconds(duration)}</span>
            </div>
          </div>

          {/* Transport Controls */}
          <div className="flex items-center justify-center gap-4 py-1">
            <button
              type="button"
              onClick={() => playerController.toggleShuffle()}
              className={cn(
                "size-8 flex items-center justify-center rounded-full cursor-pointer transition-colors",
                isShuffle ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isShuffle ? <ShuffleActiveIcon size={18} /> : <ShuffleIcon size={18} />}
            </button>

            <button
              type="button"
              onClick={() => void playerController.skipToPrevious()}
              className="size-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 cursor-pointer transition-colors"
            >
              <SkipPreviousIcon size={20} />
            </button>

            <button
              type="button"
              onClick={() => void playerController.togglePlayPause()}
              className="size-12 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-transform cursor-pointer shadow-lg"
            >
              {isPlaying ? <PauseActiveIcon size={24} /> : <PlayActiveIcon size={24} />}
            </button>

            <button
              type="button"
              onClick={() => void playerController.skipToNext()}
              className="size-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10 cursor-pointer transition-colors"
            >
              <SkipNextIcon size={20} />
            </button>

            <button
              type="button"
              onClick={() => playerController.cyclePlaybackOrderMode()}
              className={cn(
                "size-8 flex items-center justify-center rounded-full cursor-pointer transition-colors",
                isRepeatOne || isRepeatAll ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isRepeatOne ? <RepeatOneIcon size={18} /> : <RepeatIcon size={18} />}
            </button>
          </div>

          {/* Volume slider */}
          <div className="flex items-center gap-2 px-2 pt-1">
            <button
              type="button"
              onClick={() => void playerController.toggleMute()}
              className="size-6 flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <VolumeGlyph size={16} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volumePercent}
              onChange={(e) => void playerController.setVolume(Number(e.target.value) / 100)}
              className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-primary"
            />
            <span className="text-[10px] tabular-nums font-bold text-muted-foreground w-6 text-right">
              {volumePercent}%
            </span>
          </div>
        </div>
      )}

      {/* ── MODE 3: LYRICS (390x640 style) ── */}
      {mode === "lyrics" && (
        <div className="flex flex-col flex-1 min-w-0 pt-2 gap-2 overflow-hidden">
          {/* Mini Track Header */}
          <div className="flex items-center gap-2.5 pb-2 border-b border-white/5 shrink-0">
            <div className="size-10 rounded-lg overflow-hidden shrink-0 shadow-md">
              <TrackArtwork artworkUrl={track.artworkUrl} className="size-full object-cover" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-bold truncate">{track.title}</span>
              <span className="text-[10px] text-muted-foreground truncate">{track.artist}</span>
            </div>
            <button
              type="button"
              onClick={() => void playerController.togglePlayPause()}
              className="size-8 flex items-center justify-center rounded-full bg-primary text-white shrink-0 hover:scale-105 transition-transform cursor-pointer"
            >
              {isPlaying ? <PauseActiveIcon size={16} /> : <PlayActiveIcon size={16} />}
            </button>
          </div>

          {/* Live Lyrics Scroller */}
          <div
            ref={lyricsScrollRef}
            className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 py-4 no-drag text-center"
          >
            {lyrics?.lines?.length ? (
              lyrics.lines.map((line: LyricLine, idx: number) => {
                const isActive = idx === activeLineIndex;
                return (
                  <p
                    key={`${line.startTimeSec || idx}-${idx}`}
                    data-line-index={idx}
                    onClick={() => {
                      if (typeof line.startTimeSec === "number") {
                        void playerController.seekTo(line.startTimeSec);
                      }
                    }}
                    className={cn(
                      "text-sm font-semibold transition-all duration-300 cursor-pointer py-1 px-2 rounded-lg",
                      isActive
                        ? "text-white scale-105 font-bold drop-shadow-[0_0_12px_rgba(255,255,255,0.7)]"
                        : "text-muted-foreground/45 hover:text-white/80",
                    )}
                  >
                    {line.text || "♪"}
                  </p>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground/60 my-auto">
                No synchronized lyrics available for this song.
              </p>
            )}
          </div>

          {/* Bottom Mini Scrubber */}
          <div
            className="shrink-0 pt-1 border-t border-white/5 h-4 cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              void playerController.seekTo(ratio * duration);
            }}
          >
            <WaveformCanvas
              progress={progress}
              isPlaying={isPlaying}
              className="w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
