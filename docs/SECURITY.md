# Security

## Principles

1. **Validate at the boundary.** All external input is untrusted until parsed and validated.
2. **Least privilege.** Services and users get minimum required permissions.
3. **No secrets in code.** Use environment variables, validated at startup.
4. **Defense in depth.** Don't rely on a single security layer.

## Input Validation

- Parse all API inputs with schema validation (Zod, joi, etc.)
- Sanitize all user-generated content before rendering
- Use parameterized queries for all database operations (never string interpolation)

## Authentication & Authorization

<!-- Define your auth patterns here -->

- Auth tokens validated on every request
- Role-based access control at the service layer
- Session management: [describe approach]

## Secrets Management

- All secrets via environment variables
- `.env` files are gitignored
- Secrets validated at application startup
- Rotate credentials on a regular schedule

## Security Checklist for PRs

- [ ] No secrets committed
- [ ] Input validation on all new endpoints
- [ ] SQL injection protection (parameterized queries)
- [ ] XSS protection (output encoding)
- [ ] CSRF protection where applicable
- [ ] Rate limiting on public endpoints
- [ ] Auth checks on protected routes
