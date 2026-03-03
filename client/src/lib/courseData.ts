export type ModuleAccentColor =
  | "sky"
  | "cyan"
  | "blue"
  | "violet"
  | "orange";

export interface CodeExample {
  language: string;
  code: string;
  label?: string;
}

export interface Reference {
  title: string;
  url?: string;
}

export interface AntiPattern {
  title: string;
  description: string;
}

export interface ChapterDiagram {
  title: string;
  mermaid: string;
}

export type ExerciseDifficulty = "foundation" | "intermediate" | "advanced";

export interface Exercise {
  title: string;
  difficulty: ExerciseDifficulty;
  description: string;
  hint?: string;
  solution: string;
  solutionLanguage: string;
}

export interface Chapter {
  id: string;
  title: string;
  description: string;
  capstoneConnection: string;
  content: string;
  concepts: string[];
  codeExamples: CodeExample[];
  warnings: string[];
  references: Reference[];
  exercises: Exercise[];
  outcomes: string[];
  antiPatterns: AntiPattern[];
  diagrams: ChapterDiagram[];
  interviewMode: string;
}

export interface Module {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  accentColor: ModuleAccentColor;
  chapters: Chapter[];
}

function placeholderChapter(
  id: string,
  title: string,
  capstoneConnection: string
): Chapter {
  return {
    id,
    title,
    description: "",
    capstoneConnection,
    content: "",
    concepts: [],
    codeExamples: [],
    warnings: [],
    references: [],
    exercises: [],
    outcomes: [],
    antiPatterns: [],
    diagrams: [],
    interviewMode: "",
  };
}

