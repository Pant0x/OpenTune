import { dataSource } from "../../player/playerStore";
import type { Track } from "../types";

export interface VideoDetails {
  id: string;
  title: string;
  channelTitle: string;
  channelId?: string;
  channelAvatarUrl?: string;
  subscriberCount?: string;
  viewCount?: string;
  publishDate?: string;
  likeCount?: string;
  description?: string;
}

export interface VideoComment {
  id: string;
  authorName: string;
  authorAvatarUrl?: string;
  publishedTime?: string;
  text: string;
  likeCount?: string;
}

export interface VideoCommentsResult {
  totalComments?: string;
  comments: VideoComment[];
  continuationToken?: string;
}

const counterpartCache = new Map<string, Track>();

/**
 * Recursively searches an object for a string property matching a key name.
 */
function findValueByKey(obj: any, targetKey: string, maxDepth = 8): any {
  if (!obj || typeof obj !== "object" || maxDepth <= 0) return undefined;
  if (targetKey in obj) return obj[targetKey];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object") {
      const found = findValueByKey(val, targetKey, maxDepth - 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Fetches YouTube video details including title, channel, views, likes, and description.
 */
export async function getVideoDetails(videoId: string): Promise<VideoDetails | null> {
  if (!videoId) return null;
  try {
    const web = await dataSource.getWebClient();
    const response = await web.actions.execute("/next", { videoId });
    const contents = (response as any)?.data?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (!Array.isArray(contents)) return null;

    let title = "";
    let viewCount = "";
    let publishDate = "";
    let likeCount = "";
    let channelTitle = "";
    let channelId = "";
    let channelAvatarUrl = "";
    let subscriberCount = "";
    let description = "";

    for (const item of contents) {
      if (item.videoPrimaryInfoRenderer) {
        const p = item.videoPrimaryInfoRenderer;
        title = p.title?.runs?.map((r: any) => r.text).join("") || "";
        viewCount = p.viewCount?.videoViewCountRenderer?.viewCount?.simpleText || "";
        publishDate = p.dateText?.simpleText || "";

        // Extract like count from segmentedLikeDislikeButtonViewModel or likeButtonRenderer
        const topButtons = p.videoActions?.menuRenderer?.topLevelButtons;
        if (Array.isArray(topButtons)) {
          for (const btn of topButtons) {
            const btnVm = btn?.segmentedLikeDislikeButtonViewModel?.likeButtonViewModel?.likeButtonViewModel
              ?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
            if (btnVm?.title) {
              likeCount = btnVm.title;
              break;
            }
          }
        }
        if (!likeCount) {
          likeCount = findValueByKey(p.videoActions, "likeCountText")?.simpleText || "";
        }
      }

      if (item.videoSecondaryInfoRenderer) {
        const s = item.videoSecondaryInfoRenderer;
        const owner = s.owner?.videoOwnerRenderer;
        if (owner) {
          channelTitle = owner.title?.runs?.[0]?.text || "";
          channelId = owner.navigationEndpoint?.browseEndpoint?.browseId || "";
          subscriberCount = owner.subscriberCountText?.simpleText || "";
          const thumbs = owner.thumbnail?.thumbnails;
          if (Array.isArray(thumbs) && thumbs.length > 0) {
            channelAvatarUrl = thumbs[thumbs.length - 1].url;
          }
        }
        description = s.attributedDescription?.content || "";
        if (!description && (s as any).description?.runs) {
          description = (s as any).description.runs.map((r: any) => r.text).join("");
        }
      }
    }

    if (!description && Array.isArray((response as any)?.data?.engagementPanels)) {
      const panels = (response as any).data.engagementPanels;
      const descPanel = panels.find(
        (p: any) =>
          p.engagementPanelSectionListRenderer?.panelIdentifier ===
          "engagement-panel-structured-description",
      );
      const items =
        descPanel?.engagementPanelSectionListRenderer?.content
          ?.structuredDescriptionContentRenderer?.items;
      const body = items?.find((i: any) => i.expandableVideoDescriptionBodyRenderer);
      description =
        body?.expandableVideoDescriptionBodyRenderer?.attributedDescriptionBodyText?.content || "";
    }

    return {
      id: videoId,
      title,
      channelTitle,
      channelId,
      channelAvatarUrl,
      subscriberCount,
      viewCount,
      publishDate,
      likeCount,
      description,
    };
  } catch (error) {
    console.warn("getVideoDetails failed for", videoId, error);
    return null;
  }
}

/**
 * Fetches comments for a YouTube video.
 */
export async function getVideoComments(
  videoId: string,
  continuationToken?: string,
): Promise<VideoCommentsResult> {
  const result: VideoCommentsResult = {
    comments: [],
  };

  try {
    const web = await dataSource.getWebClient();
    let token = continuationToken;
    let nextData: any = null;

    if (!token) {
      const next = await web.actions.execute("/next", { videoId });
      const panels = (next as any)?.data?.engagementPanels;
      const commentsPanel = Array.isArray(panels)
        ? panels.find(
            (p: any) =>
              p.engagementPanelSectionListRenderer?.panelIdentifier ===
              "engagement-panel-comments-section",
          )
        : null;

      if (commentsPanel) {
        const header = commentsPanel.engagementPanelSectionListRenderer?.header;
        result.totalComments =
          header?.engagementPanelTitleHeaderRenderer?.contextualInfo?.runs?.[0]?.text ||
          header?.engagementPanelTitleHeaderRenderer?.title?.runs?.[0]?.text;

        const contents = commentsPanel.engagementPanelSectionListRenderer?.content?.sectionListRenderer?.contents;
        token =
          contents?.[0]?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint
            ?.continuationCommand?.token;
      }
    }

    if (token) {
      const commentsResponse = await web.actions.execute("/next", { continuation: token });
      nextData = (commentsResponse as any)?.data;
    }

    if (nextData) {
      // 1. Try modern YouTube commentEntityPayload from entityBatchUpdate mutations
      const mutations = nextData.frameworkUpdates?.entityBatchUpdate?.mutations;
      if (Array.isArray(mutations)) {
        for (const m of mutations) {
          const payload = m.payload?.commentEntityPayload;
          if (payload?.properties?.content?.content) {
            result.comments.push({
              id: payload.properties.commentId || payload.commentId || Math.random().toString(),
              authorName: payload.author?.displayName || "User",
              authorAvatarUrl: payload.author?.avatarThumbnailUrl,
              publishedTime: payload.properties.publishedTime,
              text: payload.properties.content.content,
              likeCount: payload.toolbar?.likeCountNotliked,
            });
          }
        }
      }

      // 2. Check next continuation token from onResponseReceivedEndpoints
      const endpoints = nextData.onResponseReceivedEndpoints;
      if (Array.isArray(endpoints)) {
        for (const ep of endpoints) {
          const items =
            ep.appendContinuationItemsAction?.continuationItems ||
            ep.reloadContinuationItemsCommand?.continuationItems;
          if (Array.isArray(items)) {
            // Check classic commentRenderer if mutations were empty
            if (result.comments.length === 0) {
              for (const it of items) {
                const c = it.commentThreadRenderer?.comment?.commentRenderer;
                if (c) {
                  result.comments.push({
                    id: c.commentId || Math.random().toString(),
                    authorName: c.authorText?.simpleText || "User",
                    authorAvatarUrl: c.authorThumbnail?.thumbnails?.[0]?.url,
                    publishedTime: c.publishedTimeText?.runs?.[0]?.text,
                    text: c.contentText?.runs?.map((r: any) => r.text).join("") || "",
                    likeCount: c.voteCount?.simpleText,
                  });
                }
              }
            }

            // Find next continuation token
            const lastItem = items[items.length - 1];
            const nextContToken =
              lastItem?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            if (nextContToken) {
              result.continuationToken = nextContToken;
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn("getVideoComments failed for", videoId, error);
  }

  return result;
}

/**
 * Resolves the media counterpart for a given Track.
 * - If targetType is "video": finds the official music video / video clip.
 * - If targetType is "song": finds the official album studio release (no SFX).
 */
export async function getMediaCounterpart(
  track: Track,
  targetType: "song" | "video",
): Promise<Track | null> {
  if (!track?.title) return null;
  const cacheKey = `${track.id}:${targetType}`;
  if (counterpartCache.has(cacheKey)) {
    return counterpartCache.get(cacheKey)!;
  }

  try {
    const query = `${track.artist || ""} ${track.title}`.trim();

    if (targetType === "video") {
      const web = await dataSource.getWebClient();
      const response: any = await web.search(`${query} official music video`, { type: "video" });
      const videos = response.videos || response.results || [];
      if (Array.isArray(videos) && videos.length > 0) {
        // Pick best matching video
        const first = videos[0] as any;
        const counterpart: Track = {
          id: first.id,
          title: typeof first.title === "string" ? first.title : first.title?.text || track.title,
          artist: first.author?.name || first.artists?.[0]?.name || track.artist,
          artists: track.artists,
          duration: first.duration?.text || track.duration,
          artworkUrl: first.thumbnails?.[0]?.url || track.artworkUrl,
          source: "youtube",
          isVideo: true,
        };
        counterpartCache.set(cacheKey, counterpart);
        return counterpart;
      }
    } else {
      const innertube = await dataSource.getMusicClient();
      const response: any = await innertube.music.search(query, { type: "song" });
      const songItems = response.songs?.contents || response.contents || [];
      if (Array.isArray(songItems) && songItems.length > 0) {
        // Pick best matching official release song
        const first = songItems[0] as any;
        const counterpart: Track = {
          id: first.id,
          title: typeof first.title === "string" ? first.title : first.title?.text || track.title,
          artist: first.artists?.[0]?.name || track.artist,
          artists: first.artists || track.artists,
          album: first.album?.name || track.album,
          duration: first.duration?.text || track.duration,
          artworkUrl: first.thumbnails?.[0]?.url || track.artworkUrl,
          source: "youtube",
          isVideo: false,
        };
        counterpartCache.set(cacheKey, counterpart);
        return counterpart;
      }
    }
  } catch (error) {
    console.warn("getMediaCounterpart failed", error);
  }

  return null;
}
