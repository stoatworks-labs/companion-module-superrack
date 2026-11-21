export function defaultState() {
  return {
    /** The link as the backend last reported it: see describeLink. */
    link: { kind: "stopped" },
    racks: [],
    /** The rack index SuperRack is on as far as this module knows, or null. */
    position: null,
    /**
     * How that is known, in Remora's words (its README, "Remora's state"):
     * "reported" (SuperRack answered a ShowRack), "seen" (Remora read SuperRack's
     * window), "counted" (steps counted from a known rack: nothing came back to
     * say where they landed), "sent" (a command went, unanswered), or null.
     */
    positionHow: null,
    /** The rack's name as Remora gave it, for when its rack list is empty. */
    positionName: "",
    /** Remora's Follow: true, false, or null when unknown. */
    follow: null,
    lastResult: "",
    lastError: "",
    lastErrorAt: 0,
  };
}

/** A line for the status column and the `link` variable. */
export function describeLink(link) {
  switch (link.kind) {
    case "listening":
      return `Waiting for SuperRack on TCP ${link.port}`;
    case "handshaking":
      return `SuperRack at ${link.peer} is connecting`;
    case "connected":
      return `Connected to ${link.name} at ${link.peer}`;
    case "failed":
      return link.why;
    case "remora":
      return describeRemora(link);
    default:
      return "Stopped";
  }
}

function describeRemora(link) {
  const at = `Remora at ${link.host}:${link.port}`;
  switch (link.feed) {
    case "live": {
      if (link.problem) return `${at}: ${link.problem}`;
      const what = link.hostLink?.text || link.product || link.hostId;
      return what ? `${at}: ${what}` : at;
    }
    case "waiting":
      return `Sending to ${at}, asking for its state on UDP ${link.statePort}`;
    case "silent":
      return `Sending to ${at}; no state from it on UDP ${link.statePort}`;
    case "failed":
      return `Sending to ${at}; ${link.why}, so no state from it`;
    default:
      return `Sending to ${at}`;
  }
}
