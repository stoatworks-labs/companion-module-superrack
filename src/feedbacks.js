// What this module knows comes only from SuperRack's answers over ProLink, so
// every feedback here stays dark Through Remora: Remora's OSC answers nothing.
//
// "Rack is shown" is the rack SuperRack last landed on for THIS module: a rack
// it showed, or a Next/Previous Rack from one it knew, each confirmed by
// SuperRack's ResultCommand. A mouse click on a rack in SuperRack, or another
// console moving it, isn't seen, because ProLink reports no current rack. So
// the feedback goes dark whenever the position is unknown rather than guess.

import { rackOption } from "./actions.js";
import { findRack, parseRackField } from "./racks.js";

export default function UpdateFeedbacks(self) {
  self.setFeedbackDefinitions({
    connected: {
      type: "boolean",
      name: "SuperRack is connected (Direct)",
      description:
        "Lights while SuperRack's ProLink controller is connected to this module. Always dark Through Remora.",
      defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
      options: [],
      callback: () => self.backend?.connected === true,
    },
    rackShown: {
      type: "boolean",
      name: "Rack is shown (Direct)",
      description:
        "Lights while SuperRack is on this rack, as far as this module knows: the rack it last showed or stepped to, confirmed by SuperRack. A click in SuperRack itself isn't seen.",
      defaultStyle: { bgcolor: 0x00aa00, color: 0xffffff },
      options: [rackOption(self)],
      callback: (feedback) => {
        const pos = self.state.position;
        if (pos === null || pos === undefined) return false;
        const r = findRack(
          parseRackField(feedback.options.rack),
          self.state.racks,
        );
        return r !== null && r.index === pos;
      },
    },
    recentError: {
      type: "boolean",
      name: "SuperRack refused a command (Direct)",
      description:
        "Lights for a while after SuperRack answers a command with an error, e.g. a channel no rack takes.",
      defaultStyle: { bgcolor: 0xcc0000, color: 0xffffff },
      options: [
        {
          id: "seconds",
          type: "number",
          label: "For how long (seconds)",
          default: 5,
          min: 1,
          max: 600,
        },
      ],
      callback: (feedback) => {
        const at = self.state.lastErrorAt;
        const secs = Number(feedback.options.seconds) || 5;
        return at > 0 && Date.now() - at <= secs * 1000;
      },
    },
  });
}
