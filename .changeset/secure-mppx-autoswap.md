---
'mppx': patch
---

Limited automatic swaps to the missing balance and bounded spending independently of DEX quotes. Added an explicit maxAmountIn budget for non-parity token pairs; defaults assume 1:1 token units plus slippage. Sponsored charge validation now accepts partial acquisition up to the payment amount.
