-- 7-day retention for instance_metrics via pg_cron: a nightly in-database
-- job prunes samples older than a week. Keeps the table bounded without any
-- app-side cron or coupling the delete to the insert path.
--
-- Requires the pg_cron extension. On Supabase it can be enabled here, or from
-- Dashboard → Database → Extensions if the migration role lacks permission.

-- migrate:up
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- idempotent (re)schedule: unschedule any existing job of this name first,
-- ignoring the error thrown when it doesn't exist yet.
DO $$
BEGIN
    PERFORM cron.unschedule('prune-instance-metrics');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
    'prune-instance-metrics',
    '0 3 * * *', -- 03:00 UTC daily
    $cron$DELETE FROM instance_metrics WHERE created_at < now() - interval '7 days'$cron$
);

-- migrate:down
DO $$
BEGIN
    PERFORM cron.unschedule('prune-instance-metrics');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
