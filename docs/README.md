# Documentation map

Current entry points:

- [Plan registry](plans/README.md): current proposals, applicable decisions and
  historical plans; start with the [candidate UI plan](plans/candidate-ui-2026-10-10.md).

- [Development](dev/README.md): implementation, setup, verification, and delivery
  from this repo to `next.facemorph.me`.
- [Self-host API](../self-host/README.md) and [API reference](api.md): the historical
  server API and pinned original UI, built locally for CPU or NVIDIA GPU. The
  current `next.facemorph.me` frontend runs inference locally and does not use it.
- [Autoresearch](../autoresearch/README.md): performance objective, experiment loop,
  evidence layout, and first/repeat visit measurements.
- [Round 2 gap review, 10 October](round-2-gap-2026-10-10.md): deployed build and
  local work compared with the feedback, with evidence limits stated.

Implementation references include the [browser runtime](../src/Next/browser/README.md),
[model asset cache](model-asset-cache-implementation.md),
[photo runtime](../photo-runtime/README.md), [hosting](../hosting/next-static/README.md),
and [diagnostics collector](../hosting/next-cloudflare/README.md).
Check these against current source when making a change.

## Dated plans and feedback

These retain requirements, decisions, and historical evidence. Their status labels
and deployment descriptions apply to the date recorded, not automatically to
today's tree or live site. Later explicit operator decisions supersede earlier ones.

- [Round 1 feedback](testing-feedback-round-1.md) and [work order](round-1-work-order.md).
- [Round 2 feedback](testing-feedback-round-2.md) and [work order](round-2-work-order.md).
- [19 September audit](candidate-audit-2026-09-19.md).
- [Round 3 review and operator decisions](round-3-plan-review-2026-09-23.md).
- [September delivery scope](current-delivery-scope.md),
  [hosting plan](delivery-hosting.md), and [trial plan](side-by-side-trial.md).

Older documents may cite plans and reports from a previous workspace that are
absent here. Missing evidence remains missing; a commit message, simulator result,
or component test does not substitute for the required product outcome.
