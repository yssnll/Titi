---
name: OpenAPI URI schemas
description: Compatibility note for OpenAPI code generation and the workspace's Zod version.
---

When adding URL query parameters to the OpenAPI contract, use a plain string schema if the generated Zod package is on Zod 3; the URI format currently generates `zod.url()`, which only exists in newer Zod APIs.

**Why:** Code generation can succeed while the generated library typecheck fails on the unsupported validator method.

**How to apply:** Keep URL validation explicit in the route handler with the platform `URL` class and protocol/host checks, then run API codegen and the library typecheck before wiring the client.