export const modules: Module[] = [
  {
    id: 1,
    slug: "engineering-for-production",
    title: "Engineering for Production",
    subtitle: "Foundation",
    description:
      "Production-ready Spring Boot services: clean architecture, DTO/entity separation, exception and logging strategy, Actuator health.",
    accentColor: "sky",
    chapters: [
      {
        id: "1-1",
        title: "Clean Architecture in Spring Boot",
        description:
          "Layer model and dependency rule for the order-api package structure.",
        capstoneConnection:
          "The order-api package structure you define here is the one that every other module builds on.",
        content: `Most Spring Boot tutorials end at "it works." Production engineering starts with: who changes this code in 6 months without breaking something?

Clean architecture in a Spring Boot microservice means three practical rules:
1. **Each layer has one job.** Controllers handle HTTP. Services handle business logic. Repositories handle persistence.
2. **Dependencies flow inward.** The controller knows about the service. The service does not know about the controller.
3. **You can test each layer in isolation.** If you cannot unit test a service without spinning up a web server, the layers are wrong.

For order-api, four layers are sufficient: API (api/), Service (service/), Domain (domain/), Repository (repository/).`,
        concepts: [
          "API layer: @RestController, DTOs, @ExceptionHandler",
          "Service layer: @Service, business logic, @Transactional",
          "Domain layer: @Entity, enums, domain events",
          "Repository layer: JpaRepository interfaces",
        ],
        codeExamples: [
          {
            language: "java",
            label: "Controller depends on service",
            code: `@RestController
public class OrderController {
    private final OrderService orderService;

    @PostMapping("/orders")
    public ResponseEntity<CreateOrderResponse> createOrder(
            @RequestBody @Valid CreateOrderRequest request,
            @RequestHeader("Idempotency-Key") String idempotencyKey) {
        CreateOrderResponse response = orderService.createOrder(request, idempotencyKey);
        return ResponseEntity.accepted().body(response);
    }
}`,
          },
        ],
        warnings: [
          "Do not put business logic in controllers.",
          "Do not return JPA entities from controllers — use DTOs.",
          "Do not put @Transactional on controllers.",
        ],
        references: [{ title: "Chapter 1.2 — DTO vs Entity Separation" }],
        exercises: [
          {
            title: "Create order-api project structure",
            difficulty: "foundation",
            description:
              "Generate a Spring Boot project and create the package structure (api/, service/, domain/, repository/). Implement Order entity and OrderStatus enum.",
            solution: `public enum OrderStatus {
  PENDING, PROCESSING, COMPLETED, FAILED
}`,
            solutionLanguage: "java",
          },
        ],
        outcomes: [
          "Understand the four-layer model for order-api",
          "Apply the dependency rule in practice",
          "Avoid controller anti-patterns",
        ],
        antiPatterns: [
          {
            title: "Returning JPA entity from controller",
            description:
              "Jackson serializes the entire entity including lazy-loaded collections; internal fields get exposed.",
          },
          {
            title: "Business logic in controllers",
            description:
              "Cannot test or reuse without HTTP; transactions and orchestration belong in the service layer.",
          },
        ],
        diagrams: [],
        interviewMode:
          "I use four layers: API, Service, Domain, Repository. Dependencies point inward. I never return JPA entities from controllers; I map to response DTOs. For a focused microservice, this structure is enough.",
      },
      placeholderChapter(
        "1-2",
        "DTO vs Entity Separation",
        "Request/response DTOs keep the API contract stable and prevent entity leakage."
      ),
      placeholderChapter(
        "1-3",
        "Exception Handling Strategy",
        "Global exception handler returns consistent error payloads for the capstone API."
      ),
      placeholderChapter(
        "1-4",
        "Logging Strategy",
        "Structured logs and correlation IDs for order-api and worker."
      ),
      placeholderChapter(
        "1-5",
        "Spring Actuator & Health Endpoints",
        "Health and readiness endpoints for Kubernetes probes."
      ),
      placeholderChapter(
        "1-6",
        "Capstone Milestone M1",
        "Deliver order-api with layering, exception handling, structured logging, Actuator."
      ),
    ],
  },
  {
    id: 2,
    slug: "containers-runtime",
    title: "Containers & Runtime",
    subtitle: "Containers",
    description:
      "Docker deep dive: multi-stage Dockerfile, JVM in containers, graceful shutdown, health probes, docker-compose for local dev.",
    accentColor: "cyan",
    chapters: [
      placeholderChapter("2-1", "Multi-Stage Dockerfile", "Production image for order-api and order-worker."),
      placeholderChapter("2-2", "JVM in Containers", "Memory limits and JAVA_TOOL_OPTIONS for containers."),
      placeholderChapter("2-3", "Graceful Shutdown", "SIGTERM handling and in-flight request completion."),
      placeholderChapter("2-4", "Health Probes in Docker", "Readiness for docker-compose and K8s."),
      placeholderChapter("2-5", "Docker Compose for Local Dev", "postgres + localstack + order-api + order-worker."),
    ],
  },
  {
    id: 3,
    slug: "kubernetes-openshift",
    title: "Kubernetes/OpenShift for Backend Engineers",
    subtitle: "Orchestration",
    description:
      "Deployments, Services, ConfigMaps, Secrets, HPA, rolling updates, debugging with kubectl.",
    accentColor: "blue",
    chapters: [
      placeholderChapter("3-1", "Cluster Anatomy", "Control plane, nodes, pods — what backend engineers need."),
      placeholderChapter("3-2", "Deployments & Services", "Deployment YAML for order-api and order-worker."),
      placeholderChapter("3-3", "ConfigMaps & Secrets", "Externalized config and non-hardcoded secrets."),
      placeholderChapter("3-4", "Scaling & HPA", "Horizontal scaling based on CPU."),
      placeholderChapter("3-5", "Debugging with kubectl", "Logs, describe, exec for troubleshooting."),
      placeholderChapter("3-6", "Capstone Milestone M3", "K8s manifests, rolling deploy, HPA on kind/minikube."),
    ],
  },
  {
    id: 4,
    slug: "aws-essentials",
    title: "AWS Essentials for Spring Boot",
    subtitle: "Cloud",
    description:
      "SQS fundamentals, Spring Boot + SQS, building the order-worker, RDS patterns, IAM/IRSA.",
    accentColor: "violet",
    chapters: [
      placeholderChapter("4-1", "SQS Fundamentals", "Queues, visibility timeout, and at-least-once delivery."),
      placeholderChapter("4-2", "Spring Boot + SQS Integration", "Publishing OrderCreatedEvent from order-api."),
      placeholderChapter("4-3", "Building the order-worker", "Consumer that updates order status."),
      placeholderChapter("4-4", "RDS & Database Patterns", "PostgreSQL and failover awareness."),
      placeholderChapter("4-5", "IAM & IRSA", "No hardcoded credentials; IRSA for EKS."),
      placeholderChapter("4-6", "Capstone Milestone M4", "SQS integration, order-worker consuming and processing."),
    ],
  },
  {
    id: 5,
    slug: "terraform-iac",
    title: "Infrastructure as Code with Terraform",
    subtitle: "IaC",
    description:
      "Terraform concepts, state management, variables/outputs, environment separation for the capstone.",
    accentColor: "orange",
    chapters: [
      placeholderChapter("5-1", "Core Concepts", "Write .tf → plan → apply; desired vs actual state."),
      placeholderChapter("5-2", "State Management", "Remote state, locking, and safe collaboration."),
      placeholderChapter("5-3", "Variables, Outputs & Environment Separation", "dev/prod and queue URL outputs."),
      placeholderChapter("5-4", "Capstone Milestone M5", "Terraform provisions SQS + RDS, dev/prod env separation."),
    ],
  },
  {
    id: 6,
    slug: "resilience-patterns",
    title: "Resilience Patterns in Spring",
    subtitle: "Resilience",
    description:
      "Retry with exponential backoff, circuit breaker, timeout, bulkhead, DLQ patterns with Resilience4j.",
    accentColor: "sky",
    chapters: [
      placeholderChapter("6-1", "Retry with Exponential Backoff", "Transient failures and retry config."),
      placeholderChapter("6-2", "Circuit Breaker", "Downstream failure and OPEN state."),
      placeholderChapter("6-3", "Timeout, Bulkhead & DLQ Patterns", "Capstone retry/DLQ and Resilience4j config."),
    ],
  },
  {
    id: 7,
    slug: "observability",
    title: "Observability & Operability",
    subtitle: "Observability",
    description:
      "Three pillars, custom metrics with Micrometer, Prometheus & Actuator, health/readiness probes, production runbook.",
    accentColor: "cyan",
    chapters: [
      placeholderChapter("7-1", "The Three Pillars of Observability", "Logs, metrics, traces for the capstone."),
      placeholderChapter("7-2", "Custom Metrics with Micrometer", "orders.created.total and business metrics."),
      placeholderChapter("7-3", "Prometheus & Actuator", "Scraping and /actuator/prometheus."),
      placeholderChapter("7-4", "Health & Readiness Probes", "DB and SQS checks in readiness."),
      placeholderChapter("7-5", "Production Runbook & Milestone M7", "Structured logs, correlationId, readiness wired."),
    ],
  },
  {
    id: 8,
    slug: "senior-communication",
    title: "Senior Communication & Interview Readiness",
    subtitle: "Communication",
    description:
      "Architecture pitch, defending trade-offs, the 12 interview questions, vocabulary precision, final capstone test.",
    accentColor: "blue",
    chapters: [
      placeholderChapter("8-1", "The Architecture Pitch", "2-minute explanation of the full capstone system."),
      placeholderChapter("8-2", "Defending Trade-offs", "Why SQS over Kafka, idempotency, scaling decisions."),
      placeholderChapter("8-3", "The 12 Interview Questions", "Scripted answers for common senior questions."),
      placeholderChapter("8-4", "Vocabulary & Language Precision", "English technical vocabulary for interviews."),
      placeholderChapter("8-5", "Self-Assessment & Final Capstone Test", "Verification checklist and architecture defense."),
    ],
  },
];

export function getModuleById(id: number): Module | undefined {
  return modules.find((m) => m.id === id);
}

export function getChapter(moduleId: number, chapterId: string): Chapter | undefined {
  const mod = getModuleById(moduleId);
  return mod?.chapters.find((c) => c.id === chapterId);
}

export function getAllChapters(): { module: Module; chapter: Chapter }[] {
  const result: { module: Module; chapter: Chapter }[] = [];
  for (const module of modules) {
    for (const chapter of module.chapters) {
      result.push({ module, chapter });
    }
  }
  return result;
}
