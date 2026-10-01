import { useState, useEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderIcon,
  FolderOpenIcon,
  FolderAddIcon,
  PlayActiveIcon,
  ShuffleIcon,
  SearchIcon,
  CloseIcon,
} from "@/ui/icons";
import type { Playlist, Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import { TrackRow } from "../components/TrackRow";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { useNowPlaying } from "../hooks/useNowPlaying";
import {
  useLocalMusicFolder,
  setLocalMusicFolder,
  scanLocalMusicFolder,
} from "../../player/localFilesManager";
import {
  createLocalPlaylist,
  writeLocalPlaylistTracks,
  readLocalPlaylistTracks,
  localPlaylistToPlaylist,
} from "../../player/localPlaylists";

export function LocalFilesPage({
  playerController,
  onNavigatePlaylist,
}: {
  playerController: PlayerControllerActions;
  onNavigatePlaylist?: (playlist: Playlist) => void;
}) {
  const currentFolder = useLocalMusicFolder();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();

  useEffect(() => {
    let active = true;
    if (!currentFolder) {
      setTracks([]);
      return;
    }

    setLoading(true);
    scanLocalMusicFolder(currentFolder)
      .then((scanned) => {
        if (active) setTracks(scanned);
      })
      .catch((err) => {
        console.error("Error scanning local folder:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentFolder]);

  const handleChooseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Local Music Folder",
      });
      if (selected && typeof selected === "string") {
        setLocalMusicFolder(selected);
      }
    } catch (err) {
      console.error("Failed to pick folder:", err);
    }
  };

  const filteredTracks = useMemo(() => {
    if (!filterText.trim()) return tracks;
    const query = filterText.toLowerCase();
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(query) ||
        t.artist.toLowerCase().includes(query) ||
        (t.album && t.album.toLowerCase().includes(query))
    );
  }, [tracks, filterText]);

  const totalDurationSec = useMemo(() => {
    return filteredTracks.reduce((acc, t) => acc + (t.durationSec || 0), 0);
  }, [filteredTracks]);

  const formatDuration = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours > 0) return `${hours} hr ${remMins} min`;
    return `${mins} min`;
  };

  const handlePlayAll = (shuffle = false) => {
    if (!filteredTracks.length) return;
    const queue = [...filteredTracks];
    if (shuffle) {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    void playerController.playTrackById(queue[0].id, queue);
  };

  const handleCreatePlaylist = () => {
    if (!filteredTracks.length) return;
    const folderName = currentFolder?.split(/[\\/]/).pop() || "Local";
    const playlist = createLocalPlaylist(`Local - ${folderName}`);
    const allTracks = readLocalPlaylistTracks();
    allTracks[playlist.id] = filteredTracks;
    writeLocalPlaylistTracks(allTracks);
    if (onNavigatePlaylist) {
      onNavigatePlaylist(localPlaylistToPlaylist(playlist));
    }
  };

  if (!currentFolder) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <span className="grid size-16 place-items-center rounded-2xl bg-card text-muted-foreground shadow-sm">
          <FolderIcon size={32} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1 max-w-sm">
          <h2 className="text-lg font-semibold text-foreground">No Local Folder Selected</h2>
          <p className="text-sm text-muted-foreground">
            Select a folder on your computer to scan and play your local audio files directly in OpenTune.
          </p>
        </div>
        <button
          type="button"
          onClick={handleChooseFolder}
          className="mt-2 flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderOpenIcon size={18} aria-hidden="true" />
          Choose Music Folder
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/40 pb-6">
        <div className="flex items-start gap-4">
          <div className="grid size-20 shrink-0 place-items-center rounded-2xl bg-card text-primary shadow-sm border border-border/50">
            <FolderIcon size={36} aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Local Collection</span>
            <h1 className="text-2xl font-bold text-foreground truncate">{currentFolder.split(/[\\/]/).pop() || "Local Files"}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate max-w-md" title={currentFolder}>{currentFolder}</span>
              <span>•</span>
              <span>{filteredTracks.length} {filteredTracks.length === 1 ? "track" : "tracks"}</span>
              {totalDurationSec > 0 && (
                <>
                  <span>•</span>
                  <span>{formatDuration(totalDurationSec)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => handlePlayAll(false)}
            disabled={!filteredTracks.length}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
          >
            <PlayActiveIcon size={16} aria-hidden="true" />
            Play All
          </button>
          <button
            type="button"
            onClick={() => handlePlayAll(true)}
            disabled={!filteredTracks.length}
            className="flex items-center gap-2 rounded-full bg-card border border-border/60 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card/80 disabled:opacity-50"
          >
            <ShuffleIcon size={16} aria-hidden="true" />
            Shuffle
          </button>
          <button
            type="button"
            onClick={handleCreatePlaylist}
            disabled={!filteredTracks.length}
            className="flex items-center gap-2 rounded-full bg-card border border-border/60 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card/80 disabled:opacity-50"
            title="Create a playlist containing these local files"
          >
            <FolderAddIcon size={16} aria-hidden="true" />
            Save as Playlist
          </button>
          <button
            type="button"
            onClick={handleChooseFolder}
            className="flex items-center gap-2 rounded-full bg-card border border-border/60 px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <FolderOpenIcon size={16} aria-hidden="true" />
            Change Folder
          </button>
        </div>
      </header>

      {/* Filter / Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter local files..."
            className="w-full rounded-full bg-card border border-border/60 pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <CloseIcon size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Scanning audio files in folder...
        </div>
      ) : filteredTracks.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm font-medium text-foreground">No audio files found</p>
          <p className="text-xs text-muted-foreground">
            Make sure the folder contains supported audio files (.mp3, .flac, .wav, .m4a, .ogg).
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {filteredTracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              isCurrent={currentTrackId === track.id}
              isPlaying={isPlaying && currentTrackId === track.id}
              showArtwork={true}
              showAlbum={true}
              showDownload={false}
              showRating={false}
              onSelect={() => void playerController.playTrackById(track.id, filteredTracks)}
              onContextMenu={(e) => openTrackMenu(e, track)}
              onQuickAddToQueue={() => playerController.addTracksToQueue([track])}
              onQuickAdd={() => openPlaylistPicker(track)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
