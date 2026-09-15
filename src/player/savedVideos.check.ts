function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

import {
  getSavedVideos,
  isSavedVideo,
  removeSavedVideo,
  saveVideo,
  toggleSaveVideo,
} from "./savedVideos";

console.log("savedVideos.check: start");

// Test saving
const mockTrack = {
  id: "test_vid_123",
  title: "Test Video",
  artist: "Test Artist",
  source: "youtube" as const,
  duration: "3:45",
  artworkUrl: "https://example.com/art.jpg",
};

check(isSavedVideo("test_vid_123") === false, "initially not saved");

const saved = saveVideo(mockTrack);
check(saved === true, "first save returns true");
check(isSavedVideo("test_vid_123") === true, "isSavedVideo is true after save");

// Duplication guard
const savedAgain = saveVideo(mockTrack);
check(savedAgain === false, "duplicate save returns false");

const list = getSavedVideos();
check(list.some((v) => v.id === "test_vid_123") === true, "track is in saved list");

// Toggle
const toggledOff = toggleSaveVideo(mockTrack);
check(toggledOff === false, "toggleSaveVideo removes video");
check(isSavedVideo("test_vid_123") === false, "isSavedVideo is false after toggle off");

const toggledOn = toggleSaveVideo(mockTrack);
check(toggledOn === true, "toggleSaveVideo adds video back");
check(isSavedVideo("test_vid_123") === true, "isSavedVideo is true after toggle on");

// Remove
removeSavedVideo("test_vid_123");
check(isSavedVideo("test_vid_123") === false, "removeSavedVideo removes video");

console.log("savedVideos.check: passed");
