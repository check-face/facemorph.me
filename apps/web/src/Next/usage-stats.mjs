// The candidate's changeover statistics sink now lives, typed and with its definitions unchanged, in
// src/analytics/usage-stats.ts (fm-5yqq); the shell wires it through shell/facade/usage-stats.ts. This name stays
// for the bridge's existing import, so both refer to the one page-wide sink.
export {
  OPT_OUT_KEY,
  ENDPOINT,
  allowed,
  platformClass,
  toStatsEvent,
  createSink,
  record,
} from '../analytics/usage-stats.ts';
