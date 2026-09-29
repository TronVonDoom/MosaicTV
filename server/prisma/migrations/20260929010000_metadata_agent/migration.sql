-- A metadata agent like Plex's: each library reads its metadata from an
-- ordered list of sources (Library.metadataSources — .nfo files, the files'
-- own tags, TMDB), and titles gain what they say beyond a poster and a
-- summary: episodes' names, air dates and stills, content ratings, taglines,
-- studios and networks, directors, creators and cast. A show can follow one
-- of TMDB's other episode orders. Plain column adds (and the small Library
-- table redefined to add its column); every title is read afresh by the
-- next fetch (metaAt is null).

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "airDate" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "cast" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "contentRating" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "directors" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "embedded" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "metaAt" DATETIME;
ALTER TABLE "MediaItem" ADD COLUMN "metaSources" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "metaTitle" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "studio" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "tagline" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "tmdbStillPath" TEXT;

-- AlterTable
ALTER TABLE "Show" ADD COLUMN "airDate" TEXT;
ALTER TABLE "Show" ADD COLUMN "cast" TEXT;
ALTER TABLE "Show" ADD COLUMN "contentRating" TEXT;
ALTER TABLE "Show" ADD COLUMN "creators" TEXT;
ALTER TABLE "Show" ADD COLUMN "episodeOrder" TEXT;
ALTER TABLE "Show" ADD COLUMN "episodeOrderName" TEXT;
ALTER TABLE "Show" ADD COLUMN "metaAt" DATETIME;
ALTER TABLE "Show" ADD COLUMN "metaSources" TEXT;
ALTER TABLE "Show" ADD COLUMN "network" TEXT;
ALTER TABLE "Show" ADD COLUMN "tagline" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Library" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataSources" TEXT NOT NULL DEFAULT 'nfo,tmdb'
);
INSERT INTO "new_Library" ("createdAt", "id", "kind", "name") SELECT "createdAt", "id", "kind", "name" FROM "Library";
DROP TABLE "Library";
ALTER TABLE "new_Library" RENAME TO "Library";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

