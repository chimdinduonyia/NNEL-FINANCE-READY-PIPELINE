-- ==========================================================================
-- 002_seed_template_v1.sql
-- Seeds template version '1.0' based on NNEL-CAM-FRP-001 v1.0.
--
-- PREREQUISITE: Run 001_initial_schema.sql and 002_working_data.sql first,
-- then create at least one admin account with `npm run create-admin`.
--
-- Run as the app DB user (nnel_app) or as root.
-- ==========================================================================

-- Insert template version; created_by is the first admin account.
INSERT INTO template_versions (version, description, is_active, created_by)
SELECT '1.0',
       'NNEL Finance-Ready Project Pipeline Procedure (NNEL-CAM-FRP-001 v1.0)',
       1,
       id
FROM   users
WHERE  system_role = 'admin'
LIMIT  1;

-- Capture the new template version's id for use in subsequent inserts.
SET @tv = (SELECT id FROM template_versions WHERE version = '1.0');

-- ==========================================================================
-- VDR FOLDER DEFINITIONS (00–09)
-- ==========================================================================
INSERT INTO template_vdr_folders
  (template_version_id, folder_code, name, sort_order)
VALUES
  (@tv, '00', 'Project Overview',           0),
  (@tv, '01', 'Corporate & Legal',          1),
  (@tv, '02', 'Technical & Engineering',    2),
  (@tv, '03', 'Environmental & Social',     3),
  (@tv, '04', 'Commercial & Offtake',       4),
  (@tv, '05', 'Financial Model & Returns',  5),
  (@tv, '06', 'Permits & Regulatory',       6),
  (@tv, '07', 'Insurance',                  7),
  (@tv, '08', 'Land & Site',                8),
  (@tv, '09', 'Other / Correspondence',     9);

-- ==========================================================================
-- CHECKLIST ITEMS — STAGE 0: Opportunity Screening
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 0, 'technical',     'S0-T-01', 'Technology readiness confirmed (TRL ≥ 6)',
   'Confirm the technology has been demonstrated at relevant scale. TRL 6 is minimum acceptable for FRP entry.', 1, 10),
  (@tv, 0, 'technical',     'S0-T-02', 'Site-level resource availability assessed',
   'Preliminary resource assessment (wind/solar yield, hydro flow, etc.) completed for the identified site(s).', 1, 20),
  -- Commercial
  (@tv, 0, 'commercial',    'S0-C-01', 'Market demand and offtake potential identified',
   'Identify potential off-takers (utility, C&I, government) and confirm market appetite at high level.', 1, 30),
  (@tv, 0, 'commercial',    'S0-C-02', 'Key commercial risks flagged',
   'Currency exposure, counterparty risk, regulatory risk — document at screening level.', 1, 40),
  -- Finance
  (@tv, 0, 'finance',       'S0-F-01', 'Order-of-magnitude CAPEX estimate prepared',
   'High-level cost range (±50% acceptable at this stage). Basis should be stated.', 1, 50),
  (@tv, 0, 'finance',       'S0-F-02', 'Development mandate or funding interest confirmed',
   'Internal mandate from NNEL Board or ED-CAM, or third-party co-developer interest on record.', 1, 60),
  -- Legal
  (@tv, 0, 'legal',         'S0-L-01', 'Applicable regulatory framework identified',
   'Identify the relevant energy sector regulator, licences required, and indicative timeline.', 1, 70),
  (@tv, 0, 'legal',         'S0-L-02', 'Site access and land tenure status noted',
   'Confirm land ownership or access route. Flag any known tenure disputes or acquisition complexity.', 1, 80),
  -- Environmental
  (@tv, 0, 'environmental', 'S0-E-01', 'Environmental sensitivity screening completed',
   'Desktop screening for protected areas, biodiversity hotspots, flood risk, and cultural heritage proximity.', 1, 90),
  (@tv, 0, 'environmental', 'S0-E-02', 'Community and stakeholder sensitivities flagged',
   'Identify affected communities and any known opposition or strategic stakeholder considerations.', 0, 100),
  -- Risk
  (@tv, 0, 'risk',          'S0-R-01', 'Preliminary risk identification completed',
   'List of key project risks at screening level. At minimum: technology, market, regulatory, environmental.', 1, 110),
  (@tv, 0, 'risk',          'S0-R-02', 'Show-stopper risks evaluated and documented',
   'Confirm no identified risk is a definitive project killer. If any exist, record decision to proceed or drop.', 1, 120);

