/**
 * Audio Streaming Hook & Tauri IPC Bridge.
 *
 * Provides instant Spotify-grade playback controls (<300ms start time),
 * background queue prefetching (N+1, N+2), 15s playback trigger,
 * optimistic UI state updates, and rapid skip cancellation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../datasource/types";
import {
  dataSource,
  playerController,
  usePlayerSelector,
  usePlayerSessionSelector,
} from "./playerStore";
import type { PlayerStatus } from "./PlayerController";
import {
  cacheStreamUrl,
  getPlaybackStatus,
  playTrack as nativePlayTrack,
  prefetchTracks as nativePrefetchTracks,
  type PlaybackStatus,
} from "./rustAudio";

export {
  cacheStreamUrl,
  getPlaybackStatus,
  nativePlayTrack as playTrack,
  nativePrefetchTracks as prefetchTracks,
  type PlaybackStatus,
};

export interface AudioPlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  queue: readonly Track[];
  currentIndex: number;
}

export interface AudioPlayerActions {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  skipNext: () => Promise<void>;
  skipPrevious: () => Promise<void>;
  playTrack: (track: Track, queue?: readonly Track[]) => Promise<boolean>;
  prefetchUpcoming: () => void;
}

/**
 * High-performance React hook for low-latency playback with optimistic state
 * and automatic upcoming track pre-warming.
 */
