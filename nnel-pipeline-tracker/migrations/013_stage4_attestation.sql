-- ==========================================================================
-- 013_stage4_attestation.sql
-- Makes gate_decisions.authority nullable so Stage 4 (First Disbursement)
-- attestations by the Project Lead can be stored without a DOA authority
-- level (which applies only to standard gate_approver decisions).
-- ==========================================================================

ALTER TABLE gate_decisions
  MODIFY COLUMN authority
    ENUM('ed_cam','md_nnel','slt_mtc','nnel_board','nnpc_group')
    NULL DEFAULT NULL;
