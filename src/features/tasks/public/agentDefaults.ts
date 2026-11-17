/** Host-owned agent defaults: the record shape, its parser and the capability flag. Pure, so
 * the headless Host and the settings store can import it without the settings client. */
export {
  DEFAULT_AGENT_DEFAULTS,
  HOST_BEHAVIOR_DEFAULTS,
  parseAgentDefaults,
  USAGE_LIMIT_FAILOVERS,
  type UsageLimitFailover,
  type AgentDefaults,
  type AgentDefaultsRecord,
} from "../model/hostSettings";
