-- 028_document_checklist_link.sql
--
-- Links a document_register row to the specific checklist item it was
-- uploaded as evidence for (if any). Without this link there was no way to
-- ask "which documents were attached to THIS checklist item" - the
-- evidence-note modal could only ever show newly-added documents in the
-- same modal session, never documents attached in a previous session, so
-- re-opening "Edit evidence note" always looked empty even when documents
-- had already been uploaded.
--
-- Nullable: documents added through the general Documents/VDR tabs (not
-- tied to one checklist item) keep checklist_item_id = NULL, unaffected.

ALTER TABLE document_register
  ADD COLUMN checklist_item_id INT UNSIGNED NULL DEFAULT NULL AFTER stage_number,
  ADD CONSTRAINT fk_document_register_checklist_item
    FOREIGN KEY (checklist_item_id) REFERENCES template_checklist_items(id),
  ADD INDEX idx_document_register_checklist_item (project_id, checklist_item_id);
