import { MermaidDiagram } from "@/components/MermaidDiagram";
import { CodeBlock } from "@/components/CodeBlock";

const CONTEXT_DIAGRAM = `flowchart LR
  U[Client] -->|REST| API[order-api\\nSpring Boot]
  API -->|JPA| DB[(PostgreSQL)]
  API -->|Publish OrderCreatedEvent| Q[(SQS Queue\\nLocalStack in dev)]
  Q -->|Consume| WK[order-worker\\nSpring Boot]
  WK -->|Update status| DB
  API --> OBS[Logs / Metrics\\nActuator + Structured Logs]
  WK --> OBS`;

const SEQUENCE_DIAGRAM = `sequenceDiagram
  autonumber
  participant C as Client
  participant API as order-api
  participant DB as PostgreSQL
  participant Q as SQS Queue
  participant W as order-worker

  C->>API: POST /orders (Idempotency-Key: uuid)
  API->>DB: Check idempotency key (exists?)
  alt Key already exists
    API-->>C: 200 OK (original orderId)
  else New request
    API->>DB: INSERT Order(status=PENDING)
    API->>Q: Publish OrderCreatedEvent(correlationId)
    API-->>C: 202 Accepted + orderId + correlationId
  end

  W->>Q: Poll messages
  W->>DB: UPDATE Order(status=PROCESSING)
  W->>W: Step 1: inventory-check (mock)
  W->>W: Step 2: payment-authorization (mock)

  alt All steps succeed
    W->>DB: UPDATE Order(status=COMPLETED)
  else Transient failure
    W->>W: Retry with exponential backoff
  else Permanent failure
    W->>DB: UPDATE Order(status=FAILED)
    W->>Q: Send to DLQ
  end`;

const STATE_DIAGRAM = `stateDiagram-v2
  [*] --> PENDING : POST /orders accepted
  PENDING --> PROCESSING : worker picks up event
  PROCESSING --> COMPLETED : all steps succeed
  PROCESSING --> FAILED : permanent failure or max retries exceeded
  FAILED --> [*]
  COMPLETED --> [*]`;

const ACCEPTANCE_ITEMS = [
  {
    group: "M1 — Engineering for Production",
    items: [
      "POST /orders returns 202 Accepted with body { orderId, status, correlationId }",
      "GET /orders/{id} returns order data and current status",
      "Invalid payload returns 400 Bad Request",
      "POST /orders without Idempotency-Key returns 400",
      "Structured logs; /actuator/health returns UP",
      "No business logic in controller layer",
    ],
  },
  {
    group: "M2 — Containers & Runtime",
    items: [
      "docker build succeeds; multi-stage; image under 300MB",
      "docker-compose up starts all services",
      "Readiness probe passes within 30s; SIGTERM graceful shutdown",
      "JVM heap configured via -Xmx or JAVA_TOOL_OPTIONS",
    ],
  },
  {
    group: "M3 — Kubernetes/OpenShift",
    items: [
      "kubectl apply -f k8s/order-api and order-worker succeeds",
      "Pods Running; rolling update; HPA configured",
      "Secrets not hardcoded; ConfigMaps for config; rollout undo works",
    ],
  },
  {
    group: "M4 — AWS Essentials",
    items: [
      "order-api publishes OrderCreatedEvent to SQS",
      "order-worker consumes and updates PROCESSING then COMPLETED",
      "GET /orders/{id} returns COMPLETED after processing",
      "SQS URL via env; no AWS credentials in code",
    ],
  },
  {
    group: "M5 — Terraform IaC",
    items: [
      "terraform init/plan/apply succeed",
      "terraform output shows queue URL and DB endpoint",
      "Dev uses LocalStack; prod uses real AWS; remote state",
    ],
  },
  {
    group: "M6 — Resilience Patterns",
    items: [
      "Transient failure triggers retry (logs show attempt count)",
      "After max retries, message to DLQ; DLQ logged",
      "Circuit breaker OPEN on repeated failure",
      "Retry config in application.yml; order-api handles SQS publish failure",
    ],
  },
  {
    group: "M7 — Observability",
    items: [
      "Logs contain correlationId; api and worker share same correlationId",
      "/actuator/health/readiness and liveness and prometheus",
      "Custom metric orders.created.total; readiness in K8s manifests",
    ],
  },
  {
    group: "M8 — Senior Communication",
    items: [
      "All criteria above passing",
      "2-minute architecture explanation in English",
      "Answer why SQS over Kafka, idempotency, scaling, worker crash",
      "Architecture defense document complete",
    ],
  },
];

export function CapstonePage() {
  return (
    <div className="min-h-screen px-4 py-8">
      <div className="container mx-auto max-w-4xl">
        <h1 className="mb-2 text-2xl font-bold text-[hsl(var(--foreground))]">
          Capstone — Cloud-Native Order Processing Platform
        </h1>
        <p className="mb-8 text-[hsl(var(--muted-foreground))]">
          Single source of truth for the capstone. Every module contributes a
          deliverable toward this system.
        </p>

        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold text-[hsl(var(--foreground))]">
            System Description
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Two Spring Boot microservices: <strong>order-api</strong> accepts
            REST, validates, persists orders, publishes domain events to a
            queue. <strong>order-worker</strong> consumes events, runs processing
            steps, updates order state. Stack: Java 21, Spring Boot 3.x,
            PostgreSQL, SQS (LocalStack in dev), Docker, Kubernetes, Terraform,
            Actuator.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold text-[hsl(var(--foreground))]">
            Architecture
          </h2>
          <MermaidDiagram chart={CONTEXT_DIAGRAM} title="Context" />
          <MermaidDiagram chart={SEQUENCE_DIAGRAM} title="Request flow — POST /orders" />
          <MermaidDiagram chart={STATE_DIAGRAM} title="Order state machine" />
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold text-[hsl(var(--foreground))]">
            Acceptance Criteria
          </h2>
          <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
            Verify the capstone is complete. Every item must pass.
          </p>
          <div className="space-y-6">
            {ACCEPTANCE_ITEMS.map((g) => (
              <div
                key={g.group}
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
              >
                <h3 className="mb-3 font-medium text-sky-400">{g.group}</h3>
                <ul className="list-inside list-disc space-y-1 text-sm text-[hsl(var(--muted-foreground))]">
                  {g.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-lg font-semibold text-[hsl(var(--foreground))]">
            Sample curl
          </h2>
          <CodeBlock
            language="bash"
            code={`curl -X POST http://localhost:8080/orders \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "X-API-Key: dev-secret-key" \\
  -d '{"customerId":"cust-123","items":[{"sku":"PROD-001","qty":2}],"totalAmount":59.90}'`}
          />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-[hsl(var(--foreground))]">
            Expected log format
          </h2>
          <CodeBlock
            language="json"
            code={`{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "INFO",
  "service": "order-api",
  "correlationId": "req-a1b2c3d4",
  "message": "Order created successfully",
  "orderId": "a1b2c3d4-e5f6-7890"
}`}
          />
        </section>
      </div>
    </div>
  );
}
