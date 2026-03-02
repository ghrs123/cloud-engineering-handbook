# 4.4 — RDS & Database Patterns

> **What you need to know as a backend engineer:** not how to operate RDS, but how to design your application to work correctly with it — especially during failover, under connection pressure, and at scale.

---

## RDS Multi-AZ vs Read Replicas — The Distinction That Gets Asked in Every Interview

These are frequently confused. They solve different problems:

| Feature | Multi-AZ | Read Replicas |
|---|---|---|
| **Purpose** | High availability (HA) | Read scalability |
| **Replication** | Synchronous to standby | Asynchronous to replicas |
| **Failover** | Automatic (~30–60s) | Manual promotion |
| **Standby is readable?** | No (standby is passive) | Yes (replicas serve reads) |
| **Use case** | Production HA, survive AZ failure | Offload read-heavy workloads |
| **Cost** | 2x (active + standby) | Per replica |

### Multi-AZ in practice

```
Primary RDS (us-east-1a)  ←→  Synchronous replication  ←→  Standby RDS (us-east-1b)
       ↑
  All reads + writes
       |
 DNS: order-db.xxx.us-east-1.rds.amazonaws.com
```

When the primary fails, AWS updates the DNS entry to point to the standby (promoted to primary). The failover DNS update takes 30–120 seconds. During this time, new connections fail.

