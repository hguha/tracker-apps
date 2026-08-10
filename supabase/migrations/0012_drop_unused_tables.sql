-- Drop three tables nothing uses.
--
-- Each was created in 0001 for a feature that either got cut or was never built.
-- Verified before dropping: zero references anywhere in src/ or
-- supabase/functions/, and the row counts below are from the live database.
--
--   allowed_emails           1 row.  Backed invite-only signup, which 0010
--                                    abandoned along with its enforcing trigger.
--                                    The table has done nothing since.
--   push_subscriptions       0 rows. Web-push storage (§4.10). Push is not built:
--                                    the rest timer only has its foreground tier.
--   scheduled_notifications  0 rows. Server-scheduled push (§10.3), same story.
--
-- The push tables are a deliberate re-do-later: if push ships it needs a
-- Cloudflare Durable Object and a Worker anyway, so the schema will be designed
-- alongside that rather than inherited from a guess made months earlier. An empty
-- table that no code reads is worse than no table — it reads as a working feature.
--
-- NOT dropped, despite looking unused:
--   profiles          Holds every app preference — units, theme, week start,
--                     weekly goal, height, training goal, onboarded_at. Supabase
--                     Auth stores identity only. 23 client references.
--   personal_records  0 server rows because PRs are derived from sets and
--                     recomputed on-device (deliberately absent from
--                     SYNCED_TABLES), but rebuild_prs() is the server-side repair
--                     if a device's records ever go wrong. Cheap to keep.

-- `cascade` takes the RLS policies and indexes with each table.
drop table if exists public.scheduled_notifications cascade;
drop table if exists public.push_subscriptions cascade;
drop table if exists public.allowed_emails cascade;