-- ==========================================================================
-- CHECKLIST ITEMS — STAGE 1: Preliminary Assessment
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 1, 'technical',     'S1-T-01', 'Pre-feasibility study (PFS) completed',
   'Covers technology selection, site assessment, resource yield (P50/P90), preliminary layout.', 1, 10),
  (@tv, 1, 'technical',     'S1-T-02', 'Technology provider shortlisted and engaged',
   'At least two credible technology suppliers contacted; indicative equipment specifications and pricing obtained.', 1, 20),
  (@tv, 1, 'technical',     'S1-T-03', 'Grid connection point identified; interconnection assessment initiated',
   'Grid connection application submitted or formal assessment from system operator received.', 1, 30),
  -- Commercial
  (@tv, 1, 'commercial',    'S1-C-01', 'Indicative offtake term sheet or letter of intent obtained',
   'Non-binding LOI or heads of terms from prospective off-taker. Tariff range and tenor confirmed.', 1, 40),
  (@tv, 1, 'commercial',    'S1-C-02', 'Preliminary commercial structure agreed',
   'Revenue model (PPA, merchant, hybrid), ownership structure, and key commercial terms documented.', 1, 50),
  -- Finance
  (@tv, 1, 'finance',       'S1-F-01', 'Indicative financial model prepared (±30% cost estimate)',
   'Shows project returns (IRR, NPV, DSCR) on indicative basis. Financing mix assumed.', 1, 60),
  (@tv, 1, 'finance',       'S1-F-02', 'Indicative project returns assessed against investment criteria',
   'Equity IRR and project IRR vs. NNEL/NNPC hurdle rates. Sensitivity on key variables run.', 1, 70),
  -- Legal
  (@tv, 1, 'legal',         'S1-L-01', 'Project company / SPV structure proposed',
   'Ownership structure, shareholding, and corporate domicile options documented. Tax structuring noted.', 1, 80),
  (@tv, 1, 'legal',         'S1-L-02', 'Site tenure investigation completed',
   'Confirm land ownership, identify acquisition or leasing route, flag legal risks.', 1, 90),
  (@tv, 1, 'legal',         'S1-L-03', 'Regulatory milestones and permit timeline mapped',
   'List all required permits and licences with indicative lead times and dependencies.', 1, 100),
  -- Environmental
  (@tv, 1, 'environmental', 'S1-E-01', 'Initial Environmental Screening Report completed',
   'Scoping report confirming whether full ESIA is required and under which regulatory framework.', 1, 110),
  (@tv, 1, 'environmental', 'S1-E-02', 'Preliminary ESMP scope agreed',
   'High-level Environmental and Social Management Plan scope agreed with management.', 0, 120),
  -- Risk
  (@tv, 1, 'risk',          'S1-R-01', 'Preliminary risk register prepared',
   'Covers technical, commercial, regulatory, financial, and E&S risks with ownership and mitigation.', 1, 130),
  (@tv, 1, 'risk',          'S1-R-02', 'Risk allocation matrix (initial draft) prepared',
   'Identifies which risks are borne by NNEL, off-taker, contractor, lender, and insurer respectively.', 0, 140);

