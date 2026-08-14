-- ==========================================================================
-- NNEL Finance-Ready Pipeline — Abatement / Carbon Template Seed
-- Migration: 007_seed_template_abatement_v1.sql
-- Run AFTER 002_seed_template_v1.sql (Solar PV) is already seeded.
-- Creates template_version 'abatement-1.0' and seeds all 6 stages.
-- Covers: Flare gas commercialisation, methane reduction,
--         energy efficiency, nature-based solutions, carbon credit origination.
-- ==========================================================================

USE nnel_frp;

-- --------------------------------------------------------------------------
-- Insert template version
-- --------------------------------------------------------------------------
INSERT INTO template_versions (version, technology, description, is_active, created_by)
VALUES ('abatement-1.0', 'abatement',
        'NNEL FRP Abatement/Carbon Template v1.0 — Flare Gas, Methane Reduction, NBS, Carbon Credits',
        1, 1);

SET @tv = (SELECT id FROM template_versions WHERE version = 'abatement-1.0');

-- --------------------------------------------------------------------------
-- VDR FOLDER DEFINITIONS (same 10-folder structure)
-- --------------------------------------------------------------------------
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
-- STAGE 0 — OPPORTUNITY SCREENING
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 0, 'technical', 'A0-T-01',
   'Emission source identified and quantified at high level',
   'Identify the emission source (flare stack, fugitive methane, land use, energy use). Provide order-of-magnitude annual tCO2e estimate. State data source (satellite, operational data, estimate).',
   1, 10),
  (@tv, 0, 'technical', 'A0-T-02',
   'Abatement technology or intervention identified (TRL ≥ 6)',
   'Confirm the proposed abatement technology or nature-based intervention has been demonstrated at scale. For flare gas: confirm gas composition data available. For NBS: confirm land area and ecosystem type.',
   1, 20),
  -- Commercial
  (@tv, 0, 'commercial', 'A0-C-01',
   'Carbon market pathway identified (voluntary vs. compliance)',
   'Determine target registry: Verra VCS, Gold Standard, or UNFCCC Article 6 compliance pathway. Identify applicable methodology. Confirm CORSIA eligibility assessment if aviation buyers are targeted.',
   1, 30),
  (@tv, 0, 'commercial', 'A0-C-02',
   'Indicative carbon credit price and buyer market confirmed',
   'Research current spot and forward market prices for the relevant credit type (e.g. REDD+, flare gas VCU, CCBS-certified). Identify at least one potential credit buyer or broker.',
   1, 40),
  -- Finance
  (@tv, 0, 'finance', 'A0-F-01',
   'Order-of-magnitude project economics prepared',
   'Indicative revenue (tCO2e × floor price), project development and MRV cost range, and indicative IRR. Minimum threshold: 15%. Note carbon price floor assumption clearly.',
   1, 50),
  (@tv, 0, 'finance', 'A0-F-02',
   'Development mandate or co-developer interest confirmed',
   'Internal mandate from NNEL Board or ED-CAM, or third-party co-developer/verifier interest confirmed.',
   1, 60),
  -- Legal
  (@tv, 0, 'legal', 'A0-L-01',
   'Regulatory and registry framework identified',
   'NCCC registration requirements, NMDPRA/NUPRC carbon reporting obligations, SEC disclosure requirements (if material), and applicable international registry rules noted.',
   1, 70),
  (@tv, 0, 'legal', 'A0-L-02',
   'No double-counting or active competing crediting mechanism',
   'Confirm no other carbon credit mechanism is currently active for the same emission source. Confirm regulatory surplus (no legal obligation to reduce these emissions already exists).',
   1, 80),
  -- ESG
  (@tv, 0, 'esg', 'A0-E-01',
   'Co-benefits and community impacts at project location noted',
   'Identify potential co-benefits: energy access, jobs, biodiversity, gender, food security. Note any communities directly affected by the project activity.',
   1, 90),
  (@tv, 0, 'esg', 'A0-E-02',
   'No fatal permanence or reversal risk flags',
   'For land-based (NBS) projects: confirm no active deforestation threat that cannot be mitigated. For technical projects: confirm continuous monitoring is technically feasible.',
   1, 100);

