-- ==========================================================================
-- NNEL Finance-Ready Pipeline — Biofuels Template Seed
-- Migration: 006_seed_template_biofuels_v1.sql
-- Run AFTER 002_seed_template_v1.sql (Solar PV) is already seeded.
-- Creates template_version 'biofuels-1.0' and seeds all 6 stages.
-- ==========================================================================

USE nnel_frp;

-- --------------------------------------------------------------------------
-- Insert template version
-- --------------------------------------------------------------------------
INSERT INTO template_versions (version, technology, description, is_active, created_by)
VALUES ('biofuels-1.0', 'biofuels',
        'NNEL FRP Biofuels Template v1.0 — Cassava/Sugarcane Ethanol, Biomass, 2G Biofuels',
        1, 1);

SET @tv = (SELECT id FROM template_versions WHERE version = 'biofuels-1.0');

-- --------------------------------------------------------------------------
-- VDR FOLDER DEFINITIONS (same 10-folder structure as Solar PV)
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
-- STAGE 0 — OPPORTUNITY SCREENING (Horizon to Hopper)
-- Common + Biofuels-specific filters
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 0, 'technical', 'B0-T-01',
   'Technology readiness confirmed (TRL ≥ 6)',
   'Confirm the biofuel conversion technology has demonstrated commercial-scale operation. Reference plants operating 5+ years preferred. TRL 6 is the minimum for FRP entry.',
   1, 10),
  (@tv, 0, 'technical', 'B0-T-02',
   'Feedstock availability at project location assessed at high level',
   'Identify primary feedstock (cassava, sugarcane, biomass, etc.) and confirm indicative availability within 150 km radius. Note seasonal variation and competing uses.',
   1, 20),
  -- Commercial
  (@tv, 0, 'commercial', 'B0-C-01',
   'Product market demand and offtake potential identified',
   'Confirm market appetite for primary product (ethanol, biodiesel, SAF) and key co-products. Identify potential offtakers — petroleum marketers, blending mandate compliance buyers, industrial users.',
   1, 30),
  (@tv, 0, 'commercial', 'B0-C-02',
   'Key commercial risks flagged',
   'Document feedstock price volatility risk, product price exposure, currency risk, counterparty risk, and blending mandate compliance risk at screening level.',
   1, 40),
  -- Finance
  (@tv, 0, 'finance', 'B0-F-01',
   'Order-of-magnitude CAPEX estimate prepared (±50% acceptable)',
   'High-level cost range based on comparable biofuel plant benchmarks in West Africa. Basis and comparators must be stated. Minimum IRR threshold: 15%.',
   1, 50),
  (@tv, 0, 'finance', 'B0-F-02',
   'Development mandate or funding interest confirmed',
   'Internal mandate from NNEL Board or ED-CAM, or third-party co-developer interest confirmed in writing.',
   1, 60),
  -- Legal
  (@tv, 0, 'legal', 'B0-L-01',
   'Applicable regulatory framework identified',
   'Identify NMDPRA/NUPRC, PPPRA, NAFDAC, SON MANCAP/SONCAP, state environmental and land use approvals required. Note indicative permitting timeline.',
   1, 70),
  (@tv, 0, 'legal', 'B0-L-02',
   'Site access, land tenure, and water access status noted',
   'Confirm land ownership or acquisition route. Note water source and availability for process requirements. Flag known tenure disputes or community access complexity.',
   1, 80),
  -- ESG
  (@tv, 0, 'esg', 'B0-E-01',
   'Community and social risk at project location noted',
   'Identify proximity to communities, potential food security conflicts (if food-crop feedstock), and likely resettlement or livelihood impacts at screening level.',
   1, 90),
  (@tv, 0, 'esg', 'B0-E-02',
   'No fatal environmental or social flags identified',
   'Confirm no immediately disqualifying ESG issues: no protected area overlap, no scheduled cultural heritage sites, no active community opposition blocking access.',
   1, 100);

