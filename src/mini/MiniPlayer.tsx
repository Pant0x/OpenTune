/**
 * The mini player as its own OS window. Remote-driven: every pixel comes from snapshots pushed
 * by the main window, every button sends a command back. No engine, no stores, no datasource
 * imports here — pulling any of those in would boot a second player inside this window.
 */

import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/window";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import {
  CloseIcon,
  PauseActiveIcon,
  PlayActiveIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  VolumeLoudIcon,
  VolumeMutedIcon,
} from "@/ui/icons";
import { TrackArtwork } from "../ui/components/TrackArtwork";
import { WaveformCanvas } from "../ui/components/player/WaveformCanvas";
import { findActiveLineIndex, isAdlibLine } from "../ui/pages/lyricsTiming";
import { LyricLineView } from "../ui/components/lyrics/LyricLineView";
import type { LyricLine } from "../datasource/types";
import {
  sendMiniCommand,
  useMiniLyrics,
  useMiniPlayback,
  useMiniPosition,
} from "./playerBridge";
import { getAppSetting, setAppSetting } from "../internal/appSettings";

export type MiniMode = "compact" | "expanded" | "lyrics";

const MODE_STORAGE_KEY = "amber_mini_mode";
const MODE_SIZE: Record<MiniMode, { width: number; height: number }> = {
  compact: { width: 440, height: 82 },
  expanded: { width: 380, height: 540 },
  lyrics: { width: 380, height: 620 },
};

function readMode(): MiniMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === "compact" || stored === "expanded" || stored === "lyrics") return stored;
  } catch {}
  return "compact";
}

export function MiniPlayer() {
  const [mode, setMode] = useState<MiniMode>(readMode);
  const snapshot = useMiniPlayback();
  const lyricsSnapshot = useMiniLyrics();
  const position = useMiniPosition(snapshot);

  const track = snapshot?.track ?? null;
  const isPlaying = snapshot?.status === "playing";
  const duration = track?.durationSec ?? 0;
  const volumePercent = Math.round((snapshot?.muted ? 0 : (snapshot?.volume ?? 0)) * 100);
  const isShuffle = snapshot?.shuffleEnabled ?? false;
  const orderMode = snapshot?.playbackOrderMode ?? "in-order";
  const isRepeatOne = orderMode === "repeat-one";
  const isRepeatAll = orderMode === "repeat-all";
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  // Keep the OS window sized to the mode.
  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {}
    void setAppSetting(MODE_STORAGE_KEY, mode);
    const size = MODE_SIZE[mode];
    try {
      void getCurrentWebviewWindow().setSize(new LogicalSize(size.width, size.height));
    } catch {}
  }, [mode]);

  useEffect(() => {
    void getAppSetting<MiniMode>(MODE_STORAGE_KEY).then((stored) => {
      if (stored === "compact" || stored === "expanded" || stored === "lyrics") {
        setMode(stored);
      }
    });
  }, []);

  const closeWindow = () => {
    sendMiniCommand({ type: "close" });
    try {
      void getCurrentWebviewWindow().close();
    } catch {}
  };

  const seekByRatio = (ratio: number) => {
    if (duration <= 0) return;
    sendMiniCommand({
      type: "seek",
      positionSec: Math.max(0, Math.min(1, ratio)) * duration,
    });
  };

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121216]/95 text-foreground shadow-2xl select-none",
        mode === "compact" && "p-2.5",
        (mode === "expanded" || mode === "lyrics") && "p-4",
      )}
    >
      {/* Header: drag region, mode switch, close */}
      <div data-tauri-drag-region className="flex shrink-0 items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5 text-[10px] font-bold uppercase tracking-wider">
          {(["compact", "expanded", "lyrics"] as MiniMode[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setMode(candidate)}
              className={cn(
                "rounded-md px-2 py-1 capitalize transition-colors cursor-pointer",
                mode === candidate
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {candidate}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={closeWindow}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground cursor-pointer"
          title="Close mini player"
          aria-label="Close mini player"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {!track ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          Nothing playing
        </div>
      ) : mode === "compact" ? (
        <CompactBody
          track={track}
          isPlaying={isPlaying}
          progress={progress}
          onSeek={seekByRatio}
        />
      ) : mode === "expanded" ? (
        <ExpandedBody
          track={track}
          isPlaying={isPlaying}
          progress={progress}
          position={position}
          duration={duration}
          volumePercent={volumePercent}
          isShuffle={isShuffle}
          isRepeatOne={isRepeatOne}
          isRepeatAll={isRepeatAll}
          onSeek={seekByRatio}
        />
      ) : (
        <LyricsBody
          track={track}
          isPlaying={isPlaying}
          progress={progress}
          position={position}
          duration={duration}
          lyrics={lyricsSnapshot?.trackId === track.id ? (lyricsSnapshot.lines as LyricLine[]) : null}
          synced={lyricsSnapshot?.trackId === track.id ? (lyricsSnapshot.synced ?? false) : false}
        />
      )}
    </div>
  );
}

interface MiniTrackView {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string | null;
}

function TransportButton({
  onClick,
  label,
  children,
  className,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground cursor-pointer",
        className,
      )}
    >
      {children}
    </button>
  );
}