-- ==========================================================================
-- STAGE 1 — PRELIMINARY ASSESSMENT
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 1, 'technical', 'A1-T-01',
   'Baseline emissions quantification completed per ISO 14064-1/2',
   'Establish credible baseline for the specific project type. Quantify baseline emissions (tCO2e/year at P50). Document methodology, data sources, and key assumptions.',
   1, 10),
  (@tv, 1, 'technical', 'A1-T-02',
   'Abatement potential calculated — MtCO2e/year at P50 and P90',
   'Project-level abatement potential quantified at P50 (base case) and P90 (conservative) scenarios. Net abatement after leakage deduction confirmed.',
   1, 20),
  (@tv, 1, 'technical', 'A1-T-03',
   'Carbon credit registry pre-screening completed',
   'Verra VCS, Gold Standard, or Article 6 compliance pathway determination confirmed. Applicable methodology identified and assessed for eligibility. Concept note or PIN drafted.',
   1, 30),
  (@tv, 1, 'technical', 'A1-T-04',
   'MRV system requirements and cost assessed',
   'Monitoring, Reporting & Verification system requirements identified. Automated real-time monitoring vs. manual measurement approach assessed. 10-year data archiving requirement costed.',
   1, 40),
  (@tv, 1, 'technical', 'A1-T-05',
   'Carbon credit project lifecycle mapped (PIN → Validation → Registration → Verification → Issuance)',
   'Full lifecycle timeline from concept note to first credit issuance confirmed. Accredited validation and verification body (VVB) shortlisted: DNV, SGS, Bureau Veritas, or equivalent.',
   1, 50),
  -- Commercial
  (@tv, 1, 'commercial', 'A1-C-01',
   'Co-benefit identification completed for premium credit pricing',
   'SDG alignment documented. CCBS certification potential assessed (targets 20–50% pricing premium). Gender and community benefit metrics identified.',
   1, 60),
  (@tv, 1, 'commercial', 'A1-C-02',
   'Indicative carbon credit forward purchase agreement interest confirmed',
   'At least one credit-rated corporate buyer or broker has expressed interest in a forward purchase agreement. CORSIA eligibility assessed if aviation sector targeted.',
   1, 70),
  -- Finance
  (@tv, 1, 'finance', 'A1-F-01',
   'Indicative financial model prepared (development cost + credit revenue)',
   'Full project development cost (registry, validation, MRV, verification, buffer pool), revenue (tCO2e × forward price at P50/P90), and project IRR modelled. IRR must exceed 15%.',
   1, 80),
  (@tv, 1, 'finance', 'A1-F-02',
   'Carbon price floor sensitivity completed',
   'IRR modelled at floor carbon prices (Verra spot floor, CORSIA floor). Project viability confirmed even at conservative price assumptions.',
   1, 90),
  -- Legal
  (@tv, 1, 'legal', 'A1-L-01',
   'Additionality assessment completed at preliminary level',
   'Financial additionality demonstrated (project not viable without carbon revenue). Regulatory surplus confirmed (no legal mandate to reduce these emissions). Preliminary additionality argument documented.',
   1, 100),
  (@tv, 1, 'legal', 'A1-L-02',
   'NCCC registration pathway and NMDPRA/NUPRC reporting obligations confirmed',
   'Nigerian Carbon market regulatory requirements identified. NCCC registration pre-screening initiated. NMDPRA/NUPRC carbon reporting format confirmed for upstream projects.',
   1, 110),
  -- ESG
  (@tv, 1, 'esg', 'A1-E-01',
   'Stakeholder map and community engagement plan prepared',
   'Communities within project area identified and mapped. Free, Prior and Informed Consent (FPIC) requirement assessed for land-based projects. Initial engagement approach documented.',
   1, 120),
  (@tv, 1, 'esg', 'A1-E-02',
   'Permanence and reversal risk preliminary assessment completed',
   'Reversal risk sources identified (fire, drought, policy change, illegal activity). Buffer pool contribution estimate (Verra AFOLU buffer or equivalent) calculated. Reversal insurance requirement assessed.',
   1, 130);

