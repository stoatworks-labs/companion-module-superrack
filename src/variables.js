// The fixed variables, plus one name per rack SuperRack has listed, so a button
// can carry a rack's name and keep it when the rack is renamed in SuperRack.
// setVariableDefinitions takes an object keyed by variable id, not an array.

import { describeLink } from "./state.js";

export default function UpdateVariableDefinitions(self) {
  const defs = {
    link: { name: "Link to SuperRack (or where commands go, through Remora)" },
    mode: { name: "How SuperRack is reached (Direct / Through Remora)" },
    superrack: { name: "SuperRack's own name for itself (Direct)" },
    peer: { name: "SuperRack's address (Direct)" },
    rack_count: { name: "Racks SuperRack has listed (Direct)" },
    rack_number: {
      name: "Rack SuperRack is on, from 1, as far as this module knows (Direct)",
    },
    rack_name: {
      name: "Name of the rack SuperRack is on, as far as this module knows (Direct)",
    },
    last_result: { name: "SuperRack's last answer to a command (Direct)" },
    last_error: { name: "SuperRack's last refusal (Direct)" },
  };
  for (const r of self.state.racks) {
    defs[`rack_${r.index + 1}_name`] = {
      name: `Rack ${r.index + 1}'s name (Direct)`,
    };
  }
  self.setVariableDefinitions(defs);
}

export function variableValues(self) {
  const s = self.state;
  const link = s.link ?? { kind: "stopped" };
  const shown =
    s.position === null ? null : s.racks.find((r) => r.index === s.position);
  const values = {
    link: describeLink(link),
    mode: self.mode === "remora" ? "Through Remora" : "Direct",
    superrack: link.kind === "connected" ? link.name : "",
    peer:
      link.kind === "connected" || link.kind === "handshaking" ? link.peer : "",
    rack_count: s.racks.length,
    rack_number: shown ? shown.index + 1 : "",
    rack_name: shown ? shown.name : "",
    last_result: s.lastResult,
    last_error: s.lastError,
  };
  for (const r of s.racks) values[`rack_${r.index + 1}_name`] = r.name;
  return values;
}
