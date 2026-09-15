export {};

import { getVideoDetails, getVideoComments } from "./videoService";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

async function run(): Promise<void> {
  // 1. Check getVideoDetails export and function shape
  check(typeof getVideoDetails === "function", "getVideoDetails should be a function");
  check(typeof getVideoComments === "function", "getVideoComments should be a function");

  // Invalid videoId returns null
  const nullDetails = await getVideoDetails("");
  check(nullDetails === null, "Empty video ID should return null");

  const emptyComments = await getVideoComments("");
  check(Array.isArray(emptyComments.comments), "Empty video ID should return comments array");

  console.log("videoService: ok");
}

void run();
