begin;
select plan(6);

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'stale@example.com');

insert into workouts (id, user_id, started_at, notes, client_rev, updated_at)
  values ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
          now(), 'laptop', 5, '2000-01-01');

select ok(
  (select updated_at > '2000-01-02' from workouts where id = 'cccccccc-0000-0000-0000-000000000001'),
  'an insert is stamped with server time, not the device clock'
);

set local session_replication_role = replica;
update workouts set updated_at = '2000-01-01' where id = 'cccccccc-0000-0000-0000-000000000001';
set local session_replication_role = origin;

insert into workouts (id, user_id, started_at, notes, client_rev)
  values ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
          now(), 'old phone', 3)
  on conflict (id) do update set notes = excluded.notes, client_rev = excluded.client_rev;

select is(
  (select notes from workouts where id = 'cccccccc-0000-0000-0000-000000000001'),
  'laptop',
  'a lower revision does not overwrite the stored row'
);

select ok(
  (select updated_at > '2000-01-02' from workouts where id = 'cccccccc-0000-0000-0000-000000000001'),
  'a refused write bumps updated_at so the next pull brings the stored row back'
);

update workouts set deleted_at = now(), client_rev = 4
  where id = 'cccccccc-0000-0000-0000-000000000001';

select is(
  (select deleted_at from workouts where id = 'cccccccc-0000-0000-0000-000000000001'),
  null,
  'a stale delete is refused too'
);

update workouts set notes = 'same revision', client_rev = 5
  where id = 'cccccccc-0000-0000-0000-000000000001';

select is(
  (select notes from workouts where id = 'cccccccc-0000-0000-0000-000000000001'),
  'same revision',
  'an equal revision is accepted, last writer wins'
);

update workouts set notes = 'newer', client_rev = 6
  where id = 'cccccccc-0000-0000-0000-000000000001';

select is(
  (select client_rev from workouts where id = 'cccccccc-0000-0000-0000-000000000001'),
  6,
  'a higher revision is accepted'
);

select * from finish();
rollback;
