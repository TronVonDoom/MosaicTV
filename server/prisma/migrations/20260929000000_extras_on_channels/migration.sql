-- Specials and extras move from the library to the channel, as in Plex:
-- a library indexes everything it finds — season 0, and the featurettes,
-- trailers and deleted scenes filed with its movies and shows, which belong to
-- their movie (MediaItem.parentId) or show — and each channel says whether a
-- whole show, a movie or a smart filter brings them in. Every channel starts
-- with both left out, and a show's pick can say
-- otherwise (CollectionItem.specials / extras).

-- A library that left either out had them deleted; it's scanned once at the
-- next start to find them again (see rescanAfterUpgrade in index.ts).
INSERT INTO "Setting" ("key", "value")
SELECT 'rescanLibraries', "ids" FROM (
  SELECT group_concat("id") AS "ids" FROM "Library" WHERE "includeSpecials" = 0 OR "includeExtras" = 0
) WHERE "ids" IS NOT NULL;

-- AlterTable
ALTER TABLE "CollectionItem" ADD COLUMN "extras" BOOLEAN;
ALTER TABLE "CollectionItem" ADD COLUMN "specials" BOOLEAN;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Channel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "number" INTEGER,
    "name" TEXT NOT NULL,
    "group" TEXT,
    "logoUrl" TEXT,
    "logoId" INTEGER,
    "profileId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playoutAnchor" DATETIME,
    "playoutCursor" DATETIME,
    "playoutState" TEXT,
    "comingUp" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "audioLanguage" TEXT,
    "logoOnBreaks" BOOLEAN NOT NULL DEFAULT false,
    "grid" INTEGER NOT NULL DEFAULT 0,
    "actBreaks" BOOLEAN NOT NULL DEFAULT false,
    "includeSpecials" BOOLEAN NOT NULL DEFAULT false,
    "includeExtras" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Channel_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Logo" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Channel_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EncodingProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Channel" ("actBreaks", "audioLanguage", "comingUp", "createdAt", "grid", "group", "id", "isTest", "logoId", "logoOnBreaks", "logoUrl", "name", "number", "playoutAnchor", "playoutCursor", "playoutState", "profileId") SELECT "actBreaks", "audioLanguage", "comingUp", "createdAt", "grid", "group", "id", "isTest", "logoId", "logoOnBreaks", "logoUrl", "name", "number", "playoutAnchor", "playoutCursor", "playoutState", "profileId" FROM "Channel";
DROP TABLE "Channel";
ALTER TABLE "new_Channel" RENAME TO "Channel";
CREATE UNIQUE INDEX "Channel_number_key" ON "Channel"("number");
CREATE TABLE "new_Collection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "channelId" INTEGER,
    "logoId" INTEGER,
    "defaultOrder" TEXT NOT NULL DEFAULT 'chronological',
    "libraryId" INTEGER,
    "filterType" TEXT,
    "filterShow" TEXT,
    "filterSearch" TEXT,
    "filterGenre" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Collection_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Collection_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Logo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Collection" ("channelId", "createdAt", "defaultOrder", "filterGenre", "filterSearch", "filterShow", "filterType", "id", "libraryId", "logoId", "name") SELECT "channelId", "createdAt", "defaultOrder", "filterGenre", "filterSearch", "filterShow", "filterType", "id", "libraryId", "logoId", "name" FROM "Collection";
DROP TABLE "Collection";
ALTER TABLE "new_Collection" RENAME TO "Collection";
CREATE INDEX "Collection_channelId_idx" ON "Collection"("channelId");
CREATE TABLE "new_Library" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Library" ("createdAt", "id", "kind", "name") SELECT "createdAt", "id", "kind", "name" FROM "Library";
DROP TABLE "Library";
ALTER TABLE "new_Library" RENAME TO "Library";
CREATE TABLE "new_MediaItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "showId" INTEGER,
    "showTitle" TEXT,
    "season" INTEGER,
    "episode" INTEGER,
    "year" INTEGER,
    "artist" TEXT,
    "album" TEXT,
    "durationSec" REAL,
    "width" INTEGER,
    "height" INTEGER,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "container" TEXT,
    "sizeBytes" REAL,
    "mtimeMs" REAL,
    "posterPath" TEXT,
    "showPosterPath" TEXT,
    "seasonPosterPath" TEXT,
    "tmdbId" INTEGER,
    "overview" TEXT,
    "genres" TEXT,
    "rating" REAL,
    "tmdbPosterPath" TEXT,
    "tmdbBackdropPath" TEXT,
    "tmdbMatch" TEXT,
    "tmdbTitle" TEXT,
    "tmdbYear" INTEGER,
    "breaks" TEXT,
    "breaksSource" TEXT,
    "breaksCheckedAt" DATETIME,
    "extra" TEXT,
    "parentId" INTEGER,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaItem_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaItem_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MediaItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MediaItem" ("addedAt", "album", "artist", "audioCodec", "breaks", "breaksCheckedAt", "breaksSource", "container", "durationSec", "episode", "extra", "genres", "height", "id", "libraryId", "missing", "mtimeMs", "overview", "path", "posterPath", "rating", "season", "seasonPosterPath", "showId", "showPosterPath", "showTitle", "sizeBytes", "title", "tmdbBackdropPath", "tmdbId", "tmdbMatch", "tmdbPosterPath", "tmdbTitle", "tmdbYear", "type", "updatedAt", "videoCodec", "width", "year") SELECT "addedAt", "album", "artist", "audioCodec", "breaks", "breaksCheckedAt", "breaksSource", "container", "durationSec", "episode", "extra", "genres", "height", "id", "libraryId", "missing", "mtimeMs", "overview", "path", "posterPath", "rating", "season", "seasonPosterPath", "showId", "showPosterPath", "showTitle", "sizeBytes", "title", "tmdbBackdropPath", "tmdbId", "tmdbMatch", "tmdbPosterPath", "tmdbTitle", "tmdbYear", "type", "updatedAt", "videoCodec", "width", "year" FROM "MediaItem";
DROP TABLE "MediaItem";
ALTER TABLE "new_MediaItem" RENAME TO "MediaItem";
CREATE UNIQUE INDEX "MediaItem_path_key" ON "MediaItem"("path");
CREATE INDEX "MediaItem_libraryId_idx" ON "MediaItem"("libraryId");
CREATE INDEX "MediaItem_type_idx" ON "MediaItem"("type");
CREATE INDEX "MediaItem_showTitle_idx" ON "MediaItem"("showTitle");
CREATE INDEX "MediaItem_showId_idx" ON "MediaItem"("showId");
CREATE INDEX "MediaItem_parentId_idx" ON "MediaItem"("parentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

