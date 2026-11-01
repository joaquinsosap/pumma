// What a text box holds against what the server holds. Only typing makes text unsaved, so text that came from the server can never be saved back.

export type DraftState = {
  shown: string;
  unsaved: boolean;
  /** What the server holds once everything sent has landed. Null after a failed save, when nobody knows. */
  stored: string | null;
  /** The last value the server sent. */
  server: string;
  /** Text sent whose page can still come back, oldest first. */
  sent: string[];
};

export function draftFrom(server: string): DraftState {
  return { shown: server, unsaved: false, stored: server, server, sent: [] };
}

export function typed(state: DraftState, value: string): DraftState {
  return { ...state, shown: value, unsaved: value !== state.stored };
}

/** The text to send and the state once it has gone, or null when nothing typed is waiting. */
export function send(
  state: DraftState,
): { value: string; state: DraftState } | null {
  if (!state.unsaved) return null;
  const value = state.shown;
  return {
    value,
    state: {
      ...state,
      unsaved: false,
      stored: value,
      sent: [...state.sent, value],
    },
  };
}

/** A page arrived carrying a different value. */
export function fromServer(state: DraftState, value: string): DraftState {
  // Our own page, maybe trimmed by the server. An older one can't move the box: newer text has gone since.
  for (let i = state.sent.length - 1; i >= 0; i--) {
    if (state.sent[i] === value || state.sent[i].trim() === value) {
      return { ...state, server: value, sent: state.sent.slice(i + 1) };
    }
  }
  if (!state.unsaved) return draftFrom(value);
  return {
    ...state,
    server: value,
    stored: value,
    sent: [],
    unsaved: state.shown !== value,
  };
}

/** A save failed: the words stay, and go again the next time the box saves. */
export function sendFailed(state: DraftState, value: string): DraftState {
  const at = state.sent.lastIndexOf(value);
  const sent = state.sent.filter((_, i) => i !== at);
  // Something newer went out or came in, and that is what counts now.
  if (state.stored !== value) return { ...state, sent };
  return { ...state, sent, stored: null, unsaved: true };
}

/** A save was answered. When it is the newest and the page already says the same, no page is coming for it, so nothing is out. */
export function landed(state: DraftState, value: string): DraftState {
  const says = state.server === value || state.server === value.trim();
  return says && state.sent.at(-1) === value ? { ...state, sent: [] } : state;
}

/** Back to what is stored, dropping anything typed. After a failed save that is the server's last word, and it never goes back to the server. */
export function reverted(state: DraftState): DraftState {
  const value = state.stored ?? state.server;
  return { ...state, shown: value, stored: value, unsaved: false };
}

/** Leaving a box that can't be blank: trims what was typed, and blank goes back to what is stored. Text nobody typed stays as the server has it. */
export function committedRequired(state: DraftState): DraftState {
  if (!state.unsaved) return state;
  const trimmed = state.shown.trim();
  if (!trimmed) return reverted(state);
  return trimmed === state.shown ? state : typed(state, trimmed);
}
