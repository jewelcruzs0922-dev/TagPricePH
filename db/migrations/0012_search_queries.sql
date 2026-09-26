-- 0012_search_queries.sql
--
-- What shoppers actually search for — the missing middle of the funnel
-- (search -> product view -> outbound click). Deliberately minimal: the query
-- text, how many results it returned, and when. No IPs, no user agents, no
-- session identifiers — this is business analytics, not visitor tracking.

CREATE TABLE search_queries (
  id           bigserial   PRIMARY KEY,
  query        text        NOT NULL,
  result_count integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_queries_recent_idx
  ON search_queries (created_at DESC);

CREATE INDEX search_queries_query_idx
  ON search_queries (query, created_at DESC);
