-- TheTVDB as a metadata source beside TMDB. A movie or show keeps its match
-- on TheTVDB the same way it keeps TMDB's (id, how it came by it, what the
-- source calls it). Plain column adds, and the small Library table redefined
-- for its new default: new libraries read TheTVDB after TMDB, and so does
-- every library that reads TMDB already — a fallback that fills in what TMDB
-- doesn't have, once a TheTVDB key is saved. Nothing is read again until then.

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "tvdbId" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "tvdbMatch" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "tvdbTitle" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "tvdbYear" INTEGER;

-- AlterTable
ALTER TABLE "Show" ADD COLUMN "tvdbId" INTEGER;
ALTER TABLE "Show" ADD COLUMN "tvdbMatch" TEXT;
ALTER TABLE "Show" ADD COLUMN "tvdbTitle" TEXT;
ALTER TABLE "Show" ADD COLUMN "tvdbYear" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Library" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataSources" TEXT NOT NULL DEFAULT 'nfo,tmdb,tvdb'
);
INSERT INTO "new_Library" ("createdAt", "id", "kind", "metadataSources", "name") SELECT "createdAt", "id", "kind", "metadataSources", "name" FROM "Library";
DROP TABLE "Library";
ALTER TABLE "new_Library" RENAME TO "Library";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- TheTVDB after TMDB wherever TMDB is read.
UPDATE "Library" SET "metadataSources" = "metadataSources" || ',tvdb'
WHERE (',' || "metadataSources" || ',') LIKE '%,tmdb,%' AND (',' || "metadataSources" || ',') NOT LIKE '%,tvdb,%';
