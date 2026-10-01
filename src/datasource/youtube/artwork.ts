interface ArtworkCandidate {
  url?: string;
  width?: number;
  height?: number;
}

function normalizeArtworkUrl(url: string): string {
  const trimmedUrl = url.trim();
  return trimmedUrl.startsWith("//") ? `https:${trimmedUrl}` : trimmedUrl;
}

export function isVideoThumbnailUrl(url?: string): boolean {
  if (!url) return false;
  return /i\d?\.ytimg\.com\/vi(?:_webp)?\//i.test(url) || /img\.youtube\.com\/vi\//i.test(url);
}

function isArtworkCandidate(value: unknown): value is ArtworkCandidate {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as ArtworkCandidate).url === "string",
  );
}

export function collectArtworkCandidates(...sources: unknown[]): ArtworkCandidate[] {
  const candidates: ArtworkCandidate[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (isArtworkCandidate(value)) {
      candidates.push(value);
    }

    for (const child of Object.values(value)) {
      if (Array.isArray(child) || (child && typeof child === "object")) {
        visit(child);
      }
    }
  };

  for (const source of sources) {
    visit(source);
  }

  return candidates;
}

export function selectArtworkUrl(
  ...candidateGroups: Array<unknown>
): string | undefined {
  const candidates: ArtworkCandidate[] = [];
  for (const group of candidateGroups) {
    if (!group) continue;
    if (Array.isArray(group)) {
      for (const item of group) {
        if (isArtworkCandidate(item) && item.url?.trim()) {
          candidates.push(item);
        } else if (item && typeof item === "object") {
          candidates.push(...collectArtworkCandidates(item));
        }
      }
    } else if (isArtworkCandidate(group) && group.url?.trim()) {
      candidates.push(group);
    } else if (typeof group === "object") {
      candidates.push(...collectArtworkCandidates(group));
    }
  }

  const validCandidates = candidates.filter(
    (candidate): candidate is ArtworkCandidate & { url: string } => Boolean(candidate.url?.trim()),
  );

  const bestCandidate = validCandidates.reduce<(ArtworkCandidate & { url: string }) | undefined>(
    (best, candidate) => {
      if (!best) return candidate;

      const bestArea = (best.width ?? 0) * (best.height ?? 0);
      const candidateArea = (candidate.width ?? 0) * (candidate.height ?? 0);
      return candidateArea > bestArea ? candidate : best;
    },
    undefined,
  );

  return bestCandidate ? normalizeArtworkUrl(bestCandidate.url) : undefined;
}

function withYoutubeSize(url: string, size: number): string | null {
  if (!/googleusercontent\.com|ggpht\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com/.test(url)) return null;
  if (/[?&]/.test(url)) return null;
  if (/=s\d+/.test(url)) {
    return url.replace(/=s\d+.*$/, `=s${size}-c-l90-rj`);
  }
  if (/=/.test(url)) {
    return url.replace(/=[^=/]+$/, `=w${size}-h${size}-l90-rj`);
  }
  return `${url}=w${size}-h${size}-l90-rj`;
}

/**
 * Widths artwork is requested at.
 *
 * Buckets rather than exact sizes because the resolution cache is keyed by size: a distinct
 * width per component would mean a distinct cache entry, and a distinct download, for the same
 * cover shown in two places. A short ladder keeps that sharing while still keeping a 40px row
 * from decoding a 544px texture.
 *
 * 400 exists because of what a decoded bitmap costs. Cards render at 176–200 CSS px, and on the
 * 2× displays most people have that is a 352–400px requirement — which, on a ladder that jumped
 * straight from 240 to 544, rounded up to 544 every time. A decoded image is ~4 bytes per pixel
 * no matter how small the JPEG was, so those cards were each holding 1.18 MB where 0.64 MB
 * covers the slot exactly: a grid of fifty albums was ~59 MB of bitmap instead of ~32 MB.
 *
 * One extra bucket is the whole cost. It was chosen to catch both card widths at 2× rather than
 * splitting them across two new entries, which is what would actually fragment the cache.
 */