-- ==========================================================================
-- STAGE 1 — PRELIMINARY ASSESSMENT (Hopper to Funnel)
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 1, 'technical', 'B1-T-01',
   'Feedstock availability assessment completed — supply radius mapped',
   'Map cassava, sugarcane, biomass, or other feedstock supply within 150 km. Quantify annual tonnage available. Identify major suppliers and aggregators. Note competing demand.',
   1, 10),
  (@tv, 1, 'technical', 'B1-T-02',
   'Indicative process description, Block Diagram, PFD and mass/energy balance prepared',
   'Pre-FEED level process overview: feedstock-to-product conversion route, major unit operations, indicative mass and energy balance, utility requirements.',
   1, 20),
  (@tv, 1, 'technical', 'B1-T-03',
   'Preliminary plant sizing and indicative CAPEX benchmarking completed',
   'Capacity determination based on feedstock availability and market demand. Indicative CAPEX range (±50%) benchmarked against comparable West African plants.',
   1, 30),
  (@tv, 1, 'technical', 'B1-T-04',
   'Feedstock pricing sensitivity completed (±20% stress test)',
   'Model delivered feedstock cost at base, +20%, and -20% scenarios. Confirm project remains viable at +20% stress. Document price assumption basis.',
   1, 40),
  (@tv, 1, 'technical', 'B1-T-05',
   'Product, co-product, and by-product pricing sensitivity completed (±20%)',
   'Stress test on revenues from primary product and co/by-products at ±20%. Self-collection at plant battery limits vs. delivered pricing both modelled.',
   1, 50),
  -- Commercial
  (@tv, 1, 'commercial', 'B1-C-01',
   'Indicative offtake term sheet or letter of intent obtained for primary product',
   'Non-binding LOI or heads of terms from prospective offtaker. Product specification, price formula, and indicative volume confirmed.',
   1, 60),
  (@tv, 1, 'commercial', 'B1-C-02',
   'Preliminary commercial structure agreed',
   'Revenue model (domestic sale, export, blending mandate), ownership structure, and key commercial terms documented.',
   1, 70),
  -- Finance
  (@tv, 1, 'finance', 'B1-F-01',
   'Indicative financial model prepared (±30% cost estimate)',
   'Shows project returns (IRR, NPV, DSCR) on indicative basis. Financing mix assumed. IRR must exceed 15% minimum threshold at base case.',
   1, 80),
  (@tv, 1, 'finance', 'B1-F-02',
   'Indicative project returns assessed against NNEL investment criteria',
   'Equity IRR and project IRR vs. NNEL/NNPC hurdle rates (Biofuels: 15–22%). Sensitivity on feedstock cost and product price run.',
   1, 90),
  -- Legal
  (@tv, 1, 'legal', 'B1-L-01',
   'Project company / SPV structure proposed',
   'Ownership structure, shareholding, and corporate domicile proposed. NNEL equity position confirmed. NNPC group synergies and NNPC subsidiary offtake identified.',
   1, 100),
  (@tv, 1, 'legal', 'B1-L-02',
   'Regulatory mapping matrix completed',
   'All required licences and permits listed: NMDPRA, PPPRA, NAFDAC, SON MANCAP/SONCAP, state environmental permit, FIRS, NCDMB. Responsible MDAs, timelines, and fees noted.',
   1, 110),
  -- ESG
  (@tv, 1, 'esg', 'B1-E-01',
   'Land suitability and ESIA scoping report completed',
   'Soil type, water access, drainage, proximity to communities, and preliminary environmental sensitivities assessed. ESIA scope and budget confirmed.',
   1, 120),
  (@tv, 1, 'esg', 'B1-E-02',
   'Stakeholder map and initial community engagement plan prepared',
   'Key stakeholders identified (communities, farmers, state government, traditional rulers). Initial engagement approach documented. Social licence risk assessed.',
   1, 130),
  -- Risk
  (@tv, 1, 'technical', 'B1-R-01',
   'Risk register prepared (minimum 15 risks across all categories)',
   'Technical, commercial, regulatory, ESG, feedstock supply, and execution risks documented with probability, impact, and initial mitigation strategy.',
   1, 140);

