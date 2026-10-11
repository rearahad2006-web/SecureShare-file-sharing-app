---
name: Vite dependency optimizer cache
description: A development-only stale dependency bundle can outlive package version changes.
---

After changing a frontend package version, Vite may keep serving a pre-optimized dependency bundle from the artifact's `node_modules/.vite` cache even when the installed package and lockfile have the new version.

**Why:** A SecureShare React/React DOM upgrade appeared complete in the installed packages but the browser still loaded the previously optimized React DOM version until the cache was cleared.

**How to apply:** If a runtime version mismatch persists after dependencies are aligned, clear only that artifact's Vite optimizer cache and restart its workflow before changing package versions again.
