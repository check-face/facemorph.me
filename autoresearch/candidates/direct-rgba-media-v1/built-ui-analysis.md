# Paired built-UI screen — 10 October 2026

[Successful campaign 38036307932](https://github.com/check-face/facemorph.me/actions/runs/38036307932) compares exact qualified `e0b2192` and `bce3204` artifacts. [Raw report](ci-built-ui.json) · [descriptive statistics](built-ui-analysis.json) · [analysis recipe](analyze-built-ui.py).

Ubuntu 24.04 hosted CPU (processor model not recorded), headless Chrome 155 / Playwright 1.55, visible isolated persistent profiles reopened each visit; fixed discarded warmup per side, then ABBA ×3, six matched cases per side. Model bytes and photo assets are retained. Pinned local runtime mirror; this is not a network benchmark. Webdriver remains true; ordinary-user admission is explicitly emulated. Artifact receipts, source hashes, fixture hashes, input hashes, order and load are retained in the raw report.

| Journey / observable finish | Control median | Candidate median | Median matched change | Faster cases |
| --- | --- | --- | --- | --- |
| Navigation → first decoded restored 1024px original | 483.24 ms | 501.16 ms | +2.44% | 0/6 |
| First new face after browser reopen; retained model bytes | 5,180.35 ms | 5,124.33 ms | -0.48% | 5/6 |
| Next different face in the session | 3,858.22 ms | 3,851.20 ms | -0.27% | 3/6 |
| First Save after both faces; browser download complete | 108.63 ms | 202.17 ms | +83.76% | 0/6 |
| Same original requested again | 113.00 ms | 88.76 ms | -31.06% | 6/6 |
| Repeat Save of the prepared file | 100.72 ms | 66.49 ms | -38.53% | 6/6 |
| New 32-frame / 16 FPS / 1024px decoded playable video | 113,043.07 ms | 113,403.66 ms | +0.27% | 1/6 |
| First metadata-free RGB-offset photo after reopen | 28,380.69 ms | 28,445.41 ms | -0.02% | 3/6 |
| Next different RGB-offset photo; encoder required | 24,745.07 ms | 24,808.69 ms | +0.13% | 1/6 |
| Save reconstructed photo; browser download complete | 114.23 ms | 210.36 ms | +83.69% | 0/6 |

Matched change is the median of the six candidate-minus-control percentages; it is not the ratio of the two pooled medians. These are descriptive fixed-screen results, not population percentiles, current-user latency or physical-device estimates. Drawn/decoded-and-idle is not compositor paint; decoded playable media is not OS sharing.

## Download sizes

| Download | Control median | Candidate median |
| --- | --- | --- |
| First Save after both faces; browser download complete | 4,384,042 B | 117,428 B |
| Repeat Save of the prepared file | 4,384,042 B | 117,428 B |
| Save reconstructed photo; browser download complete | 4,380,149 B | 129,905 B |

Sizes include recovery metadata. Download completion includes the browser handoff and file generation, excludes OS/recipient delivery. The first Save occurs after both faces have generated; it is not an immediate-after-first-display file-ready measurement. Exact Chrome product qualification separately checks WebP recovery and repeated-file reuse.

## Stage interpretation and limits

Photo inputs are deterministic RGB-offset versions of one public face, encoded outside timing. Both sides use the same pixels per case; first/next variants differ and execute the encoder. The warp/padding path is content-dependent and can differ by orders of magnitude between cases. Do not treat a pooled photo or warp median as typical real-photo performance. Full per-case timings and inputs remain in the reports.

Worker events lack request IDs and may overlap resumed background admission. Stage figures are exploratory timestamp spans or worker-reported totals; they cannot be added or subtracted to attribute the UI total. No isolated synthesis speed claim follows from this trace. Internal memory/surfaces, physical-device budgets, OS sharing, FFmpeg-specific speed and varied real-photo quality remain unmeasured.

The [earlier timeout](built-ui-timeout.json) is inconclusive and is not merged with this fresh campaign. Numerical kernels are unchanged; seven original canaries plus synthetic raw/canonical agreement and the separate shipping checks do not constitute a new fixed-full31 qualification.
