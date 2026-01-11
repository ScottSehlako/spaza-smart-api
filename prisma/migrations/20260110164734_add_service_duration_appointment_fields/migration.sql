-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "durationMinutes" INTEGER;
