-- Preserve the intent of disabled local accounts before removing the duplicated state.
UPDATE "User"
SET "password" = NULL
WHERE "active" = false;

-- AlterTable
ALTER TABLE "User"
ALTER COLUMN "login" DROP NOT NULL;

-- Remove synthetic logins previously generated for SIAU-only users.
UPDATE "User"
SET "login" = NULL
WHERE "externalKey" IS NOT NULL
  AND "password" IS NULL
  AND "login" ~ '^siau_[0-9a-f]{32}$';

-- AlterTable
ALTER TABLE "User"
DROP COLUMN "active";