function CompactBody({
  track,
  isPlaying,
  progress,
  onSeek,
}: {
  track: MiniTrackView;
  isPlaying: boolean;
  progress: number;
  onSeek: (ratio: number) => void;
}) {
  return (
    <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3 pt-1">
      <div className="size-12 shrink-0 overflow-hidden rounded-lg shadow-md">
        <TrackArtwork artworkUrl={track.artworkUrl ?? undefined} className="size-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-bold">{track.title}</span>
        <span className="truncate text-[11px] text-muted-foreground">{track.artist}</span>
        <div
          className="mt-1.5 h-2 w-full cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek((e.clientX - rect.left) / rect.width);
          }}
        >
          <WaveformCanvas progress={progress} isPlaying={isPlaying} className="h-full w-full" />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TransportButton onClick={() => sendMiniCommand({ type: "prev" })} label="Previous" className="size-7">
          <SkipPreviousIcon size={16} />
        </TransportButton>
        <button
          type="button"
          onClick={() => sendMiniCommand({ type: "toggle" })}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105 cursor-pointer"
        >
          {isPlaying ? <PauseActiveIcon size={16} /> : <PlayActiveIcon size={16} />}
        </button>
        <TransportButton onClick={() => sendMiniCommand({ type: "next" })} label="Next" className="size-7">
          <SkipNextIcon size={16} />
        </TransportButton>
      </div>
    </div>
  );
}