-- ==========================================================================
-- CHECKLIST ITEMS — STAGE 2: Full Feasibility
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 2, 'technical',     'S2-T-01', 'Full feasibility study (including FEED scope) completed',
   'Detailed engineering and resource assessment. Basis of design and technology specification locked.', 1, 10),
  (@tv, 2, 'technical',     'S2-T-02', 'EPC contractor shortlisted; indicative EPC contract structure agreed',
   'Minimum two credible EPC tenderers evaluated. Contract model (lump-sum, EPC-M, hybrid) agreed.', 1, 20),
  (@tv, 2, 'technical',     'S2-T-03', 'Grid connection agreement (or conditional approval) obtained',
   'Formal grid connection agreement or conditional offer from system operator received and reviewed.', 1, 30),
  -- Commercial
  (@tv, 2, 'commercial',    'S2-C-01', 'Offtake agreement: heads of terms or draft PPA executed',
   'Binding or substantially-agreed HoT/PPA with tariff, indexation, capacity, and tenor confirmed.', 1, 40),
  (@tv, 2, 'commercial',    'S2-C-02', 'Procurement and contracting strategy finalised',
   'Confirms EPC strategy, O&M approach, procurement timeline, and packaging decisions.', 1, 50),
  (@tv, 2, 'commercial',    'S2-C-03', 'Insurance: indicative programme terms obtained',
   'Indicative construction all-risks (CAR), DSU, third-party liability, and operational insurance terms.', 1, 60),
  -- Finance
  (@tv, 2, 'finance',       'S2-F-01', 'Bankable financial model completed (±10% CAPEX)',
   'Full project finance model — base case, sensitivities, stress scenarios. DSCR and LLCR confirmed.', 1, 70),
  (@tv, 2, 'finance',       'S2-F-02', 'Financial close strategy and lender shortlist agreed',
   'Debt/equity ratio, tenure, security structure. Mandate letters or expressions of interest from lenders.', 1, 80),
  (@tv, 2, 'finance',       'S2-F-03', 'Tax and investment structuring finalised',
   'VAT, withholding tax, capital allowances, and pioneer status (if applicable) confirmed with advisors.', 1, 90),
  -- Legal
  (@tv, 2, 'legal',         'S2-L-01', 'ESIA/ESMP completed and disclosed',
   'Full Environmental and Social Impact Assessment submitted to regulator and publicly disclosed per IFC PS.', 1, 100),
  (@tv, 2, 'legal',         'S2-L-02', 'Permit applications submitted; approvals timeline confirmed',
   'All required permit applications filed. Outstanding permits identified as conditions to Financial Close.', 1, 110),
  (@tv, 2, 'legal',         'S2-L-03', 'Legal due diligence on land tenure completed',
   'Title searches, encumbrances, easement requirements, and land access agreements status confirmed.', 1, 120),
  -- Environmental
  (@tv, 2, 'environmental', 'S2-E-01', 'Full ESIA / ESMP completed, disclosed, and submitted for approval',
   'Compliant with IFC Performance Standards and national EIA regulations. Disclosure period met.', 1, 130),
  (@tv, 2, 'environmental', 'S2-E-02', 'Stakeholder engagement plan implemented and documented',
   'Meaningful consultation with Project-Affected Persons and key stakeholders. Grievance mechanism in place.', 1, 140),
  -- Risk
  (@tv, 2, 'risk',          'S2-R-01', 'Full risk matrix and risk allocation framework completed',
   'Comprehensive risk register with probability/impact ratings, ownership, and mitigation actions confirmed.', 1, 150),
  (@tv, 2, 'risk',          'S2-R-02', 'Insurance programme scoped; broker appointed',
   'Insurance broker engaged. Programme covers CAR, DSU, third-party liability, and project-specific risks.', 1, 160);

