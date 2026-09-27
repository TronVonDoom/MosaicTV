-- Breaks inside programs, and break reels. Plain column adds (SQLite takes a
-- NOT NULL column with a default on a populated table) and one new table.

-- Where a program cut to commercial when it aired, and whether it's been looked for.
ALTER TABLE "MediaItem" ADD COLUMN "breaks" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "breaksSource" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "breaksCheckedAt" DATETIME;

-- Breaks inside programs: a channel's setting, and a block's own (null = the channel's).
ALTER TABLE "Channel" ADD COLUMN "actBreaks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TimeBlock" ADD COLUMN "actBreaks" BOOLEAN;

-- A program split at its act breaks: where in the file each later act starts.
ALTER TABLE "PlayoutItem" ADD COLUMN "inPoint" REAL;

-- Break reels: an ident that fills a break from a folder of clips.
ALTER TABLE "Filler" ADD COLUMN "reelFolder" TEXT;

CREATE TABLE "ReelClip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fillerId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "durationSec" REAL NOT NULL,
    "hasAudio" BOOLEAN NOT NULL DEFAULT true,
    "width" INTEGER,
    "height" INTEGER,
    CONSTRAINT "ReelClip_fillerId_fkey" FOREIGN KEY ("fillerId") REFERENCES "Filler" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReelClip_fillerId_idx" ON "ReelClip"("fillerId");