export function toHighResSpotifyUrl(url: string): string | null {
  if (!url.includes("i.scdn.co/image/")) return null;
  // ab67616d00004851 (64px) or ab67616d00001e02 (300px) -> ab67616d0000b273 (640px full res)
  if (url.includes("ab67616d00004851") || url.includes("ab67616d00001e02")) {
    return url.replace(/ab67616d0000(?:4851|1e02)/, "ab67616d0000b273");
  }
  // ab6761610000f178 (160px) or ab67616100005174 (320px) -> ab6761610000e5eb (640px full res artist avatar)
  if (url.includes("ab6761610000f178") || url.includes("ab67616100005174")) {
    return url.replace(/ab6761610000(?:f178|5174)/, "ab6761610000e5eb");
  }
  return null;
}

const ARTWORK_SIZE_BUCKETS = [120, 240, 400, 544, 800];

/**
 * The smallest bucket that still covers `cssPx` at this display's pixel density.
 *
 * Null means the slot is larger than any bucket — those keep the original, full-size URL,
 * since downscaling a hero image is the one place the extra bytes are visible.
 */
export function getArtworkSizeBucket(cssPx: number): number | null {
  const needed = cssPx * (globalThis.devicePixelRatio || 1);
  return ARTWORK_SIZE_BUCKETS.find((bucket) => bucket >= needed) ?? null;
}

/**
 * `size` is the requested width; omitting it keeps the original URL first, which is what
 * callers rendering at an unknown or full-bleed size want. Everything after the first entry is
 * a fallback for the first one 404ing, so the original stays in the ladder either way.
 */
export function getArtworkUrlCandidates(url?: string, size?: number | null): string[] {
  if (!url?.trim()) return [];

  const normalized = normalizeArtworkUrl(url);
  const candidates: Array<string | null> = [];

  // 1. For Spotify images: always try the 640px full-res version FIRST
  const spotifyHighRes = toHighResSpotifyUrl(normalized);
  if (spotifyHighRes) {
    candidates.push(spotifyHighRes);
  }

  // 2. If a specific size was requested for Google/YT user content, try that size first.
  // If no size was specified and the URL carries a tiny Google thumbnail (<500px),
  // prioritize high-res rewritten candidates (1200px / 800px) so hero, avatar, and lightbox
  // views are crystal-clear and never pixelated.
  const isGoogleCdn = /googleusercontent\.com|ggpht\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com/.test(normalized);
  const smallGoogleMatch = isGoogleCdn && normalized.match(/(?:=w(\d+)-h(\d+)|=s(\d+))/);
  const googleDimension = smallGoogleMatch
    ? Math.max(Number(smallGoogleMatch[1] || 0), Number(smallGoogleMatch[2] || 0), Number(smallGoogleMatch[3] || 0))
    : 0;

  if (size != null) {
    candidates.push(withYoutubeSize(normalized, size));
  } else if (isGoogleCdn && googleDimension > 0 && googleDimension < 500) {
    candidates.push(withYoutubeSize(normalized, 1200));
    candidates.push(withYoutubeSize(normalized, 800));
    candidates.push(normalized);
  } else {
    candidates.push(normalized);
  }

  // 3. If it's a YouTube video thumbnail, prioritize resolution ladder (maxres -> sd -> hq -> mq -> default)
  const ytVideoMatch = normalized.match(/(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})/i);
  if (ytVideoMatch?.[1]) {
    const videoId = ytVideoMatch[1];
    candidates.push(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
    candidates.push(`https://i.ytimg.com/vi/${videoId}/sddefault.jpg`);
    candidates.push(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    candidates.push(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
    candidates.push(`https://i.ytimg.com/vi/${videoId}/default.jpg`);
  }

  // Fallbacks: original and resolution ladders
  candidates.push(normalized);
  candidates.push(withYoutubeSize(normalized, 1600));
  candidates.push(withYoutubeSize(normalized, 1200));
  candidates.push(withYoutubeSize(normalized, 800));
  candidates.push(withYoutubeSize(normalized, 544));
  candidates.push(withYoutubeSize(normalized, 400));
  candidates.push(withYoutubeSize(normalized, 240));
  candidates.push(withYoutubeSize(normalized, 120));

  // Deduplicate while preserving order.
  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is string => {
    if (!candidate || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

export function getVideoArtworkFallback(videoId: string): string | undefined {
  const cleanId = (videoId || "").replace(/^(?:youtube:|spotify:track:|track_)/, "").trim();
  return /^[A-Za-z0-9_-]{11}$/.test(cleanId)
    ? `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`
    : undefined;
}

