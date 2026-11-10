// Brings a just-added card onto the board: the others make room, the card
// flies down from the capture bar, and it glows for a moment where it landed.
//
// Done by hand on the DOM rather than in React state, because none of it is
// state. The card is already in the list by the time this runs; this only
// decides how its first second looks, and leaves nothing behind.

const FLIGHT_MS = 460;
const ROOM_MS = 260;
const LANDED_CLASS = "kanban-card--landed";
const GLOW_MS = 1900;

export function landCard(card: HTMLElement, from: DOMRect | null): void {
  const shell = card.firstElementChild as HTMLElement | null;
  if (!shell) return;
  card.scrollIntoView({ block: "nearest", inline: "nearest" });

  const glow = () => {
    shell.classList.add(LANDED_CLASS);
    window.setTimeout(() => shell.classList.remove(LANDED_CLASS), GLOW_MS);
  };
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || typeof card.animate !== "function") {
    glow();
    return;
  }

  // Measured before anything moves: this is where the card will end up.
  const to = card.getBoundingClientRect();

  // The others make room. A flex item will not shrink below its content
  // unless it clips, so it clips while the slot opens.
  card.style.overflow = "hidden";
  card.style.minHeight = "0";
  const room = card.animate(
    [{ height: "0px" }, { height: `${to.height}px` }],
    { duration: ROOM_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
  const unclip = () => {
    card.style.overflow = "";
    card.style.minHeight = "";
  };
  room.finished.then(unclip, unclip);

  // With no bar to come from, the card simply appears in the room made for it.
  if (!from) {
    shell.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: ROOM_MS,
      easing: "ease-out",
    });
    window.setTimeout(glow, ROOM_MS);
    return;
  }

  // The flight is a copy of the card, fixed over the page: the real one sits
  // inside a scrolling column and would be clipped the moment it left it.
  const ghost = shell.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    margin: "0",
    zIndex: "90",
    pointerEvents: "none",
    transformOrigin: "top left",
    boxShadow: "0 10px 24px var(--shadow)",
    willChange: "transform, opacity",
  });
  shell.style.opacity = "0";
  document.body.appendChild(ghost);

  const dx = from.left - to.left;
  const dy = from.top - to.top;
  // Transform and opacity only, so the flight runs off the main thread and
  // does not wait for the page to finish drawing the refreshed list.
  const flight = ghost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(0.7)`, opacity: 0.85 },
      { opacity: 1, offset: 0.25 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
    ],
    { duration: FLIGHT_MS, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
  );
  const land = () => {
    ghost.remove();
    shell.style.opacity = "";
    glow();
  };
  flight.finished.then(land, land);
}
