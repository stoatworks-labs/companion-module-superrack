export function defaultState() {
  return {
    /** The link as the backend last reported it: see describeLink. */
    link: { kind: "stopped" },
    racks: [],
    /** The rack index SuperRack last landed on for this module, or null. */
    position: null,
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
      return `Sending to Remora at ${link.host}:${link.port}`;
    default:
      return "Stopped";
  }
}
