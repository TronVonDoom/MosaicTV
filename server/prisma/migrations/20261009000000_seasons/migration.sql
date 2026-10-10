-- A time block can air only between two dates: Oct 1 – Oct 31 every year, or
-- Dec 20 – Dec 26 2026 once. Null on both = all year, as every block was.
-- And a channel can hold its holiday episodes back to their season.

-- AlterTable
ALTER TABLE "TimeBlock" ADD COLUMN "seasonFrom" TEXT;
ALTER TABLE "TimeBlock" ADD COLUMN "seasonTo" TEXT;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "holidaysInSeason" BOOLEAN NOT NULL DEFAULT false;
