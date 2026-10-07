export {};

import type { Playlist, Track } from "../datasource/types";
import {
  generatePlaylistShareLink,
  parsePlaylistShareLink,
  registerSharedPlaylist,
  getSharedPlaylist,
} from "./playlistShare";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

// 1. YouTube playlist link generation & parsing
const ytPlaylist: Playlist = {
  id: "VLPL1234567890",
  title: "Vibes Mix",
  owner: "Creator",
};

const ytShareLink = generatePlaylistShareLink(ytPlaylist);
check(ytShareLink.startsWith("opentune://playlist?yt=PL1234567890"), "yt playlist generates clean link");

const parsedYt = parsePlaylistShareLink(ytShareLink);
check(parsedYt !== null && parsedYt.type === "youtube", "parsed yt type is correct");
if (parsedYt?.type === "youtube") {
  equal(parsedYt.playlistId, "PL1234567890", "parsed playlistId is correct");
  equal(parsedYt.name, "Vibes Mix", "parsed title is preserved");
}

// 2. Direct YouTube URL parsing
const directYt = parsePlaylistShareLink("https://music.youtube.com/playlist?list=RDCLAK5uy_kmPRj");
check(directYt !== null && directYt.type === "youtube", "direct yt url parsed");
if (directYt?.type === "youtube") {
  equal(directYt.playlistId, "RDCLAK5uy_kmPRj", "direct yt list id matches");
}

// 3. Custom / Local playlist link generation & payload round trip
const customPlaylist: Playlist = {
  id: "local-playlist-test-1",
  title: "Unreleased Heat",
  owner: "Me",
  description: "Late night studio recordings",
  artworkUrl: "https://example.com/cover.jpg",
};

const customTracks: Track[] = [
  {
    id: "track-1",
    title: "Track One",
    artist: "Artist A",
    album: "Album X",
    durationSec: 180,
    source: "local",
    localPath: "C:\\Music\\track1.mp3",
    streamUrl: "https://files.catbox.moe/test1234.mp3",
  },
  {
    id: "yt_video_999",
    title: "Track Two",
    artist: "Artist B",
    source: "youtube",
  },
];

const customShareLink = generatePlaylistShareLink(customPlaylist, customTracks);
check(customShareLink.startsWith("opentune://playlist?data="), "custom playlist generates data link");

const parsedCustom = parsePlaylistShareLink(customShareLink);
check(parsedCustom !== null && parsedCustom.type === "data", "custom data payload parsed");
if (parsedCustom?.type === "data") {
  equal(parsedCustom.data.name, "Unreleased Heat", "title survives roundtrip");
  equal(parsedCustom.data.tracks.length, 2, "track count matches");
  equal(parsedCustom.data.tracks[0].title, "Track One", "first track title matches");
  equal(parsedCustom.data.tracks[0].isLocal, true, "isLocal preserved");
  equal(parsedCustom.data.tracks[0].streamUrl, "https://files.catbox.moe/test1234.mp3", "streamUrl preserved");
  equal(parsedCustom.data.tracks[1].title, "Track Two", "second track title matches");
}

// 4. In-memory registration
if (parsedCustom?.type === "data") {
  const registered = registerSharedPlaylist(parsedCustom.data);
  check(registered.id.startsWith("shared-playlist:"), "shared playlist id generated");
  equal(registered.title, "Unreleased Heat", "registered playlist title matches");

  const fromRegistry = getSharedPlaylist(registered.id);
  check(fromRegistry !== null, "registry finds playlist");
  equal(fromRegistry?.tracks.length, 2, "registry tracks retrieved");
  equal(fromRegistry?.tracks[0].title, "Track One", "registry track title matches");
  equal(fromRegistry?.tracks[0].streamUrl, "https://files.catbox.moe/test1234.mp3", "registry streamUrl matches");
}
