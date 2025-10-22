export const pharmaAspects = [
    {
        id: 'pharma-fact-aseptic-2024',
        type: 'fact',
        content: 'Aseptic filling line F1 was requalified on 2024-03-18 after completing PQ-447.',
        source: 'PQ-447 Report'
    },
    {
        id: 'pharma-fact-em-excursions-apr',
        type: 'fact',
        content: 'Environmental monitoring recorded two Grade A excursions on 2024-04-05.',
        source: 'EM Trend April 2024'
    },
    {
        id: 'pharma-fact-batch-hold-0412',
        type: 'fact',
        content: 'Batch 24-0410 was placed on quality hold due to an endotoxin alert on 2024-04-12.',
        source: 'Deviation DV-552'
    },
    {
        id: 'pharma-fact-training-q1',
        type: 'fact',
        content: 'All sterile operators completed aseptic technique refresher training by 2024-03-15.',
        source: 'Training Records Q1 2024'
    },
    {
        id: 'pharma-rule-aseptic-training',
        type: 'rule',
        content: 'EU GMP Part I Chapter 2 requires annual aseptic technique training for operators.',
        source: 'EU GMP Part I'
    },
    {
        id: 'pharma-rule-annex-excursions',
        type: 'rule',
        content: 'EU GMP Annex 1 mandates that Grade A environmental excursions must be investigated within one business day.',
        source: 'EU GMP Annex 1'
    }
];

export const pharmaStatements = {
    validate: 'The aseptic filling line was successfully requalified in March 2024.',
    challenge: 'There were no Grade A cleanroom excursions in April 2024.',
    mixed: 'Aseptic operations in April 2024 had no quality holds and all operators were current on training.'
};

export const pharmaDocument = `
### Monthly Quality Summary (April 2024)

- Manufacturing reports that filling line F1 remained fully qualified after the March 2024 PQ run.
- QA communications state there were **no** Grade A environmental excursions throughout April 2024.
- Training records indicate all sterile operators completed their refresher training in Q1 2024.
- The deviation tracker lists batch 24-0410 on hold because of an endotoxin alert raised mid-April.
`.trim();

export const pharmaRulesText = `
- id: pharma-rule-aseptic-training | type: rule | content: EU GMP Part I Chapter 2 requires annual aseptic technique training for operators. | source: EU GMP Part I
- id: pharma-rule-annex-excursions | type: rule | content: EU GMP Annex 1 mandates that Grade A environmental excursions must be investigated within one business day. | source: EU GMP Annex 1
`.trim();

export const pharmaFactsText = `
- id: pharma-fact-aseptic-2024 | type: fact | content: Aseptic filling line F1 was requalified on 2024-03-18 after completing PQ-447. | source: PQ-447 Report
- id: pharma-fact-em-excursions-apr | type: fact | content: Environmental monitoring recorded two Grade A excursions on 2024-04-05. | source: EM Trend April 2024
- id: pharma-fact-batch-hold-0412 | type: fact | content: Batch 24-0410 was placed on quality hold due to an endotoxin alert on 2024-04-12. | source: Deviation DV-552
- id: pharma-fact-training-q1 | type: fact | content: All sterile operators completed aseptic technique refresher training by 2024-03-15. | source: Training Records Q1 2024
`.trim();

export const pharmaResourceMarkdown = `
## Pharma QA Snapshot

- id: pharma-fact-aseptic-2024 | type: fact | content: Aseptic filling line F1 was requalified on 2024-03-18 after completing PQ-447. | source: PQ-447 Report
- id: pharma-fact-em-excursions-apr | type: fact | content: Environmental monitoring recorded two Grade A excursions on 2024-04-05. | source: EM Trend April 2024
- id: pharma-fact-batch-hold-0412 | type: fact | content: Batch 24-0410 was placed on quality hold due to an endotoxin alert on 2024-04-12. | source: Deviation DV-552
- id: pharma-fact-training-q1 | type: fact | content: All sterile operators completed aseptic technique refresher training by 2024-03-15. | source: Training Records Q1 2024
- id: pharma-rule-aseptic-training | type: rule | content: EU GMP Part I Chapter 2 requires annual aseptic technique training for operators. | source: EU GMP Part I
- id: pharma-rule-annex-excursions | type: rule | content: EU GMP Annex 1 mandates that Grade A environmental excursions must be investigated within one business day. | source: EU GMP Annex 1
`.trim();
