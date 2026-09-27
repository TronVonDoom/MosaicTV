-- CreateTable
CREATE TABLE "Library" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "EncodingProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 1280,
    "height" INTEGER NOT NULL DEFAULT 720,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "quality" TEXT NOT NULL DEFAULT 'medium',
    "hwaccel" TEXT NOT NULL DEFAULT 'auto',
    "audioBitrate" INTEGER NOT NULL DEFAULT 192,
    "preset" TEXT NOT NULL DEFAULT 'auto',
    "videoBitrateK" INTEGER NOT NULL DEFAULT 0,
    "videoBufferK" INTEGER NOT NULL DEFAULT 0,
    "scalingMode" TEXT NOT NULL DEFAULT 'pad',
    "deinterlace" BOOLEAN NOT NULL DEFAULT true,
    "threads" INTEGER NOT NULL DEFAULT 0,
    "audioChannels" INTEGER NOT NULL DEFAULT 2,
    "normalizeLoudness" BOOLEAN NOT NULL DEFAULT false,
    "burnSubtitles" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Logo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "watermark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Show" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "tmdbId" INTEGER,
    "overview" TEXT,
    "genres" TEXT,
    "rating" REAL,
    "tmdbPosterPath" TEXT,
    "tmdbBackdropPath" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Show_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "showId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "tmdbPosterPath" TEXT,
    "overview" TEXT,
    CONSTRAINT "Season_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Airing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "showTitle" TEXT NOT NULL,
    "season" INTEGER,
    "number" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Airing_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiringSegment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "airingId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AiringSegment_airingId_fkey" FOREIGN KEY ("airingId") REFERENCES "Airing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiringSegment_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Collection" (
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

-- CreateTable
CREATE TABLE "Filler" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" INTEGER,
    "timeBlockId" INTEGER,
    "collectionId" INTEGER,
    "name" TEXT,
    "style" TEXT NOT NULL DEFAULT 'frosted',
    "assetId" INTEGER,
    "audioAssetId" INTEGER,
    "logoId" INTEGER,
    "generatedAssetId" INTEGER,
    "durationMode" TEXT NOT NULL DEFAULT 'fixed',
    "durationSec" INTEGER NOT NULL DEFAULT 30,
    "resolution" TEXT NOT NULL DEFAULT 'auto',
    "logoScale" REAL NOT NULL DEFAULT 1,
    "divider" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Filler_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Filler_timeBlockId_fkey" FOREIGN KEY ("timeBlockId") REFERENCES "TimeBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Filler_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Filler_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Logo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FillerAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fillerId" INTEGER NOT NULL,
    "channelId" INTEGER,
    "timeBlockId" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FillerAssignment_fillerId_fkey" FOREIGN KEY ("fillerId") REFERENCES "Filler" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FillerAssignment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FillerAssignment_timeBlockId_fkey" FOREIGN KEY ("timeBlockId") REFERENCES "TimeBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "collectionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "showTitle" TEXT,
    "libraryId" INTEGER,
    "season" INTEGER,
    "mediaItemId" INTEGER,
    "label" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Channel" (
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
    CONSTRAINT "Channel_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Logo" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Channel_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EncodingProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RotationItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "collectionId" INTEGER NOT NULL,
    "playbackOrder" TEXT NOT NULL DEFAULT 'chronological',
    "mode" TEXT NOT NULL DEFAULT 'one',
    "count" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "RotationItem_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RotationItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimeBlock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" INTEGER NOT NULL,
    "days" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "collectionId" INTEGER NOT NULL,
    "playbackOrder" TEXT NOT NULL DEFAULT 'chronological',
    "logoUrl" TEXT,
    "logoId" INTEGER,
    "fillerMode" TEXT NOT NULL DEFAULT 'none',
    "startMode" TEXT NOT NULL DEFAULT 'soft',
    "comingUp" TEXT,
    CONSTRAINT "TimeBlock_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimeBlock_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimeBlock_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Logo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayoutItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" INTEGER NOT NULL,
    "mediaItemId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'program',
    "title" TEXT,
    "startTime" DATETIME NOT NULL,
    "stopTime" DATETIME NOT NULL,
    "groupKey" TEXT,
    CONSTRAINT "PlayoutItem_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayoutItem_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LibraryFolder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryFolder_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
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
    CONSTRAINT "MediaItem_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Show_libraryId_title_key" ON "Show"("libraryId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "Season_showId_number_key" ON "Season"("showId", "number");

-- CreateIndex
CREATE INDEX "Airing_libraryId_showTitle_idx" ON "Airing"("libraryId", "showTitle");

-- CreateIndex
CREATE INDEX "AiringSegment_airingId_idx" ON "AiringSegment"("airingId");

-- CreateIndex
CREATE INDEX "AiringSegment_mediaItemId_idx" ON "AiringSegment"("mediaItemId");

-- CreateIndex
CREATE INDEX "Collection_channelId_idx" ON "Collection"("channelId");

-- CreateIndex
CREATE INDEX "Filler_channelId_idx" ON "Filler"("channelId");

-- CreateIndex
CREATE INDEX "Filler_timeBlockId_idx" ON "Filler"("timeBlockId");

-- CreateIndex
CREATE INDEX "Filler_collectionId_idx" ON "Filler"("collectionId");

-- CreateIndex
CREATE INDEX "FillerAssignment_channelId_idx" ON "FillerAssignment"("channelId");

-- CreateIndex
CREATE INDEX "FillerAssignment_timeBlockId_idx" ON "FillerAssignment"("timeBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "FillerAssignment_fillerId_channelId_key" ON "FillerAssignment"("fillerId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "FillerAssignment_fillerId_timeBlockId_key" ON "FillerAssignment"("fillerId", "timeBlockId");

-- CreateIndex
CREATE INDEX "CollectionItem_collectionId_idx" ON "CollectionItem"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_number_key" ON "Channel"("number");

-- CreateIndex
CREATE INDEX "RotationItem_channelId_idx" ON "RotationItem"("channelId");

-- CreateIndex
CREATE INDEX "TimeBlock_channelId_idx" ON "TimeBlock"("channelId");

-- CreateIndex
CREATE INDEX "PlayoutItem_channelId_startTime_idx" ON "PlayoutItem"("channelId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryFolder_path_key" ON "LibraryFolder"("path");

-- CreateIndex
CREATE INDEX "LibraryFolder_libraryId_idx" ON "LibraryFolder"("libraryId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_path_key" ON "MediaItem"("path");

-- CreateIndex
CREATE INDEX "MediaItem_libraryId_idx" ON "MediaItem"("libraryId");

-- CreateIndex
CREATE INDEX "MediaItem_type_idx" ON "MediaItem"("type");

-- CreateIndex
CREATE INDEX "MediaItem_showTitle_idx" ON "MediaItem"("showTitle");

