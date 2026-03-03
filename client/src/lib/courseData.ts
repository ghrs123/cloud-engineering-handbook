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
  explanation?: string;
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
      {
        id: "1-2",
        title: "DTO vs Entity Separation",
        description: "Request and response DTOs keep the API contract stable and prevent entity leakage.",
        capstoneConnection:
          "Every request and response in order-api uses dedicated DTOs. The Order entity never leaves the service layer.",
        content: `When you are building a small service and the response looks exactly like the entity, mapping feels like ceremony. Three production reasons to use DTOs:

1. Your entity will diverge from your API contract — audit fields, internal tracking, lazy-loaded relationships become accidental API fields.
2. JPA entities are not safe to serialize outside a transaction — LazyInitializationException when Jackson serializes after the transaction closes.
3. Your API contract should change independently of your schema. DTOs are the decoupling boundary.

For order-api you need: Request DTOs (CreateOrderRequest), Response DTOs (CreateOrderResponse, OrderResponse, ErrorResponse), and in Module 4 internal/messaging DTOs (OrderCreatedEvent). Use Java records + Bean Validation for requests. Use static factory methods on response DTOs for mapping. Recommendation: static factory on the DTO; avoid MapStruct at this scale.`,
        concepts: [
          "CreateOrderRequest, OrderItemRequest with validation",
          "CreateOrderResponse, OrderResponse with static factory from(Order)",
          "ErrorResponse for all error responses",
          "Mapping in DTO vs service; do not use Optional in controller",
        ],
        codeExamples: [
          {
            language: "java",
            label: "CreateOrderRequest",
            code: `public record CreateOrderRequest(
    @NotBlank(message = "customerId is required") String customerId,
    @NotEmpty(message = "items cannot be empty") @Valid List<OrderItemRequest> items,
    @NotNull @Positive @Digits(integer = 10, fraction = 2) BigDecimal totalAmount
) {}`,
            explanation: "Immutable record with Bean Validation; works with @Valid on nested objects.",
          },
          {
            language: "java",
            label: "CreateOrderResponse with static factory",
            code: `public record CreateOrderResponse(UUID orderId, String status, String correlationId) {
    public static CreateOrderResponse from(Order order, String correlationId) {
        return new CreateOrderResponse(order.getId(), order.getStatus().name(), correlationId);
    }
}`,
            explanation: "Mapping lives on the DTO; service stays clean.",
          },
          {
            language: "java",
            label: "Wrong vs correct controller return",
            code: `// Wrong: Optional in controller
@GetMapping("/orders/{id}")
public Optional<OrderResponse> getOrder(@PathVariable UUID id) {
    return orderRepository.findById(id).map(OrderResponse::from);
}
// Correct: resolve in service, throw domain exception
@GetMapping("/orders/{id}")
public ResponseEntity<OrderResponse> getOrder(@PathVariable UUID id) {
    OrderResponse response = orderService.getOrder(id);
    return ResponseEntity.ok(response);
}`,
            explanation: "Controllers return ResponseEntity; resolve Optional in service and use @ExceptionHandler for 404.",
          },
        ],
        warnings: [
          "Using @JsonIgnore on entity fields is a symptom; the fix is a response DTO.",
          "One DTO for all operations leads to confusion; use distinct types per operation.",
        ],
        references: [{ title: "Chapter 1.3 — Exception Handling Strategy" }],
        exercises: [
          {
            title: "Implement full DTO layer for order-api",
            difficulty: "foundation",
            description:
              "Implement CreateOrderRequest with validation, CreateOrderResponse and OrderResponse with static factory. Write a unit test that verifies OrderResponse.from(order) maps all fields (no Spring context).",
            solution: `@Test
void from_shouldMapAllFields() {
    Order order = Order.create("cust-123", List.of(new OrderItem("SKU-001", 2)), new BigDecimal("99.90"));
    OrderResponse response = OrderResponse.from(order);
    assertThat(response.customerId()).isEqualTo("cust-123");
    assertThat(response.status()).isEqualTo("PENDING");
    assertThat(response.items()).hasSize(1);
    assertThat(response.orderId()).isNotNull();
}`,
            solutionLanguage: "java",
          },
        ],
        outcomes: [
          "Use separate request/response DTOs; never return JPA entities from controllers.",
          "Apply static factory on DTO for mapping; keep service lean.",
          "Avoid Optional and @JsonIgnore as band-aids.",
        ],
        antiPatterns: [
          { title: "Returning Optional from controller", description: "Resolve in service; return ResponseEntity and map exceptions via @ExceptionHandler." },
          { title: "Using @JsonIgnore on entity", description: "Symptom of serialization boundary problem; fix with a response DTO." },
          { title: "One DTO for all operations", description: "Leads to nullable fields and confusion; use distinct types per operation." },
        ],
        diagrams: [],
        interviewMode:
          "There are three reasons I always use separate response DTOs. First, JPA entities have lazy-loaded relationships — Jackson can throw LazyInitializationException after the transaction closes. Second, entities grow internal fields that become accidental API fields. Third, API contract and schema should evolve independently. I keep mapping minimal with static factory methods on the DTO.",
      },
      {
        id: "1-3",
        title: "Exception Handling Strategy",
        description: "One ErrorResponse structure; global handler maps exceptions to HTTP status.",
        capstoneConnection:
          "Every error from order-api returns a consistent ErrorResponse structure. No stack traces in responses.",
        content: `Bad exception handling causes client problems (different error shapes per endpoint) and security problems (stack traces leak version and structure). Define one ErrorResponse: code (machine-readable), message, correlationId, timestamp, errors list for validation. Use domain exceptions (OrderNotFoundException, DuplicateOrderException, InvalidOrderStateException) thrown from service and caught by one @ControllerAdvice. Map validation (MethodArgumentNotValidException) to 400 with VALIDATION_ERROR; MissingRequestHeaderException to 400 MISSING_HEADER; catch-all logs full exception but returns generic INTERNAL_ERROR to client. Use 422 for invalid state transitions (semantically wrong, not syntactically).`,
        concepts: [
          "ErrorResponse record with code, message, correlationId, errors",
          "Domain exceptions + GlobalExceptionHandler",
          "Log level: WARN for expected (404, validation), ERROR for unexpected",
        ],
        codeExamples: [
          {
            language: "java",
            label: "ErrorResponse",
            code: `public record ErrorResponse(String code, String message, String correlationId, Instant timestamp, List<FieldError> errors) {
    public record FieldError(String field, String message) {}
    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message, MDC.get("correlationId"), Instant.now(), List.of());
    }
}`,
          },
          {
            language: "java",
            label: "Catch-all — never expose internals",
            code: `@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
    log.error("Unexpected error: correlationId={}", MDC.get("correlationId"), ex);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ErrorResponse.of("INTERNAL_ERROR", "An unexpected error occurred. Use correlationId to trace."));
}`,
            explanation: "Log full exception internally; never return stack trace to client.",
          },
        ],
        warnings: [
          "Do not use ResponseStatusException everywhere — you lose the structured ErrorResponse.",
          "Do not log 404s at ERROR level; use WARN or DEBUG.",
        ],
        references: [{ title: "Chapter 1.4 — Logging Strategy" }],
        exercises: [
          {
            title: "Implement exception handling and WebMvcTest",
            difficulty: "intermediate",
            description:
              "Implement ErrorResponse, OrderNotFoundException, GlobalExceptionHandler. Add handler for HttpRequestMethodNotAllowedException (405). Write @WebMvcTest that POST /orders with empty body returns 400 with code INVALID_REQUEST_BODY.",
            solution: `mockMvc.perform(post("/orders").header("Idempotency-Key", UUID.randomUUID().toString())
    .contentType(MediaType.APPLICATION_JSON).content(""))
    .andExpect(status().isBadRequest())
    .andExpect(jsonPath("$.code").value("INVALID_REQUEST_BODY"))
    .andExpect(jsonPath("$.correlationId").exists());`,
            solutionLanguage: "java",
          },
        ],
        outcomes: [
          "One ErrorResponse structure for all errors; correlationId in every response.",
          "Domain exceptions from service; global handler maps to HTTP.",
          "Catch-all logs internally, never exposes stack trace.",
        ],
        antiPatterns: [
          { title: "ResponseStatusException everywhere", description: "Loses structured error contract; use domain exceptions + global handler." },
          { title: "Logging 404 at ERROR", description: "404 is normal client outcome; use WARN or DEBUG." },
        ],
        diagrams: [],
        interviewMode:
          "I use a global @ControllerAdvice with @ExceptionHandler methods — one handler per exception type, all returning the same ErrorResponse with code, message, and correlationId. Domain exceptions are thrown from the service and never caught in controllers. The catch-all logs the full exception but never exposes stack traces to the client. I use WARN for 404s and validation, ERROR for unexpected failures.",
      },
      {
        id: "1-4",
        title: "Logging Strategy",
        description: "Structured JSON logs and correlationId in every log line.",
        capstoneConnection:
          "Every log line from order-api carries a correlationId. When order-worker processes the same order in Module 4, it will carry the same ID — entire order lifecycle traceable with one grep.",
        content: `Logs serve one purpose: helping an on-call engineer understand what happened and why. Use ERROR for unexpected failures, WARN for expected failures (not found, retry), INFO for significant business events, DEBUG only for diagnostics (disabled in prod). Structured JSON logs allow aggregation systems to filter and query; include timestamp, level, service, correlationId, message. Implement CorrelationIdFilter: read X-Correlation-Id header or generate one, put in MDC, echo in response, clear in finally. Log business events in service layer (order created, order not found); do not log in controller. MDC is thread-local — when using @Async or CompletableFuture, capture and restore correlationId in the new thread.`,
        concepts: [
          "Structured JSON (logstash-logback-encoder); MDC for correlationId",
          "CorrelationIdFilter: HIGHEST_PRECEDENCE, clear MDC in finally",
          "Log levels: INFO business events, WARN expected failures, ERROR unexpected",
        ],
        codeExamples: [
          {
            language: "java",
            label: "CorrelationIdFilter",
            code: `MDC.put(MDC_KEY, correlationId);
response.setHeader(CORRELATION_ID_HEADER, correlationId);
try {
    chain.doFilter(req, res);
} finally {
    MDC.remove(MDC_KEY);  // CRITICAL: threads are reused
}`,
            explanation: "Set before chain; clear in finally so next request on same thread does not get stale ID.",
          },
          {
            language: "java",
            label: "Service — business events only",
            code: `log.info("Order created: orderId={} customerId={} totalAmount={}", order.getId(), order.getCustomerId(), order.getTotalAmount());
MDC.put("orderId", order.getId().toString());`,
          },
        ],
        warnings: [
          "Log the Throwable as last argument for stack trace: log.error(\"msg\", ex), not ex.getMessage().",
          "Do not log at INFO in a tight loop (e.g. per message); use metrics.",
        ],
        references: [{ title: "Chapter 1.5 — Spring Actuator & Health Endpoints" }],
        exercises: [
          {
            title: "Structured logging and CorrelationIdFilter test",
            difficulty: "foundation",
            description:
              "Add logstash-logback-encoder, logback-spring.xml (JSON for non-dev), CorrelationIdFilter. Write test that X-Correlation-Id header is returned and that client-provided ID is echoed back.",
            solution: `assertThat(response.getHeaders().getFirst("X-Correlation-Id")).isNotNull().startsWith("req-");
// With header set: assertThat(header).isEqualTo("my-custom-id-123");`,
            solutionLanguage: "java",
          },
        ],
        outcomes: [
          "Structured JSON logs with correlationId in every line.",
          "CorrelationIdFilter sets MDC and response header; clear in finally.",
          "Propagate correlationId to async contexts (Module 4 worker).",
        ],
        antiPatterns: [
          { title: "Logging only ex.getMessage() at ERROR", description: "You lose the stack trace; pass the Throwable as last argument." },
          { title: "Logging PII or credentials", description: "Never log customer personal data or API keys." },
        ],
        diagrams: [],
        interviewMode:
          "I use structured JSON logging so aggregation systems can filter on fields. A servlet filter sets or generates correlationId, puts it in MDC, and echoes it in the response. Every log line in that request thread includes it. When publishing to SQS I add correlationId as a message attribute; the consumer restores it to MDC. So I can trace one order across both services with one grep. INFO for business events, WARN for expected failures, ERROR for unexpected; never log PII or credentials.",
      },
      {
        id: "1-5",
        title: "Spring Actuator & Health Endpoints",
        description: "Readiness vs liveness; separate health groups for Kubernetes probes.",
        capstoneConnection:
          "Kubernetes manifests in Module 3 will configure readinessProbe and livenessProbe to Actuator endpoints. If not configured now, deployment will fail or route to unhealthy instances.",
        content: `Kubernetes needs two answers: Should this Pod receive traffic? (readiness — if non-200, remove from load balancer.) Should this Pod be restarted? (liveness — if non-200 repeatedly, kill and restart.) Do not put DB connectivity in liveness — if DB goes down, Kubernetes would restart all Pods (restart storm). Readiness should check DB and queue; liveness only ping (JVM responsive). Spring Boot 2.3+: management.endpoint.health.probes.enabled=true gives /actuator/health/readiness and /actuator/health/liveness. Use health groups: readiness include db,sqs; liveness include ping. Add custom SqsHealthIndicator; disable in dev. Use management server port 8081 so Actuator is not on the same port as the app. Configure server.shutdown=graceful and timeout-per-shutdown-phase so in-flight requests complete before exit.`,
        concepts: [
          "Readiness: ready to serve? Check DB, queue. Liveness: JVM alive? Ping only.",
          "probes.enabled and health groups (readiness: db,sqs; liveness: ping)",
          "Graceful shutdown + preStop hook; management port 8081",
        ],
        codeExamples: [
          {
            language: "yaml",
            label: "application.yml — probes and groups",
            code: `management:
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: db, sqs
        liveness:
          include: ping
  server:
    port: 8081`,
          },
          {
            language: "java",
            label: "SqsHealthIndicator",
            code: `@Component("sqs")
public class SqsHealthIndicator implements HealthIndicator {
    @Override
    public Health health() {
        try {
            sqsClient.getQueueAttributes(GetQueueAttributesRequest.builder().queueUrl(queueUrl).build());
            return Health.up().withDetail("queue", queueUrl).build();
        } catch (Exception ex) {
            return Health.down().withDetail("queue", queueUrl).withException(ex).build();
        }
    }
}`,
            explanation: "Lightweight reachability check; consider caching for high-frequency probes.",
          },
        ],
        warnings: [
          "Do not check DB in liveness — causes restart storm when DB is down.",
          "Secure Actuator: use management port or restrict; /actuator/env can expose credentials.",
        ],
        references: [{ title: "Chapter 1.6 — Capstone Milestone M1" }],
        exercises: [
          {
            title: "Configure Actuator and test probes",
            difficulty: "foundation",
            description:
              "Configure management port 8081, readiness + liveness, Prometheus. Implement SqsHealthIndicator (mock OK). Configure server.shutdown=graceful 30s. Test that /actuator/health/readiness and /actuator/health/liveness return 200.",
            solution: `ResponseEntity<String> r = restTemplate.getForEntity("http://localhost:" + managementPort + "/actuator/health/readiness", String.class);
assertThat(r.getStatusCode()).isEqualTo(HttpStatus.OK);
assertThat(r.getBody()).contains("\"status\":\"UP\"");`,
            solutionLanguage: "java",
          },
        ],
        outcomes: [
          "Readiness checks dependencies; liveness checks only JVM.",
          "Separate management port; graceful shutdown configured.",
          "Custom SqsHealthIndicator; disabled in dev.",
        ],
        antiPatterns: [
          { title: "DB in liveness probe", description: "On DB outage Kubernetes restarts all pods; use readiness for dependencies." },
          { title: "Actuator exposed publicly", description: "Use management port or Spring Security; /actuator/env exposes env vars." },
        ],
        diagrams: [],
        interviewMode:
          "Readiness asks: is this Pod ready to receive traffic? If it fails, Kubernetes removes it from the load balancer but does not restart. Liveness asks: is the JVM alive? If it fails, Kubernetes restarts the container. I never put dependency checks in liveness — if the DB is down and liveness checks DB, you get a restart storm. I use Spring Boot health groups: readiness includes db and sqs; liveness is just ping. I also configure graceful shutdown so SIGTERM leads to finishing in-flight requests before exit.",
      },
      {
        id: "1-6",
        title: "Capstone Milestone M1",
        description: "Deliverable: runnable order-api with POST/GET orders, Actuator health, structured logs with correlationId.",
        capstoneConnection:
          "Deliverable: A runnable order-api. POST /orders returns 202 Accepted. GET /orders/{id} returns order state. Actuator health UP. All logs structured with correlationId.",
        content: `Verification checklist before Module 2: mvn clean verify passes; spring-boot:run with SPRING_PROFILES_ACTIVE=dev; POST /orders valid → 202 with orderId; POST without Idempotency-Key → 400 MISSING_HEADER; POST invalid payload → 400 VALIDATION_ERROR with errors array; GET valid id → 200 with order data; GET nonexistent → 404 ORDER_NOT_FOUND; /actuator/health/readiness and liveness → 200 UP; X-Correlation-Id in response headers; correlationId in every log line; no JPA entity in controller responses. Use pom.xml with spring-boot-starter-web, data-jpa, validation, actuator, micrometer-prometheus, logstash-logback-encoder, springdoc-openapi. Flyway for schema (orders, order_items, idempotency_keys). IdempotencyService with executeIfNew storing response in JSONB.`,
        concepts: [
          "Complete OrderController, OrderService, IdempotencyService",
          "Flyway V1__create_orders.sql; IdempotencyKey entity with JsonNode response",
          "Smoke test: curl POST/GET, idempotency same key, health checks on 8081",
        ],
        codeExamples: [
          {
            language: "java",
            label: "OrderService.createOrder",
            code: `@Transactional
public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
    return idempotencyService.executeIfNew(idempotencyKey, () -> {
        Order order = Order.create(request.customerId(), items, request.totalAmount());
        orderRepository.save(order);
        log.info("Order created: customerId={} totalAmount={}", order.getCustomerId(), order.getTotalAmount());
        return CreateOrderResponse.from(order, MDC.get("correlationId"));
    });
}`,
          },
          {
            language: "bash",
            label: "Quick smoke test",
            code: `curl -s -X POST http://localhost:8080/orders \\
  -H "Content-Type: application/json" -H "Idempotency-Key: $(uuidgen)" -H "X-API-Key: dev-secret-key" \\
  -d '{"customerId":"cust-test","items":[{"sku":"PROD-001","qty":2}],"totalAmount":59.90}' | jq .
# Expected: orderId, status PENDING, correlationId
curl -s http://localhost:8081/actuator/health/readiness | jq .`,
          },
        ],
        warnings: [],
        references: [{ title: "Module 2 — Containers & Runtime" }],
        exercises: [],
        outcomes: [
          "order-api runs; POST/GET work; Actuator health UP; correlationId in logs and headers.",
          "Idempotency with IdempotencyKey table; no entity in response.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "After Module 1 the order-api is runnable: clean layering, DTOs only in API, global exception handler with ErrorResponse, structured logging with correlationId, and Actuator readiness/liveness. Orders stay PENDING until Module 4 adds the worker; SQS health can be disabled in dev.",
      },
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
      {
        id: "2-1",
        title: "Multi-Stage Dockerfile",
        description: "Builder stage produces JAR; runtime stage copies only the JAR. Layered JAR for cache efficiency.",
        capstoneConnection:
          "The order-api and order-worker Dockerfiles here are built by CI and used in Kubernetes (Module 3). Get the layering right now.",
        content: `Single-stage builds ship Maven, JDK, and source into the image (900MB–1.5GB). Multi-stage: Stage 1 (builder) uses full JDK + Maven to compile and produce a layered JAR; Stage 2 (runtime) uses JRE and copies only the extracted layers. Spring Boot layered JAR: dependencies (change least), spring-boot-loader, snapshot-dependencies, application (change every commit). Copy layers in that order so Docker reuses cache. Use eclipse-temurin:21-jre-alpine. Run as non-root (adduser). Use exec form ENTRYPOINT so java is PID 1 (critical for SIGTERM). Set JAVA_TOOL_OPTIONS for container support (see 2.2). HEALTHCHECK wget readiness endpoint.`,
        concepts: [
          "Multi-stage: builder stage not in final image",
          "Layered JAR: dependencies → application order for cache",
          "Exec form ENTRYPOINT; non-root user; HEALTHCHECK",
        ],
        codeExamples: [
          {
            language: "dockerfile",
            label: "Multi-stage with layered JAR",
            code: `FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /workspace
COPY pom.xml . && COPY .mvn/ .mvn/ && COPY mvnw .
RUN ./mvnw dependency:go-offline -B
COPY src/ src/
RUN ./mvnw package -DskipTests -B && java -Djarmode=layertools -jar target/*.jar extract --destination /workspace/extracted

FROM eclipse-temurin:21-jre-alpine AS runtime
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/dependencies/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/spring-boot-loader/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/application/ ./
EXPOSE 8080 8081
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]`,
          },
        ],
        warnings: [],
        references: [{ title: "Chapter 2.2 — JVM in Containers" }],
        exercises: [],
        outcomes: [
          "Multi-stage Dockerfile; only JAR in final image.",
          "Layered JAR order for Docker cache; exec form ENTRYPOINT.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use multi-stage builds: a builder stage with JDK and Maven produces the JAR, then a runtime stage with JRE copies only the extracted layers. Spring Boot layered JAR lets Docker cache the dependencies layer; only the application layer changes on each deploy. I use exec form ENTRYPOINT so the JVM is PID 1 and receives SIGTERM correctly.",
      },
      {
        id: "2-2",
        title: "JVM in Containers",
        description: "UseContainerSupport and MaxRAMPercentage; avoid fixed -Xmx in containers.",
        capstoneConnection:
          "JVM flags in the Dockerfile and K8s manifests determine whether order-api runs stably or gets OOMKilled.",
        content: `Without container support the JVM reads host memory and can allocate a heap larger than the container limit → OOMKilled. Use -XX:+UseContainerSupport (default in Java 11+) and -XX:MaxRAMPercentage=75.0 so heap scales with container limit. Do not use fixed -Xmx in Dockerfile. Budget: heap + metaspace + thread stacks + direct + overhead; for Spring Boot the realistic minimum container limit is 768MB. Use -XX:+ExitOnOutOfMemoryError so the process exits cleanly on OOM. Verify with java -XX:+PrintFlagsFinal -version in a limited container.`,
        concepts: [
          "UseContainerSupport; MaxRAMPercentage=75",
          "Memory budget: heap is not the only consumer",
          "ExitOnOutOfMemoryError; 768MB minimum for Spring Boot",
        ],
        codeExamples: [
          {
            language: "dockerfile",
            label: "JAVA_TOOL_OPTIONS for containers",
            code: `ENV JAVA_TOOL_OPTIONS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError -Djava.security.egd=file:/dev/./urandom"`,
          },
        ],
        warnings: ["Do not set -Xmx equal to container limit; leave headroom for metaspace and threads."],
        references: [{ title: "Chapter 2.3 — Graceful Shutdown" }],
        exercises: [],
        outcomes: [
          "JVM reads cgroup limits; heap scales with container memory.",
          "No hardcoded heap; use percentage; plan full memory budget.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use UseContainerSupport and MaxRAMPercentage so the heap scales with the container limit. I never hardcode -Xmx in the Dockerfile because when someone changes the K8s memory limit the JVM would still try to use the old value. For Spring Boot I plan for heap plus metaspace, thread stacks, and direct memory — 768MB minimum container limit.",
      },
      {
        id: "2-3",
        title: "Graceful Shutdown",
        description: "SIGTERM → stop accepting traffic, finish in-flight requests, then exit.",
        capstoneConnection:
          "Every rolling deployment in Module 3 terminates old pods. Without graceful shutdown those terminations cause 500 errors mid-request.",
        content: `Without graceful shutdown, SIGTERM causes the JVM to exit immediately and in-flight requests get connection reset. With server.shutdown=graceful and timeout-per-shutdown-phase, Spring Boot stops accepting new connections, sets readiness OUT_OF_SERVICE, waits for in-flight requests (up to timeout), then exits. The JVM must be PID 1 to receive SIGTERM — use exec form ENTRYPOINT, not shell form. Optionally use a preStop hook (sleep 5s) so the load balancer has time to drain.`,
        concepts: [
          "server.shutdown: graceful; timeout-per-shutdown-phase",
          "Exec form ENTRYPOINT so java is PID 1",
          "preStop hook for load balancer drain",
        ],
        codeExamples: [
          {
            language: "yaml",
            label: "Graceful shutdown config",
            code: `server:\n  shutdown: graceful\nspring:\n  lifecycle:\n    timeout-per-shutdown-phase: 30s`,
          },
          {
            language: "dockerfile",
            label: "Exec form (correct)",
            code: `ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]`,
            explanation: "Shell form makes /bin/sh PID 1; signals may not reach Java.",
          },
        ],
        warnings: [],
        references: [{ title: "Chapter 2.4 — Health Probes in Docker" }],
        exercises: [],
        outcomes: [
          "Graceful shutdown configured; in-flight requests complete.",
          "Exec form ENTRYPOINT; optional preStop for K8s.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I configure server.shutdown=graceful and a timeout so when Kubernetes sends SIGTERM the app stops accepting new traffic and waits for in-flight requests to finish. The JVM must be PID 1 to receive SIGTERM, so I use exec form ENTRYPOINT. Without this, every rolling update drops requests.",
      },
      {
        id: "2-4",
        title: "Health Probes in Docker",
        description: "HEALTHCHECK in Dockerfile; depends_on condition in docker-compose.",
        capstoneConnection:
          "docker-compose in M2 uses health checks so order-api and order-worker start only after postgres and localstack are ready.",
        content: `Docker HEALTHCHECK is for single-container status and docker-compose depends_on conditions. Kubernetes uses its own probes in Deployment YAML (Module 3). In Dockerfile use wget (Alpine) or curl (Debian) to hit /actuator/health/readiness. Set interval=10s, timeout=5s, start-period=30s (Spring Boot needs 10–20s to start), retries=3. In docker-compose use condition: service_healthy so app services wait for DB and localstack.`,
        concepts: [
          "HEALTHCHECK in Dockerfile; start-period for startup",
          "depends_on: condition: service_healthy in compose",
          "K8s probes are separate (Module 3)",
        ],
        codeExamples: [
          {
            language: "dockerfile",
            label: "HEALTHCHECK",
            code: `HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://localhost:8081/actuator/health/readiness || exit 1`,
          },
        ],
        warnings: [],
        references: [{ title: "Chapter 2.5 — Docker Compose for Local Dev" }],
        exercises: [],
        outcomes: [
          "HEALTHCHECK with start-period so startup is not marked unhealthy.",
          "Compose depends_on with service_healthy for startup order.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "In the Dockerfile I add HEALTHCHECK hitting the readiness endpoint with a 30s start-period so normal Spring Boot startup is not counted as unhealthy. In docker-compose I use depends_on with condition service_healthy so the app only starts after postgres and localstack are ready.",
      },
      {
        id: "2-5",
        title: "Docker Compose for Local Dev",
        description: "One-command stack: postgres, localstack, order-api, order-worker; profiles for infra-only.",
        capstoneConnection:
          "The docker-compose.yml here is the single command that brings up the entire capstone stack locally.",
        content: "Goals: one command (docker-compose up -d), deterministic startup (health-check controlled), no hardcoded credentials (use .env and ${VAR:-default}), infra-only mode (postgres + localstack for devs running apps locally), clean teardown (down -v). Use profiles so app services can be excluded for infra-only. Named volumes for postgres-data and localstack-data. Optional volume mount for hot-reload. Document .env in .gitignore.",
        concepts: [
          "depends_on with condition: service_healthy",
          "Profiles: full vs infra-only",
          ".env for secrets; named volumes",
        ],
        codeExamples: [
          {
            language: "yaml",
            label: "Environment with defaults",
            code: "environment:\\n  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-orderpass}\\n  SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/orderdb",
          },
        ],
        warnings: [],
        references: [{ title: "Module 3 — Kubernetes/OpenShift" }],
        exercises: [],
        outcomes: [
          "docker-compose up brings full stack or infra-only.",
          "Health-based startup order; no credentials in file.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use docker-compose with depends_on and service_healthy so postgres and localstack are ready before the app starts. I keep credentials in .env (gitignored) and use variable defaults in the compose file. I support infra-only mode with profiles so developers can run the app locally and only start the dependencies in Docker.",
      },
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
      {
        id: "3-1",
        title: "Cluster Anatomy",
        description: "Control plane, nodes, pods — what backend engineers need.",
        capstoneConnection:
          "Understanding the cluster lets you reason about where order-api and order-worker run and how they get traffic.",
        content: `Kubernetes cluster: control plane (API server, scheduler, etcd) and nodes (run your pods). You deploy Deployments (declarative desired state); the controller creates ReplicaSets and Pods. Pods are the unit of scheduling; each has an IP. Services give stable DNS and load-balancing to pods (selectors match pod labels). Use namespaces to isolate (e.g. order-dev). Do not create bare Pods — use Deployment so restarts and rollouts are managed. kubectl get/describe for pods, services, deployments; rollout status for updates.`,
        concepts: ["Control plane vs nodes", "Deployment → ReplicaSet → Pod", "Service and selectors", "Namespaces"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 3.2 — Deployments & Services" }],
        exercises: [],
        outcomes: [
          "Deployments manage Pods; Services expose them with stable DNS.",
          "Use kubectl get, describe, rollout; never rely on bare Pods.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use Deployments so the controller maintains desired replicas and handles rollouts. Services give pods a stable name and load-balance. I don't create bare Pods — they don't get recreated if they die.",
      },
      {
        id: "3-2",
        title: "Deployments & Services",
        description: "Deployment YAML for order-api and order-worker; Service for traffic.",
        capstoneConnection:
          "The Deployment YAML in capstone/k8s/order-api/ is what you apply; this chapter explains every field.",
        content: `Deployment spec: replicas, selector (match pod labels), template (pod spec with containers, image, ports, env, resources, readinessProbe, livenessProbe). Use image digest or tag; imagePullPolicy. Resource requests and limits (CPU/memory) for scheduling and HPA. Service: ClusterIP (default) or NodePort; selector must match pod labels. Rolling update: change image or template → new ReplicaSet, old pods terminated after new are ready. kubectl rollout status, rollout undo.`,
        concepts: [
          "Deployment: replicas, selector, template; container image, probes, resources",
          "Service selector; ClusterIP",
          "Rolling update and rollback",
        ],
        codeExamples: [
          {
            language: "yaml",
            label: "Deployment container and probes",
            code: `containers:
- name: order-api
  image: order-api:latest
  ports:
  - containerPort: 8080
  readinessProbe:
    httpGet:
      path: /actuator/health/readiness
      port: 8081
    initialDelaySeconds: 20
  resources:
    requests: { memory: "512Mi", cpu: "100m" }
    limits: { memory: "768Mi", cpu: "500m" }`,
          },
        ],
        warnings: [],
        references: [{ title: "Chapter 3.3 — ConfigMaps & Secrets" }],
        exercises: [],
        outcomes: [
          "Deployment with probes and resources; Service with matching selector.",
          "Rolling update and rollback with kubectl.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I define Deployments with readiness and liveness probes so traffic only goes to ready pods and unhealthy ones get restarted. I set resource requests and limits so the scheduler and HPA can work. Services use a selector that matches the Deployment's pod template labels.",
      },
      {
        id: "3-3",
        title: "ConfigMaps & Secrets",
        description: "Externalized config and non-hardcoded secrets.",
        capstoneConnection:
          "order-api needs DB credentials, API key, SQS URLs. All injected via ConfigMaps (non-sensitive) and Secrets (sensitive).",
        content: `ConfigMap: key-value or file content; mount as env or volume. Secret: base64-encoded (or opaque); never commit real values. In Deployment, envFrom or env.valueFrom.secretKeyRef/configMapKeyRef. In production use external secret operators (e.g. ESO) to sync from vault. Never put secrets in image or in plain text in repo. Verify with kubectl get secret, kubectl exec pod -- env.`,
        concepts: ["ConfigMap for non-sensitive config", "Secret for credentials; envFrom or valueFrom", "No secrets in image or Git"],
        codeExamples: [],
        warnings: ["Do not commit decoded secret values; use sealed-secrets or external secret store in prod."],
        references: [{ title: "Chapter 3.4 — Scaling & HPA" }],
        exercises: [],
        outcomes: [
          "ConfigMap and Secret; inject via env or volume.",
          "No hardcoded credentials in manifests or code.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use ConfigMaps for non-sensitive config and Secrets for credentials, injected as env vars or mounted files. I never put secrets in the image or in Git; in production I use an external secret operator to sync from a vault.",
      },
      {
        id: "3-4",
        title: "Scaling & HPA",
        description: "Horizontal scaling based on CPU (and custom metrics).",
        capstoneConnection:
          "The HPA manifest in capstone/k8s/order-api/ is already written; this chapter explains and verifies it.",
        content: `HorizontalPodAutoscaler: scale Deployment based on CPU utilization (or custom metrics). Requires metrics-server in cluster (install on kind). HPA needs container resource requests to compute percentage. minReplicas, maxReplicas, targetCPUUtilizationPercentage. kubectl get hpa, describe hpa. Generate load and watch replicas grow. Optional: KEDA for queue-based scaling.`,
        concepts: ["HPA: min/max replicas, target CPU%", "metrics-server required", "Container requests needed for HPA"],
        codeExamples: [
          {
            language: "yaml",
            label: "HPA",
            code: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70`,
          },
        ],
        warnings: [],
        references: [{ title: "Chapter 3.5 — Debugging with kubectl" }],
        exercises: [],
        outcomes: [
          "HPA scales Deployment based on CPU; metrics-server on kind.",
          "Verify with kubectl get hpa and load test.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use HPA with CPU target so under load the Deployment scales out. The cluster needs metrics-server; containers must have resource requests so HPA can compute utilization. I set min and max replicas to avoid runaway scaling.",
      },
      {
        id: "3-5",
        title: "Debugging with kubectl",
        description: "Logs, describe, exec for troubleshooting.",
        capstoneConnection:
          "When pods are CrashLoopBackOff or not receiving traffic, kubectl is your first tool.",
        content: `kubectl get pods (status: Pending, Running, CrashLoopBackOff, OOMKilled). kubectl logs pod --previous for crash logs. kubectl describe pod: events, limits, state. OOMKilled → increase memory or reduce heap. Pending → resource requests not satisfiable or PVC. Service has no endpoints → selector/label mismatch or pods not Ready. readinessProbe failed → check probe path and port. kubectl exec for shell; port-forward for local testing.`,
        concepts: ["get/describe pods; logs --previous", "OOMKilled vs CrashLoopBackOff", "Service endpoints and selector match"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 3.6 — Capstone Milestone M3" }],
        exercises: [],
        outcomes: [
          "Use get, describe, logs (including --previous) to diagnose failures.",
          "Check Service endpoints when traffic does not reach pods.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use kubectl get and describe to see pod state and events, and logs with --previous for crashed containers. If the Service has no endpoints I check that pod labels match the Service selector and that readiness probes are passing.",
      },
      {
        id: "3-6",
        title: "Capstone Milestone M3",
        description: "K8s manifests, rolling deploy, HPA on kind/minikube.",
        capstoneConnection:
          "Apply order-api and order-worker manifests to a local cluster; verify rolling update and HPA.",
        content: `Create kind cluster; install metrics-server. Build images and load into kind (or use imagePullPolicy: Never). Apply namespace, then postgres/localstack if needed, then order-api manifests (deployment, service, configmap, secret, hpa), then order-worker. kubectl rollout status; port-forward to test. Trigger rolling update (set image); verify zero downtime. Rollback if needed. Verification: pods Running, HPA active, rollout history.`,
        concepts: ["kind cluster; apply order-api and order-worker manifests", "Rolling update and rollback", "HPA and metrics-server"],
        codeExamples: [
          {
            language: "bash",
            label: "Apply and verify",
            code: `kubectl apply -f k8s/order-api/
kubectl apply -f k8s/order-worker/
kubectl rollout status deployment/order-api
kubectl get hpa
kubectl set image deployment/order-api order-api=order-api:new --record`,
          },
        ],
        warnings: [],
        references: [{ title: "Module 4 — AWS Essentials" }],
        exercises: [],
        outcomes: [
          "Manifests apply cleanly; rolling update and rollback work.",
          "HPA is configured and observable.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "After M3 the full stack runs on Kubernetes: I apply the manifests, run a rolling update to confirm zero downtime, and use kubectl get hpa to confirm autoscaling is configured. I can roll back with rollout undo if a bad image is deployed.",
      },
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
      {
        id: "4-1",
        title: "SQS Fundamentals",
        description: "Queues, visibility timeout, redrive policy, long polling.",
        capstoneConnection:
          "Queue behavior here — visibility timeout, redrive, long polling — determines whether order-worker processes exactly once, retries correctly, and sends permanent failures to DLQ.",
        content: `SQS: at-least-once delivery; messages can be delivered more than once. Visibility timeout: after a consumer receives a message, it's hidden from other consumers until timeout or delete; if the consumer crashes, message reappears. Use redrive policy to send failed messages to a DLQ after max receives. Long polling reduces empty receives. LocalStack for local SQS. Create queues via AWS CLI or Terraform; configure queue URL in application.yml.`,
        concepts: ["Visibility timeout and redrive policy", "DLQ after max receives", "Long polling; LocalStack"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 4.2 — Spring Boot + SQS Integration" }],
        exercises: [],
        outcomes: [
          "Visibility timeout and DLQ configured for order queue.",
          "LocalStack for local dev; queue URL from config.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I set visibility timeout long enough for processing so the message isn't re-delivered while still being worked on. After max receives I send to a DLQ so permanent failures are isolated. I use long polling to reduce empty receives and cost.",
      },
      {
        id: "4-2",
        title: "Spring Boot + SQS Integration",
        description: "OrderEventPublisher in order-api; SQS consumer in order-worker.",
        capstoneConnection:
          "This chapter implements OrderEventPublisher in order-api and the SQS consumer in order-worker. By the end, order-api publishes events and order-worker receives them.",
        content: `order-api: after persisting order, publish OrderCreatedEvent to SQS (message body JSON; attributes for correlationId). Use AWS SDK SqsClient or Spring Cloud AWS. order-worker: poll SQS (or use @SqsListener); parse message, load order, run processing steps, update status, delete message. Configure queue URL and region in application.yml; use LocalStack endpoint in dev. Propagate correlationId as message attribute.`,
        concepts: ["Publish to SQS after order create", "Consumer: poll, process, delete", "correlationId in message attributes"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 4.3 — Building the order-worker" }],
        exercises: [],
        outcomes: [
          "order-api publishes OrderCreatedEvent to SQS.",
          "order-worker consumes and processes; correlationId propagated.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "The API publishes a message with the order payload and correlationId as an attribute. The worker polls, restores correlationId to MDC, processes the order, updates the DB, and deletes the message. I use the same correlationId so I can trace the full flow in logs.",
      },
      {
        id: "4-3",
        title: "Building the order-worker",
        description: "Consumer that processes OrderCreatedEvent and updates order status.",
        capstoneConnection:
          "Full implementation of order-worker: consumes OrderCreatedEvent, runs processing steps, transitions order to COMPLETED or FAILED.",
        content: `Worker: SQS listener or poller; for each message: parse OrderCreatedEvent, set correlationId in MDC, load Order by id, markProcessing(), run steps (e.g. inventory-check, payment-authorization mocks), markCompleted() or markFailed(), delete message. Use @Transactional for DB updates. On exception: don't delete message so it becomes visible again after timeout (retry). Module 6 adds Resilience4j retry and DLQ.`,
        concepts: ["Consume message; MDC correlationId", "Processing steps; status transitions", "Transactional updates; retry via visibility"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 4.4 — RDS & Database Patterns" }],
        exercises: [],
        outcomes: [
          "order-worker consumes events and updates order status.",
          "correlationId in worker logs; COMPLETED or FAILED.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "The worker consumes the message, puts correlationId in MDC, loads the order, runs the processing steps in a transaction, and updates status. If something throws, we don't delete the message so it retries after visibility timeout.",
      },
      {
        id: "4-4",
        title: "RDS & Database Patterns",
        description: "PostgreSQL and failover awareness for both services.",
        capstoneConnection:
          "Both order-api and order-worker use the same or separate DB; connection pooling and failover matter.",
        content: `RDS: managed PostgreSQL; multi-AZ for failover. Connection pooling (HikariCP); set max pool size and timeouts. In K8s use RDS endpoint from Secret or ConfigMap. Failover: RDS can change endpoint on failover; use read replica for read-heavy workloads. For capstone, same DB for both services is fine; use transactions and avoid long-held connections.`,
        concepts: ["HikariCP; connection timeouts", "Multi-AZ and endpoint", "Config from Secret/ConfigMap"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 4.5 — IAM & IRSA" }],
        exercises: [],
        outcomes: [
          "DB URL and credentials from config; pool configured.",
          "Awareness of failover and connection handling.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use connection pooling with sensible limits and timeouts. In AWS I'd use RDS with multi-AZ; the app reconnects on failover. I never hardcode the DB URL — it comes from ConfigMap or Secret.",
      },
      {
        id: "4-5",
        title: "IAM & IRSA",
        description: "No hardcoded credentials; IRSA for EKS.",
        capstoneConnection:
          "In production, pods assume a role via IRSA; no access keys in env.",
        content: `IAM: least privilege; policy for SQS send/receive and (if needed) RDS. On EKS use IRSA: ServiceAccount with annotation (eks.amazonaws.com/role-arn); OIDC provider; pod gets AWS credentials via webhook. No AWS_ACCESS_KEY_ID in env. For local dev use profile or env vars (gitignored). Verify: kubectl describe pod shows ServiceAccount; exec into pod and aws sts get-caller-identity.`,
        concepts: ["IRSA: ServiceAccount + role ARN annotation", "No access keys in pods", "Local dev: profile or env"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 4.6 — Capstone Milestone M4" }],
        exercises: [],
        outcomes: [
          "IRSA configured for EKS; no credentials in code or env.",
          "Local dev uses separate config (profile or .env).",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use IRSA so pods assume an IAM role via the ServiceAccount annotation; no long-lived keys in the cluster. Locally I use a dev profile or env vars that are never committed.",
      },
      {
        id: "4-6",
        title: "Capstone Milestone M4",
        description: "SQS integration; order-worker consuming and processing; end-to-end flow.",
        capstoneConnection:
          "By M4 the full flow works: POST order → event to SQS → worker processes → order COMPLETED.",
        content: `Verification: Create order → 202; wait a few seconds; GET order → status COMPLETED. Idempotency: same Idempotency-Key returns same orderId. Health checks pass. Logs show same correlationId in API and worker. Optional: enable transient failure in worker and verify retries; check DLQ after max retries. docker-compose up or K8s; run smoke script.`,
        concepts: ["End-to-end: create → event → worker → COMPLETED", "correlationId in both logs", "Idempotency and health"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Module 5 — Terraform IaC" }],
        exercises: [],
        outcomes: [
          "order-api publishes; order-worker consumes and completes orders.",
          "correlationId traceable; health and idempotency verified.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "After M4 I can create an order, see it in the queue, and see the worker pick it up and set status to COMPLETED. The same correlationId appears in API and worker logs so I can trace the full request.",
      },
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
      {
        id: "5-1",
        title: "Terraform Core Concepts",
        description: "Providers, resources, plan/apply.",
        capstoneConnection:
          "Terraform provisions SQS queues, RDS (or local Postgres config), and IAM for the capstone.",
        content: `Terraform: declarative IaC; providers (e.g. aws) supply resources. Write .tf files: provider block, resource "aws_sqs_queue" etc. Workflow: terraform init (backend, providers), terraform validate, terraform plan (read-only diff), terraform apply. State holds current resource IDs; store remotely (S3) with locking (DynamoDB). Pin provider versions. Use data sources to read existing resources (e.g. VPC).`,
        concepts: ["Provider and resources", "init, plan, apply", "State; remote backend"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 5.2 — State Management" }],
        exercises: [],
        outcomes: [
          "Terraform workflow: init, plan, apply.",
          "Resources for SQS, (optional) RDS, IAM; pin provider versions.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use Terraform for provisioning: define resources in .tf, run plan to see changes, apply to create or update. I keep state in a remote backend with locking so the team doesn't overwrite each other.",
      },
      {
        id: "5-2",
        title: "State Management",
        description: "Remote state in S3; locking with DynamoDB.",
        capstoneConnection:
          "Capstone Terraform state lives in S3; locking prevents concurrent apply conflicts.",
        content: `State maps Terraform config to real resource IDs. Local state is lost if machine dies; use remote backend (S3). Enable versioning on the S3 bucket for state history. Use DynamoDB table for locking so two applies don't run at once. backend "s3" block in backend.tf; use different key per env. For local dev, backend can point to LocalStack S3. terraform state list, state show, state rm, import.`,
        concepts: ["S3 backend; versioning", "DynamoDB lock", "env-specific state key"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 5.3 — Variables, Outputs & Environments" }],
        exercises: [],
        outcomes: [
          "Remote state in S3 with locking.",
          "Separate state (or key) per environment.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I store state in S3 with versioning so we can recover. I use a DynamoDB table for locking so only one apply runs at a time. Each environment has its own state file or prefix.",
      },
      {
        id: "5-3",
        title: "Variables, Outputs & Environments",
        description: "tfvars and env separation (dev/prod).",
        capstoneConnection:
          "Variables for queue names, env; outputs for queue URL and DB endpoint for K8s ConfigMap.",
        content: `Variables in variables.tf; use var.name in resources. tfvars files (e.g. envs/dev/terraform.tfvars) for per-env values; -var-file or TF_VAR_ for overrides. Outputs expose queue URL, DB endpoint, IAM policy ARN so CI or K8s can consume them. Use locals for derived values. Separate workspace or directory per env to keep state and vars clean.`,
        concepts: ["variable, output, local", "tfvars; -var-file", "Outputs for CI/K8s"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 5.4 — Capstone Milestone M5" }],
        exercises: [],
        outcomes: [
          "Variables and tfvars for env-specific config.",
          "Outputs for queue URL and DB endpoint.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use variables for things that change per env (queue name, DB size) and tfvars files to set them. Outputs expose URLs and ARNs so the app or CI can use them without hardcoding.",
      },
      {
        id: "5-4",
        title: "Capstone Milestone M5",
        description: "Terraform for SQS, RDS, IAM; LocalStack for dev.",
        capstoneConnection:
          "Infrastructure for the capstone is defined in Terraform; LocalStack for local apply.",
        content: `Terraform creates: SQS queue and DLQ, redrive policy; optional RDS or use existing; IAM policy for SQS access. Backend: S3 (and DynamoDB) for real AWS; LocalStack S3 for local dev. Apply dev with LocalStack; verify outputs (queue URL, etc.). Use outputs in application config or K8s ConfigMap. Checklist: plan shows 0 changes after apply; no credentials in repo.`,
        concepts: ["SQS + DLQ; redrive", "Backend: prod vs LocalStack", "Outputs consumed by app"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Module 6 — Resilience Patterns" }],
        exercises: [],
        outcomes: [
          "SQS and DLQ (and optional RDS, IAM) in Terraform.",
          "LocalStack backend for dev; outputs for app config.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "After M5 the queue and DLQ are provisioned by Terraform. I use a remote backend in prod and LocalStack for local. Outputs feed the app's config so we don't hardcode queue URLs.",
      },
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
      {
        id: "6-1",
        title: "Retry with Exponential Backoff",
        description: "Transient failures and retry config with Resilience4j.",
        capstoneConnection:
          "order-worker retries transient failures (e.g. payment mock down) with backoff; permanent failures go to DLQ.",
        content: `Retry for transient failures: network blips, temporary downstream unavailability. Use exponential backoff so you don't hammer a failing service. Resilience4j: @Retry with maxAttempts, intervalFunction (exponential). Only retry idempotent operations or operations that are safe to retry. After max retries, let the message return to the queue (visibility timeout) or send to DLQ. Do not retry non-idempotent operations without deduplication.`,
        concepts: ["Exponential backoff", "Resilience4j @Retry", "Idempotency and max attempts"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 6.2 — Circuit Breaker" }],
        exercises: [],
        outcomes: [
          "Retry with backoff for transient failures.",
          "Max attempts then DLQ or visibility re-queue.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use retry with exponential backoff for transient failures so we don't overload a struggling dependency. I set a max attempts and then either let the message go to the DLQ or become visible again. I only retry when the operation is idempotent or we have deduplication.",
      },
      {
        id: "6-2",
        title: "Circuit Breaker",
        description: "Downstream failure and OPEN state; fail fast when dependency is down.",
        capstoneConnection:
          "When payment or another downstream is repeatedly failing, circuit breaker opens and fails fast instead of retrying every request.",
        content: `Circuit breaker: CLOSED (normal), OPEN (failing fast after threshold), HALF_OPEN (test with a few calls). Resilience4j: CircuitBreaker with failureRateThreshold, waitDurationInOpenState, slidingWindow. When OPEN, don't call the downstream — return immediately or throw. Prevents cascade and gives the downstream time to recover. Use with retry: retry handles transient; circuit breaker stops calling when downstream is clearly down.`,
        concepts: ["CLOSED, OPEN, HALF_OPEN", "failureRateThreshold; waitDuration", "Fail fast when OPEN"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 6.3 — Timeout, Bulkhead & DLQ" }],
        exercises: [],
        outcomes: [
          "Circuit breaker on payment/downstream calls.",
          "OPEN state stops calls; HALF_OPEN tests recovery.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use a circuit breaker so when the downstream fails repeatedly we stop calling it and fail fast. That avoids wasting threads and gives the dependency time to recover. After a wait period we go to HALF_OPEN and try a few calls to see if it's back.",
      },
      {
        id: "6-3",
        title: "Timeout, Bulkhead & DLQ Patterns",
        description: "Capstone retry/DLQ and Resilience4j config.",
        capstoneConnection:
          "order-worker: timeout on downstream calls, optional bulkhead to isolate thread pool, DLQ for permanent failures.",
        content: `Timeout: don't wait forever for a downstream call; use Resilience4j TimeLimiter or RestTemplate/WebClient timeout. Bulkhead: limit concurrency (separate thread pool or semaphore) so one slow dependency doesn't starve others. DLQ: after max retries or on permanent failure, send message to DLQ; alert on DLQ depth; replay after fix. application.yml: resilience4j.retry, circuitbreaker, timelimiter; order-worker uses all for payment step.`,
        concepts: ["Timeout on external calls", "Bulkhead (optional)", "DLQ and replay after fix"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Module 7 — Observability" }],
        exercises: [],
        outcomes: [
          "Timeout and circuit breaker configured in order-worker.",
          "DLQ for permanent failures; monitor and replay.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I set timeouts on all external calls so a hung dependency doesn't block the worker. I use the circuit breaker for the payment step. Messages that still fail after max retries go to the DLQ; we alert on DLQ depth and replay after fixing the bug or dependency.",
      },
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
      {
        id: "7-1",
        title: "The Three Pillars of Observability",
        description: "Logs, metrics, traces for the capstone.",
        capstoneConnection:
          "When something fails in production, logs, metrics, and traces answer: what happened and why.",
        content: `Observability: logs (event stream, correlationId for request tracing), metrics (counters, gauges, histograms — rate of orders, latency, error rate), traces (distributed request ID across services). For capstone: structured JSON logs with correlationId; Micrometer metrics (orders created, latency, circuit breaker state); optional distributed tracing (e.g. OpenTelemetry). Alerts on error rate, latency, DLQ depth, circuit breaker OPEN.`,
        concepts: ["Logs: structured, correlationId", "Metrics: counters, gauges, histograms", "Traces: optional; alerts"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 7.2 — Custom Metrics with Micrometer" }],
        exercises: [],
        outcomes: [
          "Logs, metrics, (optional) traces defined for order-api and order-worker.",
          "correlationId in every log line; metrics for business and runtime.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use the three pillars: structured logs with correlationId so I can grep one request across services; metrics for throughput, latency, and errors so I can alert; and optionally distributed tracing for the full path of a request.",
      },
      {
        id: "7-2",
        title: "Custom Metrics with Micrometer",
        description: "orders.created.total and business metrics.",
        capstoneConnection:
          "Default JVM metrics tell you if the heap is full; business metrics tell you if orders are being processed. You need both.",
        content: `Micrometer: MeterRegistry; counters (orders_created_total), timers (orders_creation_duration_seconds), gauges (e.g. queue depth). Register in service layer on order created and on worker processing. Use tags: status, customer_id (careful with cardinality). Expose at /actuator/prometheus. Business metrics answer: how many orders per minute, P99 latency, success rate.`,
        concepts: ["Counter, Timer, Gauge", "Tags and cardinality", "Register in service/worker"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 7.3 — Prometheus & Actuator" }],
        exercises: [],
        outcomes: [
          "orders.created.total and creation duration in order-api.",
          "Worker metrics for processed, failed, DLQ.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I add business metrics with Micrometer: counters for orders created and processed, timers for latency. I keep tag cardinality low. These metrics tell me if the system is doing its job, not just if the JVM is healthy.",
      },
      {
        id: "7-3",
        title: "Prometheus & Actuator",
        description: "Scraping and /actuator/prometheus.",
        capstoneConnection:
          "order-api and order-worker emit metrics via Micrometer; this chapter exposes them at /actuator/prometheus and configures K8s pod annotations for scraping.",
        content: `management.endpoints.web.exposure.include: health, prometheus, loggers. Prometheus scrapes /actuator/prometheus on a schedule. In K8s, annotate pods so Prometheus discovers them (prometheus.io/scrape: "true", prometheus.io/port: "8081", prometheus.io/path). Secure actuator (management port or network policy). Key metrics: orders_created_total, creation duration, circuit breaker state, HikariCP connections.`,
        concepts: ["/actuator/prometheus", "Pod annotations for discovery", "Secure actuator"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 7.4 — Health & Readiness Probes" }],
        exercises: [],
        outcomes: [
          "Prometheus endpoint exposed; K8s annotations for scraping.",
          "Dashboard/alert on business and runtime metrics.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I expose metrics at /actuator/prometheus and add pod annotations so Prometheus can scrape. I keep the management port internal so only the cluster can hit it. I alert on error rate, latency, and circuit breaker state.",
      },
      {
        id: "7-4",
        title: "Health & Readiness Probes",
        description: "DB and SQS checks in readiness.",
        capstoneConnection:
          "Kubernetes won't route traffic until readiness passes. If the pod can't reach DB or SQS, it should be removed from rotation — not killed.",
        content: `Readiness: include db, sqs (or custom) so the pod is only ready when it can reach dependencies. Liveness: ping only — don't put DB in liveness or you get restart storms. Module 1 and 3 already configured this; here we confirm readiness checks both DB and SQS and that liveness is separate. application-dev can disable SQS health for local runs without LocalStack.`,
        concepts: ["Readiness: db + sqs", "Liveness: ping only", "Disable SQS health in dev"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 7.5 — Production Runbook & M7" }],
        exercises: [],
        outcomes: [
          "Readiness fails when DB or SQS unreachable.",
          "Liveness independent; no restart on DB outage.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "Readiness checks DB and SQS so we don't send traffic to a pod that can't do work. Liveness is just ping — if the DB is down we don't want Kubernetes restarting all our pods.",
      },
      {
        id: "7-5",
        title: "Production Runbook & Milestone M7",
        description: "Structured logs, correlationId, readiness wired; incident workflow.",
        capstoneConnection:
          "Observability without a runbook is incomplete. This chapter turns metrics, logs, and probes into a structured incident response workflow.",
        content: `Runbook: how to diagnose high error rate (check DB pool, SQS timeout, circuit breaker); how to check queue depth and DLQ; how to find logs by correlationId (from customer orderId or from DLQ message attribute); how to verify after deploy (metrics recover, smoke test); how to replay DLQ after fix. M7 checklist: logs JSON with correlationId, readiness/liveness correct, Prometheus scraping, runbook documented.`,
        concepts: ["Runbook: error rate, queue, DLQ", "Find logs by correlationId", "Replay DLQ after fix"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Module 8 — Senior Communication" }],
        exercises: [],
        outcomes: [
          "Runbook for common failures and recovery.",
          "M7 verification: logs, probes, metrics, runbook.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I document a runbook: how to trace a request with correlationId, how to check queue and DLQ depth, how to tell if the circuit breaker is open, and how to replay the DLQ after a fix. Observability is only useful if the team knows how to use it.",
      },
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
      {
        id: "8-1",
        title: "The Architecture Pitch",
        description: "2-minute explanation of the full capstone system.",
        capstoneConnection:
          "You've built the entire order processing platform. Now you need to explain it in 2 minutes to someone who will decide whether to hire you.",
        content: `Pitch structure: problem (order processing, async), high-level flow (API → queue → worker → DB), key decisions (SQS for simplicity, idempotency, DTOs, structured logging, health probes, circuit breaker). Mention: Spring Boot, PostgreSQL, SQS, Docker, K8s, Terraform. Practice until you can deliver in under 2 minutes without hesitation. This is the opener for senior interviews.`,
        concepts: ["Flow: API → SQS → worker → DB", "Key decisions in one sentence each", "2 minutes; practice delivery"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 8.2 — Defending Trade-offs" }],
        exercises: [],
        outcomes: [
          "Clear 2-minute pitch of the capstone architecture.",
          "Able to deliver without reading notes.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I describe it as an async order processing system: the API accepts orders and publishes to SQS, the worker consumes and runs processing steps with retry and circuit breaker, we use DTOs and structured logging with correlationId, and we run it in Docker and Kubernetes with Terraform for infra. I keep it to two minutes and then invite questions.",
      },
      {
        id: "8-2",
        title: "Defending Trade-offs",
        description: "Why SQS over Kafka, idempotency, scaling decisions.",
        capstoneConnection:
          "Every major decision has a 'why not X?' question. This chapter prepares answers for the five most likely challenges.",
        content: `Prepare answers for: Why SQS and not Kafka? (simplicity, managed, good enough for order volume; Kafka when you need ordering or replay at scale.) Why idempotency key? (duplicate POSTs from retries or UI; same key = same response.) Why separate readiness and liveness? (DB down → remove from LB, don't restart.) Why DTOs and not entities in API? (contract stability, no lazy load leaks.) Why circuit breaker on payment? (fail fast when downstream is down; avoid thread exhaustion.) Use ADR-style: context, decision, consequence.`,
        concepts: ["SQS vs Kafka", "Idempotency", "Readiness vs liveness", "DTOs", "Circuit breaker"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 8.3 — The 12 Interview Questions" }],
        exercises: [],
        outcomes: [
          "Articulate why SQS, idempotency, probes, DTOs, circuit breaker.",
          "Answer 'why not X?' confidently.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I'm ready to defend each choice: SQS for simplicity and managed operation, idempotency for safe retries, separate probes so we don't restart on DB outage, DTOs to keep the API contract stable, and circuit breaker to fail fast when the payment service is down.",
      },
      {
        id: "8-3",
        title: "The 12 Interview Questions",
        description: "Scripted answers for common senior questions.",
        capstoneConnection:
          "These are the 12 questions you will be asked about this architecture. Every answer comes from something you built.",
        content: `The 12 questions cover: error handling, logging, scaling, resilience, deployment, security, observability, idempotency, DTOs, health checks, state management, and trade-offs. Each has a reference answer in the chapter derived from the capstone. Goal: answer all 12 without consulting the doc. Practice out loud. Use STAR or context/decision/consequence where helpful.`,
        concepts: ["12 questions; answers from capstone", "Practice without notes", "STAR / context-decision-consequence"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 8.4 — Vocabulary & Language Precision" }],
        exercises: [],
        outcomes: [
          "Can answer all 12 questions from memory.",
          "Answers tie back to concrete implementation.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I've practiced the 12 questions and can answer each by referring to what we built: global exception handler, correlationId in logs, HPA for scaling, retry and circuit breaker, rolling deploy, management port for actuator, metrics and runbook, idempotency key, DTOs, readiness vs liveness, Terraform state, and trade-offs like SQS vs Kafka.",
      },
      {
        id: "8-4",
        title: "Vocabulary & Language Precision",
        description: "English technical vocabulary for interviews.",
        capstoneConnection:
          "Using the right words signals senior-level fluency in English-language technical interviews.",
        content: `Use precise terms: idempotency (same request → same effect), at-least-once delivery, exactly-once processing (with deduplication), circuit breaker (OPEN/CLOSED/HALF_OPEN), readiness vs liveness, correlation ID, structured logging, horizontal vs vertical scaling, rolling update, zero-downtime deploy. Avoid vague language ('we use a queue' → 'we use SQS with visibility timeout and a DLQ for failed messages'). Practice explaining each term in one sentence.`,
        concepts: ["Idempotency, at-least-once, exactly-once", "Circuit breaker states", "Readiness vs liveness", "Structured logging, correlationId"],
        codeExamples: [],
        warnings: [],
        references: [{ title: "Chapter 8.5 — Self-Assessment & Final Capstone Test" }],
        exercises: [],
        outcomes: [
          "Use correct technical terms in answers.",
          "One-sentence definitions for key terms.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I use the right vocabulary: idempotency for safe retries, at-least-once for SQS and how we handle it with idempotency, circuit breaker states, readiness for traffic routing and liveness for process health, and correlationId for tracing. I avoid jargon without explanation.",
      },
      {
        id: "8-5",
        title: "Self-Assessment & Final Capstone Test",
        description: "Verification checklist and architecture defense.",
        capstoneConnection:
          "This is the end. The acceptance test confirms the system is built correctly. The self-assessment confirms you can explain and defend it.",
        content: `Final acceptance test: full flow (create order → COMPLETED), idempotency, health checks, correlationId in logs, DLQ and replay, circuit breaker behavior. Self-assessment: can you do the 2-minute pitch, answer the 12 questions, and defend trade-offs? Both must pass before the course is complete. Run the test with docker-compose or K8s; document any gaps and fix them.`,
        concepts: ["Acceptance test: full flow and resilience", "Self-assessment: pitch + 12 + trade-offs", "Document and fix gaps"],
        codeExamples: [],
        warnings: [],
        references: [],
        exercises: [],
        outcomes: [
          "Acceptance test passes end-to-end.",
          "Can pitch, answer 12 questions, and defend trade-offs.",
        ],
        antiPatterns: [],
        diagrams: [],
        interviewMode:
          "I've run the full acceptance test and it passes. I can deliver the architecture pitch, answer the 12 questions from what we built, and defend why we chose SQS, idempotency, DTOs, separate probes, and circuit breaker. That's when I consider the course complete.",
      },
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
