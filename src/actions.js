// Every action is defined in both modes, so a button keeps its action when the
// connection is switched between Direct and Through Remora. The few that only
// one way can do say so in their name, and log why when pressed the other way.

import { parseRackField } from "./racks.js";

/**
 * The rack dropdown: SuperRack's racks when ProLink or Remora's state feed has
 * listed them, and any
 * name or number typed in. A number (from 1) is the rack's place in SuperRack's
 * list; a name matches loosely ("head1" finds "head 1"). That is the same rule
 * Remora's /remora/rack/select follows, so a button means the same rack either
 * way. A rack whose name is shared or empty, or is "n/a", is offered by number.
 */
export function rackOption(self, label = "Rack") {
  const racks = self.state.racks;
  const seen = new Map();
  for (const r of racks) {
    const k = r.name.trim().toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const choices = racks.map((r) => {
    const k = r.name.trim().toLowerCase();
    const byName =
      k !== "" && k !== "n/a" && seen.get(k) === 1 && !/^\d+$/.test(k);
    return {
      id: byName ? r.name : String(r.index + 1),
      label: `${r.index + 1}. ${r.name || "(no name)"}${r.firstInputChannel < 0 ? " (no input)" : ""}`,
    };
  });
  return {
    id: "rack",
    type: "dropdown",
    label,
    tooltip:
      "Pick one of SuperRack's racks, or type a rack's name or its number in SuperRack's list (from 1).",
    choices,
    default: choices[0]?.id ?? "1",
    allowCustom: true,
    minChoicesForSearch: 8,
  };
}

export default function UpdateActions(self) {
  const b = () => self.backend;
  const plain = (name, description, run) => ({
    name,
    description,
    options: [],
    callback: () => run(),
  });

  self.setActionDefinitions({
    showRack: {
      name: "Show a rack",
      description:
        "Directly: one ShowRack on the rack's first input channel, as a LAWO mc²'s hot-rack key sends it; a rack no input feeds is reached from the nearest one that has one. Through Remora: /remora/rack/select.",
      options: [rackOption(self)],
      callback: (event) => b()?.showRack(parseRackField(event.options.rack)),
    },
    showChannel: {
      name: "Show the rack an input channel feeds (Direct only)",
      description:
        "ShowRack on that channel: SuperRack shows whichever rack the channel feeds. Channels count from 1.",
      options: [
        {
          id: "channel",
          type: "textinput",
          label: "Input channel (from 1)",
          default: "1",
          useVariables: true,
        },
      ],
      callback: (event) => {
        const ch = Number(String(event.options.channel ?? "").trim());
        if (!Number.isInteger(ch) || ch < 1) {
          self.log(
            "warn",
            `"${event.options.channel}" is not an input channel number`,
          );
          return;
        }
        b()?.showChannel(ch);
      },
    },
    nextRack: plain("Next rack", "One rack on in SuperRack's list.", () =>
      b()?.stepRack(1),
    ),
    previousRack: plain(
      "Previous rack",
      "One rack back in SuperRack's list.",
      () => b()?.stepRack(-1),
    ),
    nextPlugin: plain(
      "Next plug-in",
      "Selects the next plug-in in the rack.",
      () => b()?.stepPlugin(1),
    ),
    previousPlugin: plain(
      "Previous plug-in",
      "Selects the previous plug-in in the rack.",
      () => b()?.stepPlugin(-1),
    ),
    rackPage: plain(
      "Open the Rack page",
      "SuperRack's Rack page, on the current rack.",
      () => b()?.openRack(),
    ),
    overview: plain("Back to the overview", "SuperRack's overview page.", () =>
      b()?.overview(),
    ),
    refresh: plain(
      "Refresh the rack list",
      "Directly: asks SuperRack for its racks again (it also sends them when they change). Through Remora: Resync, and asks for Remora's state again.",
      () => b()?.resync(),
    ),
    follow: {
      name: "Follow the desk: on, off or toggle (Through Remora only)",
      description:
        "Switches Remora's Follow, which moves SuperRack with the desk's selection.",
      options: [
        {
          id: "mode",
          type: "dropdown",
          label: "Follow",
          default: "toggle",
          choices: [
            { id: "toggle", label: "Toggle" },
            { id: "on", label: "On" },
            { id: "off", label: "Off" },
          ],
        },
      ],
      callback: (event) => b()?.follow(String(event.options.mode)),
    },
    sendCC: {
      name: "Send a MIDI CC to SuperRack (Through Remora only)",
      description:
        "Remora sends the CC on its MIDI port, for anything MIDI Learned in SuperRack: User Keys, a plug-in's controls, snapshots. Needs Remora's Plug-in Host to be SuperRack (MIDI).",
      options: [
        {
          id: "cc",
          type: "number",
          label: "CC number",
          default: 30,
          min: 0,
          max: 127,
          asInteger: true,
        },
        {
          id: "value",
          type: "number",
          label: "Value",
          default: 127,
          min: 0,
          max: 127,
          asInteger: true,
        },
      ],
      callback: (event) => {
        const n = Number(event.options.cc);
        const v = Number(event.options.value);
        if (
          !Number.isInteger(n) ||
          n < 0 ||
          n > 127 ||
          !Number.isInteger(v) ||
          v < 0 ||
          v > 127
        ) {
          self.log(
            "warn",
            `CC ${event.options.cc} value ${event.options.value} is out of range`,
          );
          return;
        }
        b()?.cc(n, v);
      },
    },
  });
}