-- ==========================================================================
-- STAGE 2 — FULL FEASIBILITY & DUE DILIGENCE
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 2, 'technical', 'A2-T-01',
   'Third-party verified baseline emissions report completed',
   'Accredited verifier (SGS, Bureau Veritas, DNV, or equivalent) has verified baseline emissions calculation. Report conforms to applicable registry methodology and ISO 14064-2.',
   1, 10),
  (@tv, 2, 'technical', 'A2-T-02',
   'MRV system design validated per OGMP 2.0 or applicable standard',
   'For gas projects: OGMP 2.0 Level 4/5 MRV design validated. For other projects: registry-approved monitoring plan validated. Automated monitoring infrastructure costed and procurement-ready.',
   1, 20),
  (@tv, 2, 'technical', 'A2-T-03',
   'Project Design Document (PDD) completed for VCS or Gold Standard registration',
   'Full PDD prepared covering: project description, baseline methodology, additionality demonstration, monitoring plan, quantification approach, and stakeholder consultation summary.',
   1, 30),
  (@tv, 2, 'technical', 'A2-T-04',
   'Additionality demonstration completed per applicable registry methodology',
   'Investment barrier, barrier analysis, and common practice tests completed and documented. Additionality confirmed by third-party validation body.',
   1, 40),
  (@tv, 2, 'technical', 'A2-T-05',
   'Long-term monitoring and permanence risk assessment completed',
   'Permanence risk matrix completed. Buffer pool contribution calculated and confirmed with registry. Reversal insurance obtained or buffer contribution confirmed as sufficient.',
   1, 50),
  -- Commercial
  (@tv, 2, 'commercial', 'A2-C-01',
   'Carbon credit forward sale agreement or binding offtake indication confirmed',
   'Minimum 3-year forward purchase agreement executed or term sheet agreed with credit-rated corporate buyer. Price formula, volume, vintage, and quality specifications confirmed.',
   1, 60),
  (@tv, 2, 'commercial', 'A2-C-02',
   'CCBS certification application initiated (if applicable)',
   'CCBS audit scope agreed with Verra. SDG co-benefit metrics quantified and independently verified. Premium pricing uplift confirmed in financial model.',
   1, 0),
  (@tv, 2, 'commercial', 'A2-C-03',
   'Insurance programme designed',
   'Reversal risk insurance (if applicable), project liability insurance, and MRV system insurance designed. A-rated insurer or specialist carbon market insurer confirmed.',
   1, 70),
  -- Finance
  (@tv, 2, 'finance', 'A2-F-01',
   'Bankable financial model completed (FAST standard)',
   'Full project finance model: base case at P50, stress at P90 and carbon price floor, sensitivity on top 5 value drivers. Project IRR >15% confirmed at base case.',
   1, 80),
  (@tv, 2, 'finance', 'A2-F-02',
   'Financial close strategy and lender/investor shortlist agreed',
   'Financing structure (debt/equity/grant), target DFIs, climate funds (GEAPP, GCPF, EDGE), and carbon finance facilities identified. Green bond eligibility assessed.',
   1, 90),
  -- Legal
  (@tv, 2, 'legal', 'A2-L-01',
   'PDD submitted to registry; validation process initiated',
   'PDD submitted to Verra, Gold Standard, or applicable registry. Validation body (VVB) appointed. Public consultation period for PDD commenced.',
   1, 100),
  (@tv, 2, 'legal', 'A2-L-02',
   'NCCC registration filed; NMDPRA/NUPRC approvals obtained',
   'Nigerian Carbon Commodity Corporation registration in process. All upstream regulatory approvals obtained for flare gas or methane reduction projects.',
   1, 110),
  (@tv, 2, 'legal', 'A2-L-03',
   'Land tenure, access rights, and community agreements confirmed (NBS projects)',
   'For nature-based projects: independent legal opinion on land tenure. FPIC documented. Community benefit-sharing agreement executed. Carbon rights ownership legally confirmed.',
   0, 120),
  -- ESG
  (@tv, 2, 'esg', 'A2-E-01',
   'Full ESIA completed per IFC Performance Standards 1–8',
   'ESIA covering all relevant IFC PS confirmed. Community consultation completed. ESMP prepared. Gender and vulnerable groups impact assessment documented.',
   1, 130),
  (@tv, 2, 'esg', 'A2-E-02',
   'SDG alignment documentation and co-benefit quantification completed',
   'SDG contribution (SDG 7, 13, 15 etc.) documented with measurable indicators. Co-benefit monitoring plan integrated into MRV system.',
   1, 140);

