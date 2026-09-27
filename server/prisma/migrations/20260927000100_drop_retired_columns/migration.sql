-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Library" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Library" ("createdAt", "id", "kind", "name") SELECT "createdAt", "id", "kind", "name" FROM "Library";
DROP TABLE "Library";
ALTER TABLE "new_Library" RENAME TO "Library";
CREATE TABLE "new_Filler" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" INTEGER,
    "name" TEXT,
    "style" TEXT NOT NULL DEFAULT 'frosted',
    "assetId" INTEGER,
    "audioAssetId" INTEGER,
    "logoId" INTEGER,
    "logoScale" REAL NOT NULL DEFAULT 1,
    "divider" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Filler_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Filler_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Logo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Filler" ("assetId", "audioAssetId", "channelId", "createdAt", "divider", "id", "logoId", "logoScale", "name", "order", "style") SELECT "assetId", "audioAssetId", "channelId", "createdAt", "divider", "id", "logoId", "logoScale", "name", "order", "style" FROM "Filler";
DROP TABLE "Filler";
ALTER TABLE "new_Filler" RENAME TO "Filler";
CREATE INDEX "Filler_channelId_idx" ON "Filler"("channelId");
CREATE TABLE "new_FillerAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fillerId" INTEGER NOT NULL,
    "channelId" INTEGER,
    "timeBlockId" INTEGER,
    CONSTRAINT "FillerAssignment_fillerId_fkey" FOREIGN KEY ("fillerId") REFERENCES "Filler" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FillerAssignment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FillerAssignment_timeBlockId_fkey" FOREIGN KEY ("timeBlockId") REFERENCES "TimeBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FillerAssignment" ("channelId", "fillerId", "id", "timeBlockId") SELECT "channelId", "fillerId", "id", "timeBlockId" FROM "FillerAssignment";
DROP TABLE "FillerAssignment";
ALTER TABLE "new_FillerAssignment" RENAME TO "FillerAssignment";
CREATE INDEX "FillerAssignment_channelId_idx" ON "FillerAssignment"("channelId");
CREATE INDEX "FillerAssignment_timeBlockId_idx" ON "FillerAssignment"("timeBlockId");
CREATE UNIQUE INDEX "FillerAssignment_fillerId_channelId_key" ON "FillerAssignment"("fillerId", "channelId");
CREATE UNIQUE INDEX "FillerAssignment_fillerId_timeBlockId_key" ON "FillerAssignment"("fillerId", "timeBlockId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

