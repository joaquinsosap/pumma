/**
 * Every icon in the app comes from here.
 *
 * The 51 call sites used to import straight from `lucide-react`, which meant
 * changing the icon set was a 51-file edit. Now it is this file: swap what a
 * name points at and everywhere follows.
 *
 * Names, props and sizes are lucide's, so nothing at a call site knows which
 * icons are drawn and which are lucide's — the drawn ones take `className`
 * and their colour from `currentColor` exactly the same way.
 *
 * The drawn set is in ./glyphs. It grows; the re-exports below shrink to
 * match. An icon still coming from lucide is one nobody has drawn yet, not a
 * decision.
 */
export {
  ArrowLeftGlyph as ArrowLeft,
  AssistantGlyph as Sparkles,
  CalendarGlyph as Calendar,
  CalendarGlyph as CalendarDays,
  GoalsGlyph as Target,
  HabitsGlyph as CircleCheck,
  HabitsGlyph as CheckCircle2,
  HomeGlyph as Home,
  HomeGlyph as House,
  LifeCalendarGlyph as Hourglass,
  NotesGlyph as StickyNote,
  NotesGlyph as FileText,
  ProjectsGlyph as Folder,
  ProjectsGlyph as FolderKanban,
  TasksGlyph as ListTodo,
  TasksGlyph as ListChecks,
  CheckGlyph as Check,
  ChevronDownGlyph as ChevronDown,
  ChevronLeftGlyph as ChevronLeft,
  ChevronRightGlyph as ChevronRight,
  CloseGlyph as X,
  EnterGlyph as EnterKey,
  PencilGlyph as Pencil,
  PlayGlyph as Play,
  PlusGlyph as Plus,
  SearchGlyph as Search,
  TrashGlyph as Trash2,
  HomeTile,
  TasksTile,
  NotesTile,
  HabitsTile,
  GoalsTile,
  ProjectsTile,
  CalendarTile,
  LifeCalendarTile,
  AssistantTile,
} from "./glyphs";

export {
  ArrowUpDown,
  Briefcase,
  GripVertical,
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
  Link2,
  LogOut,
  Minus,
  Moon,
  MoreHorizontal,
  MousePointerClick,
  Plug,
  RefreshCw,
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
