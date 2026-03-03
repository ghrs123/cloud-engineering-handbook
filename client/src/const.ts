/**
 * Content scope: This handbook is capstone-driven production engineering only.
 * No generic system design interview cases; content focuses on deploy, runtime,
 * observability, resilience, IaC, and delivering a cloud-ready Spring Boot backend.
 */
export const CONTENT_SCOPE =
  "Capstone-driven production engineering only — no generic system design content.";

export const ROUTES = {
  HOME: "/",
  MODULE: "/module/:id",
  MODULE_ID: (id: number) => `/module/${id}`,
  CURRICULUM: "/curriculum",
  CAPSTONE: "/capstone",
  NOT_FOUND: "/404",
} as const;

export const THEME_NAME = "Cloud Terminal";
