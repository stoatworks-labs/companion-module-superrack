// What this module knows comes from SuperRack's answers over ProLink (Direct),
// or from Remora's state feed (Through Remora, when Remora's state target is
// set). Without either, every feedback stays dark rather than guess.
//
// "Rack is shown" is the rack SuperRack is on as far as this module knows, and
// how that is known matters:
//   - reported: SuperRack answered the ShowRack that put it there;
//   - seen: Remora read the rack's name in SuperRack's window;
//   - counted: Next or Previous Rack from a known rack. SuperRack says the step
//     succeeded but not where it landed (Remora calls it the same);
//   - sent: Remora sent a command and nothing answered.
// By default it lights only for the first two. A mouse click on a rack in
// SuperRack isn't seen by either route, so a counted rack can be wrong.

import { rackOption } from "./actions.js";
import { isConfirmed } from "./backends.js";
import { findRack, parseRackField } from "./racks.js";

export default function UpdateFeedbacks(self) {
  self.setFeedbackDefinitions({
    connected: {
      type: "boolean",
      name: "SuperRack is reachable",
      description:
        "Direct: SuperRack's ProLink controller is connected to this module. Through Remora: Remora's state is arriving and Remora reports nothing wrong with SuperRack. Always dark Through Remora without the state feed.",
      defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
      options: [],
      callback: () => self.backend?.connected === true,
    },
    rackShown: {
      type: "boolean",
      name: "Rack is shown",
      description:
        "Lights while SuperRack is on this rack, as far as this module knows. A click in SuperRack's own window isn't seen.",
      defaultStyle: { bgcolor: 0x00aa00, color: 0xffffff },
      options: [
        rackOption(self),
        {
          id: "basis",
          type: "dropdown",
          label: "Light when",
          default: "confirmed",
          choices: [
            {
              id: "confirmed",
              label: "SuperRack confirmed it (reported or seen)",
            },
            {
              id: "any",
              label: "Also when it was only counted or sent",
            },
          ],
        },
      ],
      callback: (feedback) => {
        const pos = self.state.position;
        if (pos === null || pos === undefined) return false;
        if (
          feedback.options.basis !== "any" &&
          !isConfirmed(self.state.positionHow)
        )
          return false;
        const r = findRack(
          parseRackField(feedback.options.rack),
          self.state.racks,
        );
        return r !== null && r.index === pos;
      },
    },
    following: {
      type: "boolean",
      name: "Remora is following the desk (Through Remora)",
      description:
        "Lights while Remora's Follow is on, as its state feed says. Dark when Follow is off or unknown, and always Direct.",
      defaultStyle: { bgcolor: 0x00aa00, color: 0xffffff },
      options: [],
      callback: () => self.state.follow === true,
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
