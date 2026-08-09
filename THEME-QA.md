# Theme QA — what to check before calling a skin done

A theme is not a palette. Every time PUMMA has been reskinned, the same
handful of things broke, and always for the same reason: **a token or a
utility that meant one thing in the old theme means something else in the
new one, and whatever leaned on the old meaning goes silently wrong.**

Nothing here is theoretical. Every item is something that actually shipped
broken during the 1998 and Frutiger Aero passes.

Work top to bottom. Do not skip §1 — most of the rest is downstream of it.

---

## 1. Tokens that do two jobs

The single biggest source of breakage. Before changing any token, grep for
**every** utility that reads it.

| Token | Used as background | Used as text/border | Trap |
|---|---|---|---|
| `--bg` | `bg-background` | `text-background` | Making it transparent to reveal a gradient blanks every white-on-dark label — buttons, chips, selected days |
| `--border` | `bg-border` (skeleton rows!) | `border-border` | Translucent white is invisible on a white panel: placeholder rows vanish and checkboxes lose their outline |
| `--ink` | `bg-ink` (dark chips) | `text-ink` | A dark chip is fine on paper, wrong in a sky |
| `--surface` | panels | — | Going translucent needs `backdrop-filter` or it looks dirty, not glassy |
| `--shadow` | `shadow-[2px_2px_0_…]` | — | Opaque = hard 90s shadow, translucent = soft modern one. Same utility, opposite look |

**Check:** for each token you changed, list its background uses and its
text/border uses separately. If both exist, they need separate treatment.

- [ ] Every changed token audited for dual use
- [ ] `bg-border` placeholders still visible on every surface they sit on
- [ ] Checkbox / radio / input outlines still visible (they use `border-border`)
- [ ] White-on-dark labels still legible (they use `text-background`)

## 2. Contrast, measured not eyeballed

- [ ] Body text on every surface ≥ 4.5:1
- [ ] `--muted` and `--faint` on **glass** — translucency lowers effective
      contrast; placeholder text ("Add notes, context, links…") is the usual
      casualty
- [ ] Text on **coloured** surfaces (sunset card, coloured header bars,
      primary buttons) — these carry their own colours chosen for the *old*
      background. A muted grey picked for a black card disappears on amber
- [ ] Disabled states still readable as disabled, not invisible
- [ ] Focus rings visible against the new background

## 3. Both themes, every time

Dark mode is not a variant, it is a second theme that breaks independently.

- [ ] Every gloss / sheen / highlight is **theme-aware**. Hardcoded
      `rgba(255,255,255,…)` overlays are correct on light and destroy dark —
      they wash panels out and swallow the text
- [ ] Dark surfaces get their own overlay values, not the light ones
- [ ] Both themes checked on *every* page below, not just home
- [ ] Toggle between them without reloading and look for stuck colours

## 4. Borders

- [ ] Borders visible on **every** surface they sit on — panel, glass, card,
      coloured header, modal
- [ ] Borders inherited from the previous theme removed (a hard black
      hairline is right for 1998 and wrong for glass)
- [ ] Nested borders don't double up into a 2px seam
- [ ] Dividers between sibling controls still read as dividers

## 5. Radius and clipping

Forcing a radius globally is the fastest way to break layout that was built
around a different one.

- [ ] Parent radius ≥ child radius, or the child's corners poke out
- [ ] Anything that must clip has `overflow: hidden` — header strips that
      bleed to a panel edge need the panel to clip them
- [ ] A header bar's top corners match the panel's, exactly
- [ ] Content beside a rounded element still aligns — pagination arrows next
      to a rounded title strip end up visually detached
- [ ] Circles stay circles (avatars, dots, rings). A global squaring sweep
      must exempt `rounded-full`
- [ ] Inputs, selects and date pickers — these often keep native styling and
      look wrong at an unexpected radius

## 6. Shadows and depth

- [ ] Shadow weight matches the surface: a heavy drop shadow on a small card
      in a dense column reads as clutter
- [ ] Shadow **colour** matches the theme (neutral black on paper, tinted on
      a coloured ground)
