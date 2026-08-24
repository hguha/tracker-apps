-- Show-avatar preference, for the Home training avatar (§5.2.1).
--
-- The avatar is opt-in while it's a prototype, so this defaults off. Existing
-- rows get the default without a backfill pass.

alter table profiles
  add column if not exists show_avatar boolean not null default false;
