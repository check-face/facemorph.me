// Wires the changeover statistics sink (src/analytics/usage-stats.ts) into the product's analytics and runtime
// stages, through the facade rather than a bridge edit. main.tsx imports this before the bridge loads, so the
// sink and its gate are in place before analytics.start() notes the visit. The bridge's own `setStatsSink`
// line passes the same page-wide `record`, and the gate given here is kept.
import { setStatsSink } from '../../src/Next/analytics.mjs';
import { onStage } from '../../src/Next/reporting.mjs';
import {
  configure,
  record,
  recording,
  setUsageStats,
  stage,
  switchState,
  type SwitchState,
} from '../../src/analytics/usage-stats.ts';

// Only a test build clears the automation opt-out; the shipped site is built without this variable.
configure({ allowAutomation: import.meta.env.FACEMORPH_STATS_ALLOW_AUTOMATION === '1' });
setStatsSink(record, recording);
onStage(stage);

export { setUsageStats, switchState, type SwitchState };
