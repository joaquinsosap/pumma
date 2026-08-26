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
import {
  createTask, createNote, createProject, createGoal, createHabit, createMeeting,
  updateTask, completeTask, updateNote, updateProject, updateGoal, updateHabit,
  updateMeeting, logHabit, setGoalProgress,
} from "@/lib/mcp/tools/write";
import {
  deleteTask, deleteNote, deleteGoal, deleteHabit, deleteMeeting, deleteProject,
} from "@/lib/mcp/tools/delete";

export const MCP_TOOLS = [
  getOverview,
  listTasksTool,
  getTaskTool,
  listProjectsTool,
  listGoalsTool,
  listHabitsTool,
  listNotesTool,
  getAgenda,
  createTask,
  createNote,
  createProject,
  createGoal,
  createHabit,
  createMeeting,
  updateTask,
  completeTask,
  updateNote,
  updateProject,
  updateGoal,
  updateHabit,
  updateMeeting,
  logHabit,
  setGoalProgress,
  deleteTask,
  deleteNote,
  deleteGoal,
  deleteHabit,
  deleteMeeting,
  deleteProject,
];