**What your Spring Boot app must do:** retry the DB connection on startup and after connection errors. HikariCP handles this automatically with `connectionTimeout` and `initializationFailTimeout: -1` (don't fail startup if DB is temporarily unreachable).

```yaml
spring:
  datasource:
    hikari:
      connection-timeout: 5000          # 5s to acquire a connection from pool
      idle-timeout: 300000              # Remove idle connections after 5min
      max-lifetime: 1800000             # Recycle connections after 30min
      maximum-pool-size: 10
      minimum-idle: 2
      initialization-fail-timeout: -1  # Don't fail app startup if DB unreachable
      # Connection test query (validates before returning from pool)
      connection-test-query: SELECT 1
```

### Read Replicas in practice

```
Primary RDS ──async replication──► Read Replica 1
                                ──async replication──► Read Replica 2
```

Read replicas are typically 1–5 seconds behind the primary (replication lag). For `order-api`, this matters for `GET /orders/{id}` immediately after a `POST /orders` — if you read from a replica, you may not see the order you just created.

**Solution:** write to primary, read from primary for latency-sensitive reads. Use read replicas only for reports, analytics, and reads where slight staleness is acceptable.

In Spring Boot, you can route reads to replicas via `@Transactional(readOnly = true)` with a routing DataSource — but this complexity is out of scope for this capstone. Know it exists for interviews.

---

## Connection Pooling — The Scaling Bottleneck You Will Hit

PostgreSQL has a hard limit on concurrent connections (default: 100 for RDS `db.t3.micro`). Each Spring Boot pod uses a HikariCP pool.

```
2 pods × 10 connections/pod = 20 connections
10 pods × 10 connections/pod = 100 connections  ← at the DB limit
20 pods × 10 connections/pod = 200 connections  ← over the limit → connection errors
```

**You will hit this when HPA scales out during a traffic spike.** The scaling that helps your app creates a DB connection crisis.

### Solutions

**Short term:** reduce `maximum-pool-size` per pod:
```yaml
hikari:
  maximum-pool-size: 5    # 20 pods × 5 = 100 connections
```

**Production solution:** **PgBouncer** — a connection pooler that sits between your apps and PostgreSQL. Apps connect to PgBouncer (which supports thousands of connections); PgBouncer maintains a small pool to PostgreSQL.

```
order-api pods (200 "connections") → PgBouncer → PostgreSQL (20 actual connections)
```

PgBouncer is deployed as a K8s Deployment or as an RDS Proxy (AWS managed). For this capstone: keep `maximum-pool-size: 5-10` and document PgBouncer as the production scaling answer.

---

## Flyway — Database Migrations in Production

Never use `spring.jpa.hibernate.ddl-auto: create` or `update` in production. Hibernate's schema generation is not reversible, doesn't handle existing data, and loses synchronization with team changes.

Use **Flyway** for version-controlled, sequential migrations:

```
db/migration/
├── V1__create_orders.sql
├── V2__add_order_notes.sql
├── V3__add_idempotency_index.sql
```

Rules:
1. Migration filenames are immutable — never rename or edit `V1__*` after it runs
2. Each migration is a transaction — if it fails, it rolls back and the app won't start
3. Flyway stores migration history in `flyway_schema_history` table — never edit this manually
4. CI runs migrations before deploying new app versions (or Spring Boot runs them on startup)

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: false    # Don't auto-baseline for existing DBs in prod
    validate-on-migrate: true     # Fail if checksums don't match
```

**Deployment sequence with Flyway:**
1. New app version starts
2. Spring Boot runs Flyway before accepting traffic
3. Flyway applies new migrations
4. App starts serving traffic

Risk: if migration fails, app doesn't start. Kubernetes rolling update keeps old pods serving traffic until the new pod is `Ready`. If the new pod crashes (migration failed), the rollout stops and old pods continue. No downtime.

---

## What Happens to Active DB Connections During RDS Failover

During Multi-AZ failover:
1. Primary goes down
2. DNS is updated (30–120s)
3. Old connections to the previous primary's IP are broken
4. HikariCP detects broken connections (via test query or connection error)
5. HikariCP removes broken connections and creates new ones to the new primary's IP

**This means:** requests in-flight during failover will fail with a DB connection error. They should be retried by the client. The `@Transactional` operations that were mid-flight will roll back.

**What the application should do:** return 503 (Service Unavailable) or 500 to the client for the ~60 seconds of failover. The readiness probe will fail (DB is unreachable), so Kubernetes removes the pods from the load balancer during this window — clients get connection refused from the load balancer rather than errors from your app. When the DB is back, readiness passes, pods are re-added.

---

## Common Mistakes

**Using `ddl-auto: create-drop` in any environment that persists data.**  
`create-drop` deletes and recreates all tables when the application stops. Any Docker Compose teardown destroys your dev data. Use `ddl-auto: validate` with Flyway for schema management.

**Not setting `max-lifetime` on HikariCP.**  
RDS has a `wait_timeout` that closes idle connections server-side. If HikariCP's `max-lifetime` is longer than the server timeout, HikariCP will hand out dead connections. Set `max-lifetime` to slightly less than the RDS timeout (default RDS: 8 hours; set max-lifetime to `1800000` = 30 minutes as a safe default).

**Connecting directly to the RDS instance IP address.**  
RDS failover changes the underlying IP. Always use the DNS endpoint (e.g., `order-db.xxx.us-east-1.rds.amazonaws.com`). If you hardcode the IP in `SPRING_DATASOURCE_URL`, failover doesn't work.

---

## Interview Mode

**Question:** *"What's the difference between Multi-AZ and read replicas in RDS, and how does your application handle a failover?"*

**90-second answer:**
> "Multi-AZ is for high availability, not for performance. It maintains a synchronous standby in a different AZ. When the primary fails, AWS promotes the standby and updates the DNS record. Failover takes 30 to 120 seconds. The connection string doesn't change — it's still the same DNS endpoint.
>
> Read replicas are for read scalability. Replication is asynchronous, so replicas are slightly behind. They're useful for reports or heavy read queries that would otherwise load the primary.
>
> During a Multi-AZ failover, active connections to the old primary are broken. HikariCP detects this — either via the connection test query or when a transaction fails — and discards the broken connections. New connections go to the promoted primary via the updated DNS. In-flight transactions roll back; those requests fail and should be retried.
>
> On the Kubernetes side, the readiness probe will fail while the DB is unreachable, so the pod gets removed from the Service endpoints. The client gets connection refused rather than application errors. When the DB is back, readiness passes, the pod rejoins, and traffic flows again. Downtime is approximately 60 to 90 seconds in practice."

---

*Next: [Chapter 4.5 — IAM & IRSA →](./05-iam-irsa.md)*
