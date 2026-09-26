-- Live Data Readiness pass, §6 — alert mailbox tokens are stored hashed.
--
-- price_alerts.access_token held the bearer token in plaintext: anyone with a
-- database read could list or cancel every mailbox. The column now stores
-- 'sha256:' || hex(sha256(token)) — exactly what lib/db/alerts.ts writes for
-- new rows and verifies incoming `x-alert-token` headers against.
--
-- Existing rows are hashed in place with pgcrypto's digest(): the value the
-- user holds never changes — only our comparison moves behind the hash — so
-- every active mailbox link keeps working and nobody is silently locked out.
-- sha256 (rather than a slow KDF) is the right tool here because the input is
-- a 192-bit random token, not a human-chosen secret: there is nothing to
-- brute-force.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE price_alerts
   SET access_token = 'sha256:' || encode(digest(access_token, 'sha256'), 'hex')
 WHERE access_token IS NOT NULL
   AND access_token NOT LIKE 'sha256:%';