-- ==========================================================================
-- CHECKLIST ITEMS — STAGE 3: Financial Close / FID
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 3, 'technical',     'S3-T-01', 'Lender''s Independent Engineer (IE) report received and accepted',
   'Technical due diligence report from lender-appointed IE confirms technical viability and cost estimate.', 1, 10),
  (@tv, 3, 'technical',     'S3-T-02', 'Construction programme and EPC contract finalised',
   'Final EPC contract executed. Construction schedule, milestones, and performance tests agreed.', 1, 20),
  -- Commercial
  (@tv, 3, 'commercial',    'S3-C-01', 'All commercial agreements executed',
   'PPA/offtake, EPC, O&M, fuel supply (if applicable), interconnection, and any land lease agreements signed.', 1, 30),
  (@tv, 3, 'commercial',    'S3-C-02', 'Conditions Precedent (CP) register finalised and baseline set',
   'All First Draw CPs listed, ownership assigned, and baseline evidenced. No CP outstanding without a waiver.', 1, 40),
  -- Finance
  (@tv, 3, 'finance',       'S3-F-01', 'All finance agreements executed',
   'Term loan facility agreement, equity subscription agreement, security package, and intercreditor documents signed.', 1, 50),
  (@tv, 3, 'finance',       'S3-F-02', 'Security package in place',
   'Charges, step-in rights, direct agreements, assignment of contracts, and project accounts all established.', 1, 60),
  (@tv, 3, 'finance',       'S3-F-03', 'Lender''s financial model agreed and baselined',
   'Lender''s base-case model reviewed, agreed, and baselined with all parties. DSCR/LLCR confirmed.', 1, 70),
  -- Legal
  (@tv, 3, 'legal',         'S3-L-01', 'All permits in place or secured as conditions precedent',
   'Generation licence, environmental approvals, grid connection agreement, and land rights all confirmed.', 1, 80),
  (@tv, 3, 'legal',         'S3-L-02', 'SPV / corporate structure completed; all consents obtained',
   'SPV incorporated, shareholding agreed, board constituted, all regulatory/corporate consents obtained.', 1, 90),
  (@tv, 3, 'legal',         'S3-L-03', 'Land agreements executed',
   'Land lease, purchase, or access agreement signed and registered where required.', 1, 100),
  -- Environmental
  (@tv, 3, 'environmental', 'S3-E-01', 'E&S Action Plan (ESAP) agreed with lenders; monitoring baseline set',
   'ESAP agreed, E&S covenants in finance agreements, and baseline E&S monitoring data collected.', 1, 110),
  (@tv, 3, 'environmental', 'S3-E-02', 'E&S reporting obligations included in finance agreements',
   'Confirm periodic E&S reporting requirements (to lenders, regulators) are documented in the financing docs.', 1, 120),
  -- Risk
  (@tv, 3, 'risk',          'S3-R-01', 'Final risk matrix approved by FID approver',
   'Updated risk register with post-mitigation ratings. Signed off by FID approver as residual risk acceptable.', 1, 130),
  (@tv, 3, 'risk',          'S3-R-02', 'Insurance placed; certificates provided to lenders',
   'All required construction-phase covers placed (CAR, DSU, PLL, liability). Endorsements issued to lenders.', 1, 140);

-- ==========================================================================
-- CHECKLIST ITEMS — STAGE 4: First Disbursement
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 4, 'technical',     'S4-T-01', 'Construction commenced; contractor mobilised on site',
   'Evidence of contractor mobilisation: site establishment, equipment on-site, construction log initiated.', 1, 10),
  (@tv, 4, 'technical',     'S4-T-02', 'Construction risk management plan active',
   'CRMP reviewed, approved, and contractor confirmed it is being implemented.', 1, 20),
  -- Commercial
  (@tv, 4, 'commercial',    'S4-C-01', 'All First Draw Conditions Precedent verified as satisfied',
   'CP register reviewed item-by-item. Each CP marked closed with documentary evidence on file.', 1, 30),
  (@tv, 4, 'commercial',    'S4-C-02', 'Drawdown notice delivered and confirmed by Facility Agent',
   'Utilisation/drawdown notice submitted within notice period. Agent has confirmed receipt and compliance.', 1, 40),
  -- Finance
  (@tv, 4, 'finance',       'S4-F-01', 'Finance team confirmation: all CPs for first draw are closed',
   'Finance sign-off memo confirming CP register is complete. No open or waived CPs without Board approval.', 1, 50),
  (@tv, 4, 'finance',       'S4-F-02', 'Project accounts funded to required reserve levels',
   'DSRA, MMRA, and any other reserve accounts funded per the finance agreement requirements.', 1, 60),
  -- Legal
  (@tv, 4, 'legal',         'S4-L-01', 'CP register updated: all First Draw CPs closed with evidence',
   'Legal confirmation that all documentary CPs (originals or certified copies) have been delivered to Agent.', 1, 70),
  (@tv, 4, 'legal',         'S4-L-02', 'Any permits outstanding pre-draw confirmed not required at this stage',
   'Legal opinion or agent waiver confirming outstanding permits do not block first disbursement.', 0, 80),
  -- Environmental
  (@tv, 4, 'environmental', 'S4-E-01', 'Pre-draw E&S monitoring reports submitted to lenders',
   'Any E&S reports due before first draw have been submitted and acknowledged by lenders.', 1, 90),
  (@tv, 4, 'environmental', 'S4-E-02', 'Construction ESAP items due for this phase verified complete',
   'ESAP tracker reviewed; any ESAP actions due prior to first draw are confirmed complete with evidence.', 1, 100),
  -- Risk
  (@tv, 4, 'risk',          'S4-R-01', 'Construction risk management plan reviewed and active',
   'CRMP confirmed active. Contractor H&S plan reviewed and approved by project team.', 1, 110),
  (@tv, 4, 'risk',          'S4-R-02', 'Insurance certificates in place; cover confirmed active',
   'All construction-phase insurance policies active. Certificates of currency issued to lenders.', 1, 120);

