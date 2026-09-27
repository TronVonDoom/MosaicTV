-- AlterTable
ALTER TABLE "PlayoutItem" ADD COLUMN "streamed" TEXT;

-- CreateTable
CREATE TABLE "Aired" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" INTEGER NOT NULL,
    "mediaItemId" INTEGER,
    "showId" INTEGER,
    "groupKey" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "startTime" DATETIME NOT NULL,
    "stopTime" DATETIME NOT NULL,
    "streamed" TEXT,
    CONSTRAINT "Aired_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Aired_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Aired_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Aired_channelId_startTime_idx" ON "Aired"("channelId", "startTime");

-- CreateIndex
CREATE INDEX "Aired_mediaItemId_idx" ON "Aired"("mediaItemId");

-- CreateIndex
CREATE INDEX "Aired_showId_startTime_idx" ON "Aired"("showId", "startTime");
