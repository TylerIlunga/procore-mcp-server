# Core Beliefs

**Status:** Active
**Date:** [project start date]

These are the foundational principles that guide all engineering decisions in this repository. When in doubt, refer here.

## 1. The Repository is the Source of Truth

Everything an agent needs to know must be discoverable from the repository itself. Knowledge in Slack threads, Google Docs, or people's heads is invisible to agents. If it matters, it gets committed.

## 2. Map, Not Manual

Documentation should be a navigable map with progressive disclosure, not a monolithic instruction manual. Start with a small entry point, teach agents where to look next.

## 3. Enforce Boundaries, Allow Autonomy

Strict architectural boundaries (layer dependencies, validation rules, naming conventions) are enforced mechanically. Within those boundaries, agents have freedom in how solutions are expressed.

## 4. Parse at the Boundary

All external data (API responses, user input, env vars, file reads) must be validated/parsed at the system edge. Internal code trusts typed interfaces.

## 5. Boring Technology Wins

Prefer composable, stable, well-documented dependencies. Technologies with broad training-set representation are easier for agents to reason about. Sometimes reimplementing a focused subset is better than importing an opaque library.

## 6. Fix the Environment, Not the Symptom

When an agent produces bad output, the fix is almost never "try harder." Ask: what capability, context, or constraint is missing? Then encode it into the repo.

## 7. Continuous Garbage Collection

Technical debt compounds. Address it continuously in small increments rather than painful bursts. Encode quality standards mechanically and run recurring cleanup.

## 8. Tests Are Specifications

Tests aren't just safety nets. They're executable specifications of intended behavior. Every feature has tests. Every bug fix has a regression test.

## 9. Throughput Over Perfection

Corrections are cheap when throughput is high. Ship, validate, iterate. Don't block on perfection when a fast follow-up is possible.

## 10. Human Judgment at the Right Layer

Humans prioritize work, define acceptance criteria, validate outcomes, and encode taste into tooling. Agents execute, iterate, and maintain.

## 11. Agent Legibility

Code and configuration should be easy for agents to parse and act on. Prefer descriptive naming over clever abbreviations. Explicit is better than implicit. Use structured data (tables, typed configs) over free-form prose when encoding rules. Colocate related code and docs. Follow predictable, consistent patterns so agents can generalize from examples.
