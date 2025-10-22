# VeritasAI Knowledge Base Test Document

## Purpose
This artefact intentionally mixes verified facts, policy extracts, and questionable statements so you can exercise every VeritasAI skill (upload, validate, challenge, audit) without hunting for extra material.

## Change Control
- Version: 0.2.0 (testing build)
- Owner: QA Automation Team
- Last review: 2024-09-18
- Next scheduled review: 2025-01-10

---

## Confirmed Safeguards
These statements **should** be treated as supported evidence once ingested into the knowledge base.

- **IR-Plan-2024** – Incident response plans were updated on **2024-02-15** and redistributed to all teams within 48 hours.
- **Log-Retention** – Centralised log aggregation retains security events for **180 days** with daily automated reviews.
- **Backups-Schedule** – Production backups run **every four hours** and are retained for **90 days** in encrypted storage.
- **Region-Restriction** – All production workloads run exclusively in the **eu-west-1** region under the multi-region continuity plan.
- **Change-Window** – Emergency changes must be peer-reviewed and logged within **30 minutes** of completion.

> Use these entries to confirm the positive path in `validate-statement`, `validate-document`, and `audit-document`.

---

## Questionable or Contested Claims
These lines are intentionally ambiguous or inaccurate to provide material for `challenge-*` skills.

1. **Zero-Outages-May** – “No customer-impacting outages occurred in **May 2024**.”  
   _Reality: a SEV-2 incident on 2024-05-12 caused a partial outage for 47 minutes._
2. **Vendor-Training-Q2** – “Every vendor completed **security training** in Q2 2024.”  
   _Reality: 3 of 27 vendors slipped into the July catch-up cohort._
3. **Access-Review-Schedule** – “Access reviews happen **twice per year**.”  
   _Policy requires **quarterly** certification; this line helps spot mismatches._
4. **All-Regions-Patched** – “All regions finished the **June 2024** patch cycle.”  
   _Reality: the APAC DR region was patched on 2024-07-03._

---

## Policy Extracts (Rules)
- **Rule R1** – Access reviews must be completed **quarterly** for all privileged groups.
- **Rule R2** – Incident response materials must be **revalidated annually** and after every SEV-1 incident.
- **Rule R3** – Backups must achieve a **Recovery Point Objective ≤ 4 hours** and a **Recovery Time Objective ≤ 2 hours**.
- **Rule R4** – Third-party vendors must finish foundational security training **within 30 days** of onboarding.

---

## Evidence Log (Sample Table)

| ID                  | Source / Reference                 | Confidence | Notes                                                                          |
|--------------------|-------------------------------------|------------|--------------------------------------------------------------------------------|
| IR-Plan-2024       | Change Request CR-4821              | High       | Signed off by the CISO on 2024-02-15.                                          |
| Zero-Outages-May   | Incident Report IR-2024-0512        | Low        | Reported outage contradicts the claim of zero incidents.                       |
| Vendor-Training-Q2 | LMS Report `training-status-q2.csv` | Medium     | Three vendors still “In Progress” as of 2024-06-30.                            |
| Access-Review-Schedule | Audit Memo AR-2024-Q1          | Medium     | Policy explicitly states quarterly cadence; memo notes a lapse in Q3 2023.     |
| Region-Restriction | Deployment Diagram `prod-2024.vsdx` | High       | Shows only eu-west-1 resources in active use.                                  |

---

## Suggested Skill Test Flow

1. **upload-rules** – Provide this file path as the `file` argument to ingest the rules and facts.
2. **validate-statement** – Run: “Incident response plans were updated in 2024.” (should return supporting citations).
3. **challenge-statement** – Run: “No customer-impacting outages occurred in May 2024.” (should surface contradictions).
4. **audit-document / validate-document / challenge-document** – Feed the entire document to observe mixed verdicts in the generated markdown reports.
5. **upload-rules** (inline strings) – Copy the Policy Extracts section as `rules` input to test direct text ingestion without files.

---

## Notes for Testers
- The blend of confirmed and contested items is deliberate; it lets you observe both the supporting and contradicting branches of the strategy.
- Duplicate or tweak entries (ensure unique IDs) if you need more scenarios—especially helpful when validating knowledge-store merging logic.
- When testing negative cases repeatedly, clear or isolate the knowledge store so older entries do not skew the outcomes.

Happy testing!
