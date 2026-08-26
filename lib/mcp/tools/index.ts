/**
 * The tool catalogue.
 *
 * One list, so that registering a tool and gating it cannot come apart: the
 * route iterates this, and every entry came from defineTool, which requires
 * an op class.
 */
import { getOverview, listTasksTool } from "@/lib/mcp/tools/read";
import {
  getTaskTool,
  listProjectsTool,
  listGoalsTool,
  listHabitsTool,
  listNotesTool,
} from "@/lib/mcp/tools/collections";
import { getAgenda } from "@/lib/mcp/tools/agenda";

export const MCP_TOOLS = [
  getOverview,
  listTasksTool,
  getTaskTool,
  listProjectsTool,
  listGoalsTool,
  listHabitsTool,
  listNotesTool,
  getAgenda,
];