-- ==========================================================================
-- STAGE 2 — FULL FEASIBILITY & DUE DILIGENCE (Funnel to Project)
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  -- Technical
  (@tv, 2, 'technical', 'B2-T-01',
   'Bankable FEED study completed',
   'Mass and energy balance, energy integration, utilities requirements, site layout, plantation design, key process unit design, equipment sizing and costing to ±15% accuracy.',
   1, 10),
  (@tv, 2, 'technical', 'B2-T-02',
   'Feedstock supply chain due diligence completed',
   'Contracted volume, pricing formula, quality specifications, supplier creditworthiness, logistics plan, and storage strategy assessed. Minimum 70% contracted volume requirement confirmed.',
   1, 20),
  (@tv, 2, 'technical', 'B2-T-03',
   'Technology vendor assessment completed',
   'Process licensor evaluated against ≥3 reference plants operating 5+ years. OEM assessments completed. Performance guarantees, warranty terms, and process licence scope confirmed.',
   1, 30),
  (@tv, 2, 'technical', 'B2-T-04',
   'Water and waste management plan prepared (IFC PS 3 compliance)',
   'Water source, volume, and quality requirements confirmed. Wastewater treatment design and effluent standards confirmed. Solid waste disposal plan documented.',
   1, 40),
  (@tv, 2, 'technical', 'B2-T-05',
   'O&M strategy and staffing plan prepared',
   'Operational staffing plan, maintenance schedule, spare parts inventory, and performance KPIs defined. NCDMB local content compliance (minimum 40%) confirmed.',
   1, 50),
  -- Commercial
  (@tv, 2, 'commercial', 'B2-C-01',
   'Offtake agreement: heads of terms or draft SPA/PLA executed for primary product',
   'Binding or substantially-agreed HoT with price formula, volume, product quality specifications, and tenor confirmed. Co-product and by-product offtake arrangements documented.',
   1, 60),
  (@tv, 2, 'commercial', 'B2-C-02',
   'Product market study completed',
   'Ethanol/biodiesel/SAF specifications and blending mandate compliance confirmed. Export pathway analysis if applicable. Off-taker due diligence (creditworthiness, regulatory compliance) completed.',
   1, 70),
  (@tv, 2, 'commercial', 'B2-C-03',
   'NNPC group synergies identified and confirmed',
   'Offtake from NNPC subsidiaries (CAS, NGPIS, etc.) as anchor offtaker evaluated. Revenue contribution from group synergies modelled.',
   1, 80),
  (@tv, 2, 'commercial', 'B2-C-04',
   'Insurance programme designed',
   'Construction all-risks (CAR), delay in start-up (DSU), operational all-risk (OAR), third-party liability (TPL), and business interruption cover designed. A-rated insurer or London Market reinsurance backing confirmed.',
   1, 90),
  -- Finance
  (@tv, 2, 'finance', 'B2-F-01',
   'Bankable financial model completed (±10% CAPEX, FAST standard)',
   'Full project finance model: base case, sensitivities, stress scenarios. DSCR >1.25x and LLCR confirmed. 15% CAPEX contingency for process plants; 20% for greenfield facilities.',
   1, 100),
  (@tv, 2, 'finance', 'B2-F-02',
   'Working capital facility sized and strategy confirmed',
   'Dedicated working capital facility sized at minimum 3 months of OPEX. Feedstock price hedging strategy documented. Seasonal cash flow modelled.',
   1, 110),
  (@tv, 2, 'finance', 'B2-F-03',
   'Financial close strategy and lender shortlist agreed',
   'Debt/equity ratio, tenor, security package, and DFI/commercial bank targets confirmed. Blended finance structuring (if applicable) modelled.',
   1, 120),
  -- Legal
  (@tv, 2, 'legal', 'B2-L-01',
   'Full ESIA completed per IFC Performance Standard 1',
   'ESIA prepared by qualified consultant. Community consultation conducted. ESMP prepared. Resettlement Action Plan (RAP) completed if >200 PAPs.',
   1, 130),
  (@tv, 2, 'legal', 'B2-L-02',
   'Regulatory licences applied for: NMDPRA, PPPRA, NAFDAC, SON, state EPA',
   'All permit applications filed. Application receipts and processing timelines documented. No fatal regulatory objections outstanding.',
   1, 140),
  (@tv, 2, 'legal', 'B2-L-03',
   'Land acquisition and title confirmation completed',
   'Independent legal opinion on land tenure. Acquisition plan (if required) confirmed. Community benefit agreement executed.',
   1, 150),
  (@tv, 2, 'legal', 'B2-L-04',
   'Corporate structure and tax structuring completed',
   'SPV incorporated. Shareholder agreement drafted. Pioneer status application filed. VAT, WHT, and duty waiver strategy confirmed.',
   1, 160),
  -- ESG
  (@tv, 2, 'esg', 'B2-E-01',
   'Full ESIA disclosed per IFC requirements',
   'ESIA disclosed in communities and on project website for minimum 60-day public consultation period. All material objections addressed and documented.',
   1, 170),
  (@tv, 2, 'esg', 'B2-E-02',
   'IFC Performance Standards 1–8 compliance checklist completed',
   'Compliance with IFC PS 1 (Assessment), PS 2 (Labour), PS 3 (Resource Efficiency), PS 5 (Land Acquisition), PS 6 (Biodiversity), PS 8 (Cultural Heritage) confirmed or gaps documented with mitigation plan.',
   1, 180);

