export {};

import {
  normSimp,
  normTranslit,
  getArtworkKey,
  parseSubscriberCount,
  mergeArtists,
  deduplicateArtists,
} from "./searchNormalize";
import type { Artist } from "./types";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

// 1. Transliteration & Phonetic Normalization Checks
check(
  normSimp("Fairouz - Live") === "fairouzlive",
  "normSimp normalizes alphanumeric text",
);

check(
  normTranslit("sherein") === normTranslit("Sherine"),
  "sherein and Sherine must have identical translit key ('sirin')",
);

check(
  normTranslit("sherein") === normTranslit("شيرين"),
  "sherein and Arabic شيرين must have identical translit key",
);

check(
  normTranslit("fayrouz") === normTranslit("Fairouz"),
  "fayrouz and Fairouz must have identical translit key ('firus')",
);

check(
  normTranslit("fayrouz") === normTranslit("فيروز"),
  "fayrouz and Arabic فيروز must have identical translit key",
);

check(
  normTranslit("Amr Diab") === normTranslit("عمرو دياب"),
  "Amr Diab and عمرو دياب must have matching translit keys",
);

check(
  normTranslit("Drake") !== normTranslit("DRA"),
  "Drake and DRA must remain distinct translit keys",
);

check(
  normTranslit("Travis Scott").startsWith(normTranslit("trav")),
  "Travis Scott translit must start with 'trav'",
);

// 2. Subscriber Parsing Checks
check(
  parseSubscriberCount("6.46M subscribers") === 6_460_000,
  "parses 6.46M subscribers",
);
check(
  parseSubscriberCount("2.2M monthly listeners") === 2_200_000,
  "parses 2.2M monthly listeners",
);
check(
  parseSubscriberCount("850K subscribers") === 850_000,
  "parses 850K subscribers",
);
check(
  parseSubscriberCount("12 subscribers") === 12,
  "parses 12 subscribers",
);

// 3. Artwork Key Checks (stripping dynamic size params)
const url1 = "https://lh3.googleusercontent.com/a-/ALV-UjVxyz=w120-h120-l90-rj";
const url2 = "https://lh3.googleusercontent.com/a-/ALV-UjVxyz=s800-c-k-c0x00ffffff-no-rj";
check(
  getArtworkKey(url1) === getArtworkKey(url2),
  "different dimensions of the same Google CDN image must yield the same artwork key",
);

// 4. Artist Merging & Deduplication Checks
const creatorSherine: Artist = {
  id: "UC_sherein_creator",
  name: "Sherein",
  artworkUrl: "https://lh3.googleusercontent.com/creator=s120",
  subscriberCount: "12 subscribers",
  isCreator: true,
};

const officialSherine: Artist = {
  id: "UC_sherine_official",
  name: "Sherine",
  artworkUrl: "https://i.scdn.co/image/sherine_hires",
  subscriberCount: "6.46M subscribers",
  isCreator: false,
};

const mergedSherine = mergeArtists(creatorSherine, officialSherine);
check(
  mergedSherine.name === "Sherine",
  "merged artist should retain official artist name",
);
check(
  mergedSherine.isCreator === false,
  "merged artist should retain official music artist status",
);
check(
  mergedSherine.subscriberCount === "6.46M subscribers",
  "merged artist should retain highest subscriber count",
);

// Deduplicate 5 duplicate Fayrouz items with same artwork / transliteration
const duplicateFayrouzList: Artist[] = [
  {
    id: "UC_fayrouz_1",
    name: "Fayrouz",
    artworkUrl: "https://lh3.googleusercontent.com/fairouz_avatar=s120",
    subscriberCount: "11 subscribers",
    isCreator: true,
  },
  {
    id: "UC_fayrouz_2",
    name: "Fairouz",
    artworkUrl: "https://lh3.googleusercontent.com/fairouz_avatar=s800",
    subscriberCount: "1.5M subscribers",
    isCreator: false,
  },
  {
    id: "FEmusic_library_fairouz",
    name: "Fayrouz",
    artworkUrl: "https://lh3.googleusercontent.com/fairouz_avatar=w540",
    subscriberCount: "1.5M subscribers",
    isCreator: false,
  },
  {
    id: "UC_fayrouz_3",
    name: "Fairouz",
    artworkUrl: "https://lh3.googleusercontent.com/fairouz_avatar=s120",
    subscriberCount: "1.5M subscribers",
    isCreator: false,
  },
  {
    id: "UC_fayrouz_4",
    name: "Fayrouz",
    artworkUrl: "https://lh3.googleusercontent.com/fairouz_avatar=s120",
    isCreator: true,
  },
];

const deduplicated = deduplicateArtists(duplicateFayrouzList);
check(
  deduplicated.length === 1,
  `expected 1 deduplicated artist, got ${deduplicated.length}`,
);
check(
  deduplicated[0].subscriberCount === "1.5M subscribers",
  "deduplicated artist should have highest subscriber count",
);
check(
  deduplicated[0].isCreator === false,
  "deduplicated artist should be official artist",
);

console.log("searchNormalize: ok");
