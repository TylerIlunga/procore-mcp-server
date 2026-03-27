# Architecture

## System Overview

<!-- Replace with a high-level description of your system -->

```
[Client] --> [API Layer] --> [Service Layer] --> [Data Layer]
                               |
                          [External Services]
```

## Domain Architecture

Each business domain follows a strict layered model. Dependencies flow in one direction only.

```
Types --> Config --> Repository --> Service --> Runtime --> UI
                                      ^
                                      |
                              [Providers: auth, telemetry, feature flags]
```

### Layer Responsibilities

| Layer | Responsibility | May Depend On |
|---|---|---|
| **Types** | Shared type definitions, schemas, enums | Nothing |
| **Config** | Domain-specific configuration, constants | Types |
| **Repository** | Data access, external API calls | Types, Config |
| **Service** | Business logic, orchestration | Types, Config, Repository, Providers |
| **Runtime** | Process lifecycle, scheduling, workers | Types, Config, Service |
| **UI** | Components, pages, user interaction | Types, Config, Service (via hooks/context) |
| **Providers** | Cross-cutting: auth, telemetry, flags | Types, Config |

### Dependency Rules

- Layers may only import from layers above them (or at the same level within a domain)
- Cross-domain imports go through the Service layer only
- No circular dependencies between domains
- Shared utilities live in `src/lib/` and are domain-agnostic

### Import Examples (TypeScript)

```typescript
// GOOD: Service imports from lower layers
// file: src/domains/billing/service.ts
import { BillingPlan } from './types';
import { BILLING_CONFIG } from './config';
import { BillingRepository } from './repository';
import { AuthProvider } from '../../providers/auth';

// BAD: Repository imports from higher layer
// file: src/domains/billing/repository.ts
import { BillingService } from './service';  // VIOLATION: repo -> service

// BAD: Cross-domain import bypassing Service layer
// file: src/domains/billing/repository.ts
import { UserRepository } from '../users/repository';  // VIOLATION: direct cross-domain

// GOOD: Cross-domain access through Service layer
// file: src/domains/billing/service.ts
import { UserService } from '../users/service';
```

### Provider Pattern

Providers supply cross-cutting capabilities (auth, telemetry, feature flags) to Services without creating layer violations.

```typescript
// Define the Provider interface in providers/
// file: src/providers/auth/index.ts
export interface AuthProvider {
  getCurrentUser(): Promise<User>;
  requirePermission(permission: string): Promise<void>;
}

// Inject into Services
// file: src/domains/billing/service.ts
export class BillingService {
  constructor(
    private repo: BillingRepository,
    private auth: AuthProvider,
  ) {}
}
```

## Directory Map

```
src/
  lib/           # Shared utilities, helpers, types
  domains/       # Business domains (each follows the layer model above)
    [domain]/
      types.ts
      config.ts
      repository.ts
      service.ts
      [ui/]      # If domain has UI
  providers/     # Cross-cutting concerns
    auth/
    telemetry/
    flags/
  app/           # App wiring, routing, entry points
```

## Key Decisions

<!-- Record important architectural decisions here, or link to docs/design-docs/ -->

| Decision | Rationale | Date |
|---|---|---|
| [e.g., Zod for validation] | [e.g., Composable, good TS inference, well-documented] | [date] |

## Infrastructure

<!-- Describe deployment, CI/CD, environments -->

- **CI:** GitHub Actions (see `.github/workflows/`)
- **Hosting:** [Vercel | AWS | GCP | etc.]
- **Database:** [PostgreSQL | Supabase | etc.]
- **Monitoring:** [Structured logging to stdout, collected by...]
