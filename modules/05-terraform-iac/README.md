# Module 5 — Infrastructure as Code with Terraform

> **Theme:** Reproducibility. If your infrastructure can only be created by clicking in the AWS console, it cannot be reviewed, versioned, or recreated after a disaster. Terraform turns infrastructure into code — auditable, diffable, and deployable in any environment with a single command.

---

## What This Module Builds

By the end of this module you will have implemented **Milestone M5**:

- Terraform provisions SQS queue + DLQ and RDS PostgreSQL
- Remote state stored in S3 with DynamoDB locking
- Dev environment uses LocalStack (no real AWS account required)
- Prod environment config separated and documented
- `terraform plan` shows exactly what will change before you apply

---

## Chapters

| # | Title | What you learn |
|---|---|---|
| [5.1](./01-terraform-concepts.md) | Core Concepts | Provider, Resource, State, Plan, Apply — the mental model |
| [5.2](./02-state-management.md) | State Management | Remote state, S3 backend, DynamoDB locking, why state corruption is catastrophic |
| [5.3](./03-variables-outputs.md) | Variables, Outputs & Locals | Input variables, output values, locals, how to parameterise for environments |
| [5.4](./04-environment-separation.md) | Environment Separation | dev/prod workspaces vs directories, the tradeoffs |
| [5.5](./05-capstone-milestone.md) | Capstone Milestone M5 | Full apply against LocalStack, verification checklist |

---

## Key Principle

> Terraform's value is not just automation — it's the `plan`. The ability to see *exactly* what will change in your infrastructure before touching it is what makes infrastructure changes reviewable and safe.

---

*Start with [Chapter 5.1 →](./01-terraform-concepts.md)*
