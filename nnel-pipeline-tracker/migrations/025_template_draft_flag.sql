-- ==========================================================================
-- 025_template_draft_flag.sql
--
-- Adds a draft/published state to template versions, separate from
-- is_active (which controls what NEW projects get by default). A draft:
--   - is never returned to the "+ New Project" template picker
--     (server enforces via ?published_only=true on GET /api/templates)
--   - can never be set active (setActive() rejects drafts server-side)
--   - always has zero projects using it (nothing can select it), so every
--     edit to a draft applies in place — no fork-on-edit noise while an
--     admin is still building it out
--   - becomes usable only via the explicit "Publish" action in the
--     template editor (PATCH .../publish), which just flips is_draft to 0
--     and does NOT also set it active — that stays a separate, deliberate
--     step via the existing "Set as Active" button (owner's explicit
--     choice, 2026-08-17).
--
-- Existing versions are marked published (is_draft = 0) — they're already
-- live/selectable today and this migration must not hide anything that's
-- already in use.
-- ==========================================================================

ALTER TABLE template_versions
  ADD COLUMN is_draft TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active;

UPDATE template_versions SET is_draft = 0;