export function useAudioPlayer(): AudioPlayerState & AudioPlayerActions {
  const currentTrack = usePlayerSelector((s) => s.currentTrack);
  const status = usePlayerSelector((s) => s.status);
  const volume = usePlayerSelector((s) => s.volume);
  const muted = usePlayerSelector((s) => s.muted);

  const session = usePlayerSessionSelector((s) => s);
  const queue = session?.queue ?? [];
  const currentIndex = session?.queueIndex ?? 0;

  // Optimistic UI state to ensure instant feedback (<50ms) before network/hardware ACK
  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null);
  const [optimisticSeek, setOptimisticSeek] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  // Skip / play cancellation token to prevent stale track transitions on rapid clicks
  const playGenerationRef = useRef(0);
  const prefetchedTracksRef = useRef<Set<string>>(new Set());
  const triggered15sForTrackRef = useRef<string | null>(null);

  // Sync optimistic states back to null once store catches up
  useEffect(() => {
    if (optimisticPlaying !== null) {
      const isActualPlaying = status === "playing";
      if (isActualPlaying === optimisticPlaying) {
        setOptimisticPlaying(null);
      }
    }
  }, [status, optimisticPlaying]);

  const realPositionSec = playerController.getCurrentTime();
  useEffect(() => {
    if (optimisticSeek !== null) {
      if (Math.abs(realPositionSec - optimisticSeek) < 1.0) {
        setOptimisticSeek(null);
      }
    }
  }, [realPositionSec, optimisticSeek]);

  // Periodic position tick while playing
  useEffect(() => {
    if (status !== "playing") return;
    const interval = setInterval(() => {
      setTick((t) => (t + 1) % 10000);
    }, 250);
    return () => clearInterval(interval);
  }, [status]);

  /**
   * Intelligently resolves and warms direct audio stream URLs in Rust core
   * for track N+1 and N+2 in the background.
   */
  const prefetchUpcoming = useCallback(() => {
    if (!queue || queue.length === 0) return;

    const upcoming: Track[] = [];
    if (currentIndex + 1 < queue.length) upcoming.push(queue[currentIndex + 1]);
    if (currentIndex + 2 < queue.length) upcoming.push(queue[currentIndex + 2]);

    const trackIdsToPrefetch: string[] = [];
    for (const track of upcoming) {
      if (track && track.id && !prefetchedTracksRef.current.has(track.id)) {
        trackIdsToPrefetch.push(track.id);
        prefetchedTracksRef.current.add(track.id);
      }
    }

    if (trackIdsToPrefetch.length > 0) {
      // 1. Tell Rust background engine to prefetch head chunks / verify disk cache
      void nativePrefetchTracks(trackIdsToPrefetch).catch(() => {});

      // 2. Resolve stream URLs via data source if needed and push to Rust LRU cache
      for (const track of upcoming) {
        if (track && track.source !== "local" && dataSource.getStreamData) {
          void dataSource
            .getStreamData(track)
            .then((data) => {
              if (data?.rustSource?.kind === "stream") {
                void cacheStreamUrl(
                  track.id,
                  data.rustSource.url,
                  data.rustSource.mimeType || "audio/webm",
                  data.rustSource.cookie,
                  6 * 3600,
                ).catch(() => {});
              } else if (data?.sourceUrl) {
                void cacheStreamUrl(
                  track.id,
                  data.sourceUrl,
                  data.mimeType || "audio/webm",
                  undefined,
                  6 * 3600,
                ).catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    }
  }, [queue, currentIndex]);

  // Queue Pre-fetching: Whenever queue or active index changes, warm N+1 and N+2
  useEffect(() => {
    prefetchUpcoming();
  }, [prefetchUpcoming]);

  // 15-second Playback Milestone: Trigger prefetch once track reaches 15s
  useEffect(() => {
    if (!currentTrack?.id) return;
    const pos = playerController.getCurrentTime();
    if (pos >= 15 && triggered15sForTrackRef.current !== currentTrack.id) {
      triggered15sForTrackRef.current = currentTrack.id;
      prefetchUpcoming();
    }
  }, [realPositionSec, tick, currentTrack?.id, prefetchUpcoming]);

  // Reset 15s trigger milestone on track change
  useEffect(() => {
    if (currentTrack?.id && triggered15sForTrackRef.current !== currentTrack.id) {
      triggered15sForTrackRef.current = null;
    }
  }, [currentTrack?.id]);

  // Optimistic Play action
  const play = useCallback(async () => {
    setOptimisticPlaying(true);
    try {
      await playerController.play();
    } catch {
      setOptimisticPlaying(false);
    }
  }, []);

  // Optimistic Pause action
  const pause = useCallback(async () => {
    setOptimisticPlaying(false);
    try {
      await playerController.pause();
    } catch {
      setOptimisticPlaying(true);
    }
  }, []);

  const togglePlay = useCallback(async () => {
    const isCurrentlyPlaying = optimisticPlaying !== null ? optimisticPlaying : status === "playing";
    if (isCurrentlyPlaying) {
      await pause();
    } else {
      await play();
    }
  }, [optimisticPlaying, status, pause, play]);

  // Optimistic Seek action
  const seek = useCallback(async (seconds: number) => {
    setOptimisticSeek(seconds);
    try {
      await playerController.seekTo(seconds);
    } catch {
      setOptimisticSeek(null);
    }
  }, []);

  // Instant Track Launch with skip cancellation
  const playTrack = useCallback(
    async (track: Track, newQueue?: readonly Track[]): Promise<boolean> => {
      const thisGeneration = ++playGenerationRef.current;
      setOptimisticPlaying(true);
      setOptimisticSeek(0);

      try {
        const success = await playerController.playTrackById(track.id, newQueue);
        if (thisGeneration !== playGenerationRef.current) {
          // A newer track click superseded this operation
          return false;
        }
        return success;
      } catch (err) {
        if (thisGeneration === playGenerationRef.current) {
          setOptimisticPlaying(false);
        }
        return false;
      }
    },
    [],
  );

  const skipNext = useCallback(async () => {
    const thisGeneration = ++playGenerationRef.current;
    setOptimisticPlaying(true);
    setOptimisticSeek(0);
    try {
      await playerController.skipToNext();
    } catch {
      if (thisGeneration === playGenerationRef.current) {
        setOptimisticPlaying(null);
      }
    }
  }, []);

  const skipPrevious = useCallback(async () => {
    const thisGeneration = ++playGenerationRef.current;
    setOptimisticPlaying(true);
    setOptimisticSeek(0);
    try {
      await playerController.skipToPrevious();
    } catch {
      if (thisGeneration === playGenerationRef.current) {
        setOptimisticPlaying(null);
      }
    }
  }, []);

  const isPlaying = optimisticPlaying !== null ? optimisticPlaying : status === "playing";
  const currentTime = optimisticSeek !== null ? optimisticSeek : playerController.getCurrentTime();
  const duration = currentTrack?.durationSec ?? 0;

  return {
    currentTrack,
    isPlaying,
    isLoading: status === "loading",
    status,
    currentTime,
    duration,
    volume,
    muted,
    queue,
    currentIndex,
    play,
    pause,
    togglePlay,
    seek,
    skipNext,
    skipPrevious,
    playTrack,
    prefetchUpcoming,
  };
}