-- ==========================================================================
-- STAGE 3 — FINANCING PREPARATION & LENDER ENGAGEMENT
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  (@tv, 3, 'technical', 'B3-T-01',
   'Lender''s Independent Engineer (IE) report received and accepted',
   'IE technical due diligence report confirms FEED study, feedstock supply chain, technology selection, CAPEX estimate, and mass/energy balance. IE appointed by lenders.',
   1, 10),
  (@tv, 3, 'technical', 'B3-T-02',
   'Construction programme and EPC/EPCIC contract finalised',
   'Final EPC or EPCIC contract executed. Construction schedule, milestones, performance tests, and liquidated damages agreed.',
   1, 20),
  (@tv, 3, 'commercial', 'B3-C-01',
   'All commercial agreements executed',
   'Primary product SPA/PLA, co-product offtake, feedstock supply agreements, EPC contract, O&M agreement, and land lease/access agreements all signed.',
   1, 30),
  (@tv, 3, 'commercial', 'B3-C-02',
   'Conditions Precedent (CP) register finalised and baseline set',
   'All First Draw CPs listed with ownership assigned and baseline evidence confirmed. No CP outstanding without a formal waiver.',
   1, 40),
  (@tv, 3, 'finance', 'B3-F-01',
   'All finance agreements executed',
   'Term loan facility agreement, equity subscription agreement, security package, intercreditor documents, and working capital facility all signed.',
   1, 50),
  (@tv, 3, 'finance', 'B3-F-02',
   'Security package in place',
   'Charges, step-in rights, direct agreements, assignment of contracts, and project accounts (including DSRA and working capital reserve) all established.',
   1, 60),
  (@tv, 3, 'finance', 'B3-F-03',
   'Lender''s financial model agreed and baselined',
   'Lender base-case model reviewed, agreed, and baselined with all parties. DSCR/LLCR confirmed. Working capital facility drawdown conditions agreed.',
   1, 70),
  (@tv, 3, 'legal', 'B3-L-01',
   'All permits in place: NMDPRA, PPPRA, NAFDAC, SON MANCAP/SONCAP, state EPA',
   'All operating and construction permits received and effective. No outstanding regulatory conditions that would prevent construction commencement.',
   1, 80),
  (@tv, 3, 'legal', 'B3-L-02',
   'NCDMB Nigerian Content Plan approved',
   'Nigerian Content Plan submitted and approved by NCDMB. Minimum 40% Nigerian content target confirmed across construction and operations.',
   1, 90),
  (@tv, 3, 'esg', 'B3-E-01',
   'ESMP disclosed and SEP implemented per IFC requirements',
   'ESMP publicly disclosed. Stakeholder Engagement Plan active. Community benefit agreement and CLO appointment confirmed.',
   1, 100);

