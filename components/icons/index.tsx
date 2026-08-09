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
  AeroArrowLeft as ArrowLeft,
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
  AeroCheck as Check,
  AeroChevronDown as ChevronDown,
  AeroChevronLeft as ChevronLeft,
  AeroChevronRight as ChevronRight,
  AeroClose as X,
  AeroEnter,
  AeroPencil as Pencil,
  AeroPlay as Play,
  AeroPlus as Plus,
  AeroSearch as Search,
  AeroTrash as Trash2,
} from "./aero";

export {
  Briefcase,
  CalendarPlus,
  CheckSquare,
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
  Plug,
  Repeat,
  Settings,
  SlidersHorizontal,
  Square,
  Star,
  Sun,
  Tag,
  TriangleAlert,
  Zap,
} from "lucide-react";
