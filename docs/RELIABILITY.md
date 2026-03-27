# Reliability

## Error Handling

- **Fail fast at boundaries.** Validate inputs immediately. Don't propagate invalid state.
- **Use typed errors.** Define error types per domain, not generic strings.
- **Never swallow errors.** Always log, re-throw, or handle explicitly.
- **Graceful degradation.** Non-critical features should fail without crashing the app.

## Logging

All logging must be structured (JSON-formatted in production).

```typescript
// Good
logger.info("user.created", { userId: user.id, source: "signup" });

// Bad
console.log("User created: " + user.id);
```

### Log Levels
- **error** - Something broke. Needs attention.
- **warn** - Unexpected but handled. Monitor for patterns.
- **info** - Key business events (user signup, payment, deploy).
- **debug** - Diagnostic detail. Disabled in production.

## Observability

- Every service should emit structured logs to stdout
- Key user journeys should be traceable end-to-end
- Health check endpoints at `/health` and `/ready`

## Resilience Patterns

- **Timeouts** on all external calls (default: 10s)
- **Retries** with exponential backoff for transient failures (max 3)
- **Circuit breakers** for external dependencies
- **Graceful shutdown** handling SIGTERM/SIGINT
