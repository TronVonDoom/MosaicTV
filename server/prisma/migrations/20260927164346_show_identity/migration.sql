-- Shows become rows everything points at, instead of titles matched as text.
-- Airing and CollectionItem trade their showTitle for a showId; MediaItem gains
-- a showId beside its showTitle (kept as the show's display title). Until now
-- only shows with fetched metadata had a Show row, so every show the library
-- knows by title gets one here, with its own title as its first ShowName.
-- CreateTable
CREATE TABLE "ShowName" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "showId" INTEGER NOT NULL,
    CONSTRAINT "ShowName_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShowName_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Every show known by title: from its files, its broadcast episodes, and the
-- collection picks that name a library that still exists.
INSERT INTO "Show" ("libraryId", "title", "updatedAt")
SELECT DISTINCT t."libraryId", t."title", CURRENT_TIMESTAMP FROM (
    SELECT "libraryId", "showTitle" AS "title" FROM "MediaItem" WHERE "showTitle" IS NOT NULL
    UNION SELECT "libraryId", "showTitle" FROM "Airing"
    UNION SELECT "libraryId", "showTitle" FROM "CollectionItem"
        WHERE "kind" IN ('show', 'season') AND "showTitle" IS NOT NULL
        AND "libraryId" IN (SELECT "id" FROM "Library")
) t
WHERE NOT EXISTS (SELECT 1 FROM "Show" s WHERE s."libraryId" = t."libraryId" AND s."title" = t."title");

INSERT INTO "ShowName" ("libraryId", "name", "showId") SELECT "libraryId", "title", "id" FROM "Show";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Airing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "showId" INTEGER NOT NULL,
    "season" INTEGER,
    "number" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Airing_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Airing_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Airing" ("createdAt", "id", "libraryId", "number", "season", "title", "showId")
SELECT a."createdAt", a."id", a."libraryId", a."number", a."season", a."title",
    (SELECT s."id" FROM "Show" s WHERE s."libraryId" = a."libraryId" AND s."title" = a."showTitle")
FROM "Airing" a;
DROP TABLE "Airing";
ALTER TABLE "new_Airing" RENAME TO "Airing";
CREATE INDEX "Airing_showId_idx" ON "Airing"("showId");
CREATE TABLE "new_CollectionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "collectionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "showId" INTEGER,
    "libraryId" INTEGER,
    "season" INTEGER,
    "mediaItemId" INTEGER,
    "label" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionItem_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- A pick with no library matched the title in any library; it takes the first
-- show of that name (and that show's library).
INSERT INTO "new_CollectionItem" ("collectionId", "id", "kind", "label", "libraryId", "mediaItemId", "order", "season", "showId")
SELECT c."collectionId", c."id", c."kind", c."label",
    CASE WHEN c."kind" IN ('show', 'season') AND c."libraryId" IS NULL
        THEN (SELECT s."libraryId" FROM "Show" s WHERE s."title" = c."showTitle" ORDER BY s."id" LIMIT 1)
        ELSE c."libraryId" END,
    c."mediaItemId", c."order", c."season",
    CASE WHEN c."kind" IN ('show', 'season')
        THEN (SELECT s."id" FROM "Show" s WHERE s."title" = c."showTitle"
              AND (c."libraryId" IS NULL OR s."libraryId" = c."libraryId") ORDER BY s."id" LIMIT 1)
        END
FROM "CollectionItem" c;
DROP TABLE "CollectionItem";
ALTER TABLE "new_CollectionItem" RENAME TO "CollectionItem";
CREATE INDEX "CollectionItem_collectionId_idx" ON "CollectionItem"("collectionId");
CREATE INDEX "CollectionItem_showId_idx" ON "CollectionItem"("showId");
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
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaItem_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaItem_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MediaItem" ("addedAt", "album", "artist", "audioCodec", "container", "durationSec", "episode", "genres", "height", "id", "libraryId", "missing", "mtimeMs", "overview", "path", "posterPath", "rating", "season", "seasonPosterPath", "showPosterPath", "showTitle", "sizeBytes", "title", "tmdbBackdropPath", "tmdbId", "tmdbPosterPath", "type", "updatedAt", "videoCodec", "width", "year", "showId")
SELECT m."addedAt", m."album", m."artist", m."audioCodec", m."container", m."durationSec", m."episode", m."genres", m."height", m."id", m."libraryId", m."missing", m."mtimeMs", m."overview", m."path", m."posterPath", m."rating", m."season", m."seasonPosterPath", m."showPosterPath", m."showTitle", m."sizeBytes", m."title", m."tmdbBackdropPath", m."tmdbId", m."tmdbPosterPath", m."type", m."updatedAt", m."videoCodec", m."width", m."year",
    (SELECT s."id" FROM "Show" s WHERE s."libraryId" = m."libraryId" AND s."title" = m."showTitle")
FROM "MediaItem" m;
DROP TABLE "MediaItem";
ALTER TABLE "new_MediaItem" RENAME TO "MediaItem";
CREATE UNIQUE INDEX "MediaItem_path_key" ON "MediaItem"("path");
CREATE INDEX "MediaItem_libraryId_idx" ON "MediaItem"("libraryId");
CREATE INDEX "MediaItem_type_idx" ON "MediaItem"("type");
CREATE INDEX "MediaItem_showTitle_idx" ON "MediaItem"("showTitle");
CREATE INDEX "MediaItem_showId_idx" ON "MediaItem"("showId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ShowName_showId_idx" ON "ShowName"("showId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowName_libraryId_name_key" ON "ShowName"("libraryId", "name");
