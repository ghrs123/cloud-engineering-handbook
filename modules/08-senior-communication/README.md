# Module 8 — Senior Communication & Interview Readiness

> **Theme:** Technical competence is necessary but not sufficient for senior roles at international product companies. You must communicate architecture clearly, defend trade-offs under pressure, handle gaps honestly, and do all of this in English. This module prepares you for the technical interview and for the engineering conversations that happen after you're hired.

---

## What This Module Delivers — Milestone M8

By the end of this module, you will have:

- A practiced 2-minute architecture explanation of the complete capstone system (full and short versions)
- Scripted answers to the 12 most common questions about this architecture
- A framework for handling questions you don't know — without guessing or stopping
- Precise English vocabulary for production engineering concepts, including PT→EN false friends
- A structured self-assessment against the senior-level bar
- A complete automated + manual acceptance test that confirms everything works

---

## Prerequisites

- All previous modules complete (M1–M7)
- The complete capstone running locally: `docker compose up`, Kubernetes deployed, Terraform applied
- Capstone automation test from M7 passing

---

## Chapters

| Chapter | Topic |
|---------|-------|
| [8.1 — The Architecture Pitch](./01-architecture-pitch.md) | 2-minute script (full + short), structure, delivery practice |
| [8.2 — Defending Trade-offs](./02-defending-tradeoffs.md) | ADR thinking, SQS vs Kafka, PostgreSQL vs DynamoDB, REST vs WebSockets |
| [8.3 — The 12 Interview Questions](./03-twelve-interview-questions.md) | Full scripted answers + self-assessment checklist |
| [8.4 — Vocabulary & Language Precision](./04-vocabulary-precision.md) | SLO/SLA, idempotency/deduplication, PT→EN false friends |
| [8.5 — Self-Assessment & Final Capstone Test](./05-final-capstone-test.md) | Technical + operational + communication self-assessment + automated test script |

---

## Key Concepts Introduced

| Concept | Chapter |
|---------|---------|
| The 4-part architecture explanation structure | 8.1 |
| When to adapt the pitch (phone screen vs design interview) | 8.1 |
| ADR framework for trade-off answers | 8.2 |
| When Kafka wins vs SQS | 8.2 |
| When DynamoDB wins vs PostgreSQL | 8.2 |
| Transactional outbox pattern | 8.3 (Q9 follow-up) |
| SLO vs SLA vs SLI | 8.4 |
| At-least-once vs exactly-once vs at-most-once | 8.4 |
| Rolling update vs blue-green vs canary | 8.4 |
| PT→EN false friends in technical English | 8.4 |
| Automated acceptance test | 8.5 |
| Manual communication review | 8.5 |

---

*This is the final module. Return to [Course Index](../../COURSE_INDEX.md) or the [Capstone](../../capstone/README.md).*
