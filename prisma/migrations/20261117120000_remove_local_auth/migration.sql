BEGIN;

-- Local sessions must not remain valid after local authentication is removed.
DELETE FROM "AuthSession" WHERE "origin" = 'LOCAL';

ALTER TABLE "AuthSession"
  DROP COLUMN "origin",
  ALTER COLUMN "siauSid" SET NOT NULL;

DROP TYPE "AuthOrigin";

ALTER TABLE "User"
  DROP COLUMN "login",
  DROP COLUMN "password",
  DROP COLUMN "mustChangePassword";

COMMIT;
