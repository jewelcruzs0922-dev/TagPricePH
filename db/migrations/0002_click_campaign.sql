-- Phase 4: outbound clicks should record the campaign the link was built with,
-- so attribution survives the redirect.

ALTER TABLE click_events ADD COLUMN campaign text;