-- ==========================================================================
-- STAGE 3 — FINANCING PREPARATION & LENDER ENGAGEMENT
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  (@tv, 3, 'technical', 'A3-T-01',
   'Registry validation completed; project registered and active',
   'VVB validation report received. Project formally registered with Verra, Gold Standard, or applicable registry. Project ID confirmed. First monitoring period commenced.',
   1, 10),
  (@tv, 3, 'technical', 'A3-T-02',
   'MRV system operational; first data set verified',
   'Monitoring infrastructure installed and operational. First data set collected and independently reviewed. Data archiving system active (10-year minimum retention).',
   1, 20),
  (@tv, 3, 'commercial', 'A3-C-01',
   'Carbon credit forward purchase agreement executed',
   'Binding forward purchase agreement signed with credit-rated buyer. Volume, price formula, vintage, delivery terms, and quality specifications confirmed.',
   1, 30),
  (@tv, 3, 'commercial', 'A3-C-02',
   'All project development agreements executed',
   'Technology supply, installation, O&M, land/access agreements, and community benefit-sharing agreements all signed.',
   1, 40),
  (@tv, 3, 'finance', 'A3-F-01',
   'All finance agreements executed',
   'Loan/grant facility agreements, equity subscription, security package, and climate fund disbursement conditions all confirmed and signed.',
   1, 50),
  (@tv, 3, 'finance', 'A3-F-02',
   'Green bond or sustainability-linked financing documentation completed (if applicable)',
   'ICMA Green Bond Principles compliance confirmed. Second-party opinion obtained. Use-of-proceeds framework documented.',
   0, 60),
  (@tv, 3, 'legal', 'A3-L-01',
   'All permits and registry registrations in place',
   'NCCC registration confirmed. NMDPRA/NUPRC approvals effective. All environmental permits received. No outstanding conditions that would prevent implementation.',
   1, 70),
  (@tv, 3, 'esg', 'A3-E-01',
   'ESMP disclosed and community benefit agreement operative',
   'ESMP publicly disclosed per IFC requirements. Community benefit agreement effective and first community payment/benefit confirmed.',
   1, 80);