-- ==========================================================================
-- CHECKLIST ITEMS — STAGE 5: COD / Commissioning
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 5, 'technical',     'S5-T-01', 'Commissioning test programme completed; results documented',
   'All required performance and acceptance tests run per the EPC contract. Test reports reviewed by IE.', 1, 10),
  (@tv, 5, 'technical',     'S5-T-02', 'Provisional Acceptance Certificate (PAC) issued by employer',
   'PAC signed confirming project meets performance thresholds. Punch list items < commercial operation threshold.', 1, 20),
  (@tv, 5, 'technical',     'S5-T-03', 'Final Acceptance Certificate (FAC) timeline confirmed',
   'FAC issue date confirmed (or FAC already issued). Defects liability period end date recorded.', 0, 30),
  -- Commercial
  (@tv, 5, 'commercial',    'S5-C-01', 'Commercial Operation Date (COD) declared; first revenue confirmed',
   'COD notice issued to off-taker. First energy delivery and revenue receipt confirmed.', 1, 40),
  (@tv, 5, 'commercial',    'S5-C-02', 'O&M agreement transitioned to operational phase',
   'O&M contractor on-site, operational procedures handed over, operational log commenced.', 1, 50),
  -- Finance
  (@tv, 5, 'finance',       'S5-F-01', 'Financial close-out accounts prepared; cost-to-complete reconciled',
   'Final construction cost reconciliation vs. approved budget. Cost overrun/underrun documented.', 1, 60),
  (@tv, 5, 'finance',       'S5-F-02', 'Completion tests and technical ratios confirmed to lenders',
   'Lender''s IE completion certificate received. Technical completion ratios (P50 yield, availability) confirmed.', 1, 70),
  -- Legal
  (@tv, 5, 'legal',         'S5-L-01', 'All operating permits in place (generation, dispatch, environmental)',
   'Generation licence, grid dispatch agreement, environmental operating permit — all active for commercial operation.', 1, 80),
  (@tv, 5, 'legal',         'S5-L-02', 'O&M and asset management agreements active (operational phase)',
   'Confirm O&M agreement and any asset management agreement are in their operational-phase terms.', 1, 90),
  -- Environmental
  (@tv, 5, 'environmental', 'S5-E-01', 'ESAP completion status confirmed; residual items tracked',
   'ESAP tracker reviewed. All material ESAP actions confirmed complete. Any residual items in ongoing log.', 1, 100),
  (@tv, 5, 'environmental', 'S5-E-02', 'Operational E&S monitoring programme activated',
   'Operational ESMP active. Monitoring parameters, frequency, and reporting chain confirmed.', 1, 110),
  -- Risk
  (@tv, 5, 'risk',          'S5-R-01', 'Operational Risk Management Plan (ORMP) finalised and activated',
   'ORMP reviewed and approved. O&M contractor confirmed it is operational.', 1, 120),
  (@tv, 5, 'risk',          'S5-R-02', 'Operational insurance programme transitioned and active',
   'Construction insurance closed out. Operational covers (MBI, PLL, BI, liability) placed and active.', 1, 130);
