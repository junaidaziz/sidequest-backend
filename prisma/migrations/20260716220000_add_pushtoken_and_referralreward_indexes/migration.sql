-- PushToken is looked up by token alone (not scoped to userId) when the push
-- provider reports a token as invalid/expired — the existing composite
-- (userId, token) unique index can't serve that lookup.
CREATE INDEX "PushToken_token_idx" ON "PushToken"("token");

-- Backs GET /referrals/me's aggregate(where: { userId, type }) call.
CREATE INDEX "ReferralReward_userId_idx" ON "ReferralReward"("userId");
