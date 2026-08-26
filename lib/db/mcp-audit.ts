import * as memory from "./memory/mcp-audit";
import * as mongo from "./mongo/mcp-audit";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const recordMcpCall = impl.recordMcpCall;
// Not React-cached: the settings page wants what happened, including the call
// that is finishing as the page renders.
export const listMcpAudit = impl.listMcpAudit;
export const deleteMcpAudit = impl.deleteMcpAudit;
