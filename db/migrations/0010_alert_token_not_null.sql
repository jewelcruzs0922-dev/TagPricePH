-- Backend §25: "every stored alert has a token" — the invariant db-verify
-- already checks — now enforced by the column type. 0008 added the column
-- nullable so its backfill could run in the same transaction; every insert
-- since goes through createAlert, which always supplies a token, so this
-- closes the door on a future path forgetting one. "NULL means no access"
-- becomes "NULL is impossible".
UPDATE price_alerts SET access_token = encode(gen_random_bytes(24), 'hex')
WHERE access_token IS NULL;

ALTER TABLE price_alerts ALTER COLUMN access_token SET NOT NULL;
