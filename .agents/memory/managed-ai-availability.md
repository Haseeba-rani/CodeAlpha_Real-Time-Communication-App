---
name: Managed AI availability
description: Account-level constraints can block managed AI provider setup even when the feature is otherwise supported.
---

When managed AI setup returns an account-upgrade requirement, do not retry it in the same build. Request the user's provider key through the secure secrets flow if they want that provider, and keep the product functional without the provider.

**Why:** The provider setup is gated by workspace/account state rather than application code, so repeated setup attempts cannot resolve the blocker and can waste time.

**How to apply:** For AI features, isolate provider access server-side, validate provider responses, and preserve a deterministic fallback for core workflows.