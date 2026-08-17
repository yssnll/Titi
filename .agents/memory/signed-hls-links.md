---
name: Signed HLS links
description: Provider URL semantics for temporary HLS playlists
---

Temporary HLS providers may encode `s` as the issue/start Unix timestamp and `e` as a validity duration in seconds, rather than encoding `s` as the expiration timestamp. Treating `s` alone as expiry rejects otherwise-valid links immediately.

**Why:** A supplied playlist had a recent `s` value and `e=43200`; interpreting `s` as the expiry made the player reject it before contacting the source.

**How to apply:** When validating signed HLS URLs, prefer `s + e` when `e` is a duration, while still supporting providers that use an absolute `e` timestamp.