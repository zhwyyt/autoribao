-- Preserve source weight precision before aggregating process statistics.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.component ALTER COLUMN weight TYPE numeric USING weight::numeric;
COMMIT;