- [ ] Shadows on coloured surfaces don't muddy them
- [ ] Hover lift doesn't cause a scrollbar or overlap a neighbour
- [ ] Stacked elements (modal over card over panel) still read in order

## 7. Density and rhythm

- [ ] Padding added by the theme (a header strip, a bigger radius) hasn't
      pushed content out of its container
- [ ] Rows that were flush still align across columns
- [ ] Nothing that was one line is now two
- [ ] Long content still truncates where it did

## 8. Interactive states — all of them

For every control type: default, hover, focus, active, disabled, selected,
loading, error.

- [ ] Selected state distinguishable from hover
- [ ] Active/pressed feedback exists and causes **no layout shift** (transform
      only, never margin or border-width)
- [ ] Keyboard focus is visible everywhere, including on glass
- [ ] Toggles and switches read as on/off at a glance

## 9. Data visualisation

Charts and grids encode meaning in colour and lose it fastest.

- [ ] Every series still distinguishable from its neighbours
- [ ] The life calendar's lived / ahead / current-week states are three
      clearly different things (this one goes flat every single time)
- [ ] Habit heat levels remain ordered and readable
- [ ] Progress fill contrasts with its own track
- [ ] Semantic colours still mean what they meant (tasks / habits / goals /
      projects / notes)

## 10. Every page, both themes

- [ ] Home
- [ ] Tasks (list + detail pane, empty state)
- [ ] Projects (board + detail pane)
- [ ] Habits
- [ ] Goals
- [ ] Notes (list + editor)
- [ ] Calendar
- [ ] Life calendar — **and** its full-view mode, which is a different layout
- [ ] Assistant (idle, running, result)
- [ ] Settings — long forms, native inputs, toggles
- [ ] Login / register
- [ ] Modals, popovers, toasts, context menus
- [ ] Empty states and loading skeletons

## 11. Responsive

- [ ] 375px — no horizontal overflow, on every page
- [ ] 768px
- [ ] 1280px and 1440px
- [ ] Mobile drawer / bottom nav
- [ ] Theme's larger radii don't break tight mobile layouts

## 12. Motion

- [ ] Nothing animates that shouldn't (a page shouldn't shimmer at rest)
- [ ] Animations don't fight each other in the same view
- [ ] Fade-ins never gate **visibility** on an animation completing — a
      paused animation must not leave content invisible. Opacity belongs to
      state, movement belongs to the keyframes
- [ ] `prefers-reduced-motion` respected where the app already respects it

## 13. One utility, two kinds of element

`bg-surface` means "a panel" on a panel and "a control" on a `<select>`.
Anything you attach to the utility lands on both.

- [ ] Panel treatments (a long sheen, a drop shadow, a hover lift) are not
      reaching small controls. A 90px sheen on a 30px-tall select makes the
      control and its ground the same white and the text sits on nothing
- [ ] Raised vs sunken is deliberate: buttons raise, inputs and tick boxes
      sink. A tick box handed the button face reads as already ticked
- [ ] The selector that exempts a control class is one the app actually uses
      consistently — here every tick box carries `border-[1.8px]`

## 14. Colours set inline, in `style`

A class rule cannot reach `style={{ background: "var(--border)" }}`. If a
token's meaning changes, every inline `var()` use of it changes silently.

- [ ] `grep` for `var(--` inside `style={{` and check each one still means
      what it meant. A hairline token used as a swatch disappears, and the
      label beside it loses its indent — that's a component fix, not a theme
      fix

## 15. Mechanics, so it stays reversible

- [ ] The whole theme is **one scoped block**, deletable in one move
- [ ] Rules scoped under a theme class so two themes can coexist and be
      swapped by changing one word
- [ ] No component edited purely for style — if a component had to change,
      the theme hook was in the wrong place
- [ ] Nothing structural changed: same elements, same order, same words

---

## The five-minute pass

When there is no time for the full list:

1. Toggle dark mode. Look at one dense page.
2. Find every placeholder, disabled control and checkbox — are they visible?
3. Hover and press one of each control type.
4. Open the life calendar in full view.
5. Resize to 375px.

That catches most of it.
