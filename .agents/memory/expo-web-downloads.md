---
name: Expo web downloads
description: Browser-compatible file download behavior for Expo apps
---

Expo FileSystem’s modern `downloadFileAsync` implementation is not available on web. Browser downloads need a normal `fetch`, a Blob URL, and a temporary anchor element with a download filename.

**Why:** The native download path failed silently in the browser while the API conversion itself was working.

**How to apply:** Branch on `Platform.OS === "web"` before using Expo FileSystem; keep native downloads on FileSystem plus Sharing.