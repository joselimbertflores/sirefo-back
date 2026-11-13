BEGIN;

-- Pending attempts from the previous OAuth contract cannot be resumed safely.
-- Application sessions, users and business data are preserved.
DELETE FROM "OAuthTransaction";

-- AlterTable
ALTER TABLE "AuthSession" DROP COLUMN "accessToken",
DROP COLUMN "accessTokenExpiresAt",
DROP COLUMN "refreshToken",
DROP COLUMN "refreshTokenExpiresAt";

-- AlterTable
ALTER TABLE "OAuthTransaction" ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "nonce" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "AuthSession_siauSid_idx" ON "AuthSession"("siauSid");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthTransaction_id_key" ON "OAuthTransaction"("id");

COMMIT;
