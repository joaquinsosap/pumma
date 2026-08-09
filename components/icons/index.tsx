/**
 * Every icon in the app comes from here.
 *
 * The 51 call sites used to import straight from `lucide-react`, which meant
 * changing the icon set was a 51-file edit. Now it is this file: swap what a
 * name points at and everywhere follows.
 *
 * Names, props and sizes are lucide's, so nothing at a call site knows which
 * icons are drawn and which are lucide's — the Aero ones take `className`
 * and their colour from `currentColor` exactly the same way.
 *
 * The drawn set is in ./aero. It grows; the re-exports below shrink to
 * match. An icon still coming from lucide is one nobody has drawn yet, not a
 * decision.
 */
export {
  AeroAssistant as Sparkles,
  AeroCalendar as Calendar,
  AeroCalendar as CalendarDays,
  AeroGoals as Target,
  AeroHabits as CircleCheck,
  AeroHabits as CheckCircle2,
  AeroHome as Home,
  AeroHome as House,
  AeroLifeCalendar as Hourglass,
  AeroNotes as StickyNote,
  AeroNotes as FileText,
  AeroProjects as Folder,
  AeroProjects as FolderKanban,
  AeroTasks as ListTodo,
  AeroTasks as ListChecks,
} from "./aero";

export {
  ArrowLeft,
  Briefcase,
  CalendarPlus,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Hand,
  Heart,
  HelpCircle,
  KeyRound,
  Layers,
  LogOut,
  Minus,
  Moon,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  Play,
  Plug,
  Plus,
  Repeat,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Star,
  Sun,
  Tag,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