-- ==========================================================================
-- STAGE 4 — FINANCIAL CLOSE & CONSTRUCTION READINESS
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  (@tv, 4, 'technical', 'B4-T-01',
   'EPC/EPCIC contractor mobilised; construction commenced',
   'Evidence of contractor mobilisation: site establishment, equipment on-site, construction log initiated, Owner''s Engineer (construction supervisor) appointed.',
   1, 10),
  (@tv, 4, 'technical', 'B4-T-02',
   'Construction risk management plan and HSE plan active',
   'CRMP and HSE Implementation Plan reviewed, approved, and being implemented. Community Liaison Officer (CLO) on-site.',
   1, 20),
  (@tv, 4, 'commercial', 'B4-C-01',
   'All First Draw Conditions Precedent verified as satisfied',
   'CP register reviewed item-by-item. Each CP marked closed with documentary evidence on file. No open or waived CPs without Board approval.',
   1, 30),
  (@tv, 4, 'commercial', 'B4-C-02',
   'Drawdown notice delivered and confirmed by Facility Agent',
   'Utilisation/drawdown notice submitted within notice period. Agent has confirmed receipt and compliance.',
   1, 40),
  (@tv, 4, 'finance', 'B4-F-01',
   'Finance team confirmation: all CPs for first draw are closed',
   'Finance sign-off memo confirming CP register is complete. Working capital facility operative and drawdown conditions satisfied.',
   1, 50),
  (@tv, 4, 'finance', 'B4-F-02',
   'Project accounts funded to required reserve levels',
   'DSRA, working capital reserve, and any other reserve accounts funded per finance agreement requirements.',
   1, 60),
  (@tv, 4, 'legal', 'B4-L-01',
   'CP register updated: all First Draw CPs closed with documentary evidence',
   'Legal confirmation that all documentary CPs have been delivered to Facility Agent (originals or certified copies).',
   1, 70),
  (@tv, 4, 'esg', 'B4-E-01',
   'Construction ESMP implementation confirmed; first progress report submitted',
   'ESMP being implemented on site. First construction environmental and social monitoring report submitted to lenders.',
   1, 80);

-- ==========================================================================
-- STAGE 5 — COMMISSIONING & PERFORMANCE CERTIFICATION (COD)
-- ==========================================================================
INSERT INTO template_checklist_items
  (template_version_id, stage_number, pillar, item_code, description, guidance, is_mandatory, sort_order)
VALUES
  (@tv, 5, 'technical', 'B5-T-01',
   'Commissioning test programme completed; results documented',
   'All required performance and acceptance tests run per EPC contract. 72-hour availability test completed. Test reports reviewed by IE. Punch list Category A items cleared.',
   1, 10),
  (@tv, 5, 'technical', 'B5-T-02',
   'Product quality certification obtained (SON MANCAP, NAFDAC where applicable)',
   'Product samples tested against specification. SON MANCAP and NAFDAC certification obtained for food-grade co-products. Export certification if applicable.',
   1, 20),
  (@tv, 5, 'technical', 'B5-T-03',
   'Provisional Acceptance Certificate (PAC) issued by employer',
   'PAC signed confirming plant meets performance thresholds. Punch list items below commercial operation threshold. Defects liability period (DLP) commenced.',
   1, 30),
  (@tv, 5, 'technical', 'B5-T-04',
   'O&M team trained and handed over; start-up, shutdown, troubleshooting SOPs completed',
   'Owner''s O&M team hands-on training completed by process licensor/EPC contractor. SOPs for start-up, shutdown, troubleshooting, QA/QC, and emergency response documented and signed off.',
   1, 40),
  (@tv, 5, 'commercial', 'B5-C-01',
   'Commercial Operations Date (COD) declared; first product delivery confirmed',
   'COD notice issued to offtaker. First product batch delivered and revenue receipt confirmed. Quality certificate for first batch on file.',
   1, 50),
  (@tv, 5, 'commercial', 'B5-C-02',
   'O&M agreement transitioned to operational phase',
   'O&M contractor on-site, operational procedures in effect, production log commenced, KPI monitoring active.',
   1, 60),
  (@tv, 5, 'finance', 'B5-F-01',
   'Financial close-out accounts prepared; cost-to-complete reconciled',
   'Final construction cost reconciliation vs. approved budget. Cost overrun/underrun documented. Working capital facility drawdown reconciled.',
   1, 70),
  (@tv, 5, 'finance', 'B5-F-02',
   'Completion tests and technical ratios confirmed to lenders',
   'IE completion certificate received. Capacity, yield, and product quality ratios confirmed. DSCR at first quarterly test confirmed above covenant threshold.',
   1, 80),
  (@tv, 5, 'legal', 'B5-L-01',
   'All operating permits in place and effective',
   'NMDPRA, PPPRA, NAFDAC, SON, state EPA, and all other operating permits confirmed effective. No outstanding conditions.',
   1, 90),
  (@tv, 5, 'esg', 'B5-E-01',
   'Post-COD ESMP monitoring commenced; first annual report scheduled',
   'Ongoing environmental and social monitoring per ESMP commenced. First annual third-party verified ESMP report scheduled within 12 months of COD.',
   1, 100);
