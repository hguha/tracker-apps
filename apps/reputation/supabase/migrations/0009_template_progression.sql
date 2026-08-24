-- Declarative progression rule per template-exercise (§7 Phase 4).
--
-- Stored as JSONB so the rule shape can evolve (currently a single 'double'
-- progression: { kind, incrementKg, maxRpe }). null = manual, no progression.
-- The client applies it at template instantiation; the column just persists and
-- syncs the setting.

alter table template_exercises
  add column if not exists progression jsonb;