function ExpandedBody({
  track,
  isPlaying,
  progress,
  position,
  duration,
  volumePercent,
  isShuffle,
  isRepeatOne,
  isRepeatAll,
  onSeek,
}: {
  track: MiniTrackView;
  isPlaying: boolean;
  progress: number;
  position: number;
  duration: number;
  volumePercent: number;
  isShuffle: boolean;
  isRepeatOne: boolean;
  isRepeatAll: boolean;
  onSeek: (ratio: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted/20 shadow-xl">
        <TrackArtwork artworkUrl={track.artworkUrl ?? undefined} className="size-full object-cover" />
      </div>
      <div className="flex flex-col px-2 text-center">
        <h3 className="truncate text-base font-extrabold leading-tight">{track.title}</h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{track.artist}</p>
      </div>
      <div className="flex w-full flex-col gap-1 px-1">
        <div
          className="h-6 w-full cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek((e.clientX - rect.left) / rect.width);
          }}
        >
          <WaveformCanvas progress={progress} isPlaying={isPlaying} className="h-full w-full" />
        </div>
        <div className="flex items-center justify-between px-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          <span>{formatMinutesSeconds(position)}</span>
          <span>{formatMinutesSeconds(duration)}</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-4 py-1">
        <button
          type="button"
          onClick={() => sendMiniCommand({ type: "shuffle" })}
          aria-label="Toggle shuffle"
          className={cn(
            "flex size-8 items-center justify-center rounded-full cursor-pointer transition-colors",
            isShuffle ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {isShuffle ? <ShuffleActiveIcon size={18} /> : <ShuffleIcon size={18} />}
        </button>
        <TransportButton onClick={() => sendMiniCommand({ type: "prev" })} label="Previous" className="size-9">
          <SkipPreviousIcon size={20} />
        </TransportButton>
        <button
          type="button"
          onClick={() => sendMiniCommand({ type: "toggle" })}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          {isPlaying ? <PauseActiveIcon size={24} /> : <PlayActiveIcon size={24} />}
        </button>
        <TransportButton onClick={() => sendMiniCommand({ type: "next" })} label="Next" className="size-9">
          <SkipNextIcon size={20} />
        </TransportButton>
        <button
          type="button"
          onClick={() => sendMiniCommand({ type: "repeat" })}
          aria-label="Cycle repeat mode"
          className={cn(
            "flex size-8 items-center justify-center rounded-full cursor-pointer transition-colors",
            isRepeatOne || isRepeatAll ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {isRepeatOne ? <RepeatOneIcon size={18} /> : <RepeatIcon size={18} />}
        </button>
      </div>
      <div className="flex items-center gap-2 px-2 pt-1">
        <button
          type="button"
          onClick={() => sendMiniCommand({ type: "mute" })}
          aria-label="Mute"
          className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {volumePercent === 0 ? <VolumeMutedIcon size={16} /> : <VolumeLoudIcon size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volumePercent}
          onChange={(e) => sendMiniCommand({ type: "volume", value: Number(e.target.value) / 100 })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-primary"
          aria-label="Volume"
        />
        <span className="w-6 text-right text-[10px] font-bold tabular-nums text-muted-foreground">
          {volumePercent}%
        </span>
      </div>
    </div>
  );
}

function LyricsBody({
  track,
  isPlaying,
  progress,
  position,
  duration,
  lyrics,
  synced,
}: {
  track: MiniTrackView;
  isPlaying: boolean;
  progress: number;
  position: number;
  duration: number;
  lyrics: LyricLine[] | null;
  synced: boolean;
}) {
  const activeLineIndex = synced && lyrics?.length
    ? findActiveLineIndex(lyrics, position)
    : -1;
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeLineIndex < 0 || !scrollerRef.current) return;
    const activeEl = scrollerRef.current.querySelector(`[data-line-index="${activeLineIndex}"]`);
    activeEl?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeLineIndex]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pt-2">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-white/5 pb-2">
        <div className="size-10 shrink-0 overflow-hidden rounded-lg shadow-md">
          <TrackArtwork artworkUrl={track.artworkUrl ?? undefined} className="size-full object-cover" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-bold">{track.title}</span>
          <span className="truncate text-[10px] text-muted-foreground">{track.artist}</span>
        </div>
        <button
          type="button"
          onClick={() => sendMiniCommand({ type: "toggle" })}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 cursor-pointer"
        >
          {isPlaying ? <PauseActiveIcon size={16} /> : <PlayActiveIcon size={16} />}
        </button>
      </div>

      <div ref={scrollerRef} className="flex flex-1 flex-col gap-3 overflow-y-auto py-4 pr-1 text-center">
        {lyrics?.length ? (
          lyrics.map((line, idx) => (
            <LyricLineView
              key={`${line.startTimeSec ?? idx}-${idx}`}
              index={idx}
              text={line.text}
              isActive={idx === activeLineIndex}
              size="mini"
              sweepEnabled={false}
              forceAdlibLine={isAdlibLine(line.text)}
              emptyStyle="note"
              onSeek={(i) => {
                const start = lyrics[i]?.startTimeSec;
                if (typeof start === "number") {
                  sendMiniCommand({ type: "seek", positionSec: start });
                }
              }}
            />
          ))
        ) : (
          <p className="my-auto text-xs text-muted-foreground/60">
            No synchronized lyrics available for this song.
          </p>
        )}
      </div>

      <div
        className="h-4 shrink-0 cursor-pointer border-t border-white/5 pt-1"
        onClick={(e) => {
          if (duration <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          sendMiniCommand({
            type: "seek",
            positionSec: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration,
          });
        }}
      >
        <WaveformCanvas progress={progress} isPlaying={isPlaying} className="h-full w-full" />
      </div>
    </div>
  );
}