-- ==========================================================================
-- STAGE 4 — FINANCIAL CLOSE & CONSTRUCTION / IMPLEMENTATION READINESS
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  (@tv, 4, 'technical', 'A4-T-01',
   'Project implementation commenced; contractor/operator mobilised',
   'For technical projects: equipment installation commenced, contractor on-site, construction log initiated. For NBS: planting, restoration, or protection activities commenced.',
   1, 10),
  (@tv, 4, 'technical', 'A4-T-02',
   'MRV system fully commissioned and data collection active',
   'All monitoring equipment calibrated and operational. First complete monitoring period data set being collected. Real-time reporting dashboard active.',
   1, 20),
  (@tv, 4, 'commercial', 'A4-C-01',
   'All First Draw Conditions Precedent verified as satisfied',
   'CP register reviewed item-by-item. Each CP marked closed with documentary evidence. First credit vintage period timeline confirmed.',
   1, 30),
  (@tv, 4, 'commercial', 'A4-C-02',
   'Drawdown notice delivered; first disbursement received',
   'Utilisation/drawdown notice submitted. Facility Agent has confirmed compliance. First disbursement received and deployed.',
   1, 40),
  (@tv, 4, 'finance', 'A4-F-01',
   'Finance team confirmation: all CPs for first draw are closed',
   'Finance sign-off memo confirming CP register is complete. Reserve accounts funded per finance agreement.',
   1, 50),
  (@tv, 4, 'legal', 'A4-L-01',
   'All permits and agreements operative; no outstanding conditions',
   'Legal confirmation that all documentary CPs delivered to Facility Agent. Registry project status confirmed as active.',
   1, 60),
  (@tv, 4, 'esg', 'A4-E-01',
   'Community engagement and benefit-sharing plan active',
   'CLO or community liaison mechanism operational. First community progress update delivered. FPIC compliance confirmed ongoing.',
   1, 70);

-- ==========================================================================
-- STAGE 5 — COMMISSIONING & PERFORMANCE CERTIFICATION (COD / First Issuance)
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  (@tv, 5, 'technical', 'A5-T-01',
   'First monitoring period completed; MRV data compiled for verification',
   'Full first monitoring period data set compiled per approved monitoring plan. Data quality checked and internal review completed. Verification body appointed for first verification.',
   1, 10),
  (@tv, 5, 'technical', 'A5-T-02',
   'First third-party verification completed by accredited VVB',
   'Annual third-party verification completed by accredited verifier (DNV, SGS, Bureau Veritas, or equivalent). Verification report accepted by registry.',
   1, 20),
  (@tv, 5, 'technical', 'A5-T-03',
   'First carbon credit issuance confirmed by registry',
   'Registry has issued first vintage of Verified Carbon Units (VCUs) or equivalent. Credit serial numbers recorded. Buffer pool contribution deducted and confirmed.',
   1, 30),
  (@tv, 5, 'commercial', 'A5-C-01',
   'First credit delivery to offtaker completed',
   'First tranche of issued credits transferred to buyer per forward purchase agreement. Payment received. Delivery confirmed in registry account.',
   1, 40),
  (@tv, 5, 'commercial', 'A5-C-02',
   'Ongoing verification and issuance schedule confirmed with registry and buyer',
   'Annual verification and issuance calendar agreed. VVB retained for multi-year verification programme. Buyer delivery schedule confirmed.',
   1, 50),
  (@tv, 5, 'finance', 'A5-F-01',
   'Financial close-out and first-year revenue reconciliation completed',
   'Actual vs. projected credit issuance reconciled. Revenue received vs. financial model compared. Any volume shortfall provisions triggered per offtake agreement documented.',
   1, 60),
  (@tv, 5, 'finance', 'A5-F-02',
   'DSCR at first covenant test date confirmed above threshold',
   'First quarterly DSCR calculation submitted to lender agent. Covenant compliance certificate issued. No covenant breach.',
   1, 70),
  (@tv, 5, 'legal', 'A5-L-01',
   'All operating permits and registry registrations confirmed in good standing',
   'NCCC registration active. NMDPRA/NUPRC reporting obligations met. All environmental permits renewed where required. No outstanding regulatory conditions.',
   1, 80),
  (@tv, 5, 'esg', 'A5-E-01',
   'First annual ESMP monitoring report completed (third-party verified for DFI projects)',
   'Annual environmental and social monitoring report completed. Third-party verification obtained if required by lenders. SDG co-benefit metrics reported.',
   1, 90),
  (@tv, 5, 'esg', 'A5-E-02',
   'CCBS verification completed (if applicable)',
   'For CCBS-certified projects: first CCBS audit completed and certification maintained. Co-benefit claims verified. Premium pricing confirmed in forward sales.',
   0, 100);
