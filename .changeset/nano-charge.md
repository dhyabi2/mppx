---
'mppx': patch
---

Added the `nano/charge` payment method (`mppx/nano`, `mppx/nano/client`, `mppx/nano/server`), which verifies a confirmed Nano send block by its hash against a node RPC and accepts each block hash once.
