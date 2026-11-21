// Variable references in preset text use `self.label`, the CONNECTION's label,
// not the module id, so a renamed connection or a second one still renders.
//
// The per-rack presets show a rack by its NUMBER and label it with that rack's
// name variable, so the button always says what it will do: rename a rack in
// SuperRack and the label follows; reorder the racks and both follow the new
// rack in that place. Until ProLink has listed racks (and always Through
// Remora, which lists none), a bank of racks 1–8 by number stands in.
//
// base 2.x takes presets as (structure, definitions), each definition
// `type: 'simple'`. A 1.x `category` field loads but the presets never appear.

const WHITE = 0xffffff;
const GREY = 0x333333;
const GREEN = 0x00aa00;
const DARKGREEN = 0x006600;
const BLUE = 0x0055aa;
const RED = 0xcc0000;
const AMBER = 0xcc7a00;

function preset({
  name,
  text,
  size = "14",
  bgcolor = GREY,
  actions = [],
  feedbacks = [],
}) {
  return {
    type: "simple",
    name,
    style: { text, size, color: WHITE, bgcolor, show_topbar: false },
    steps: [{ down: actions, up: [] }],
    feedbacks,
  };
}

const act = (actionId, options = {}) => ({ actionId, options });

export default function UpdatePresets(self) {
  const L = self.label;
  const direct = self.mode !== "remora";
  const presets = {};

  // --- Navigate -------------------------------------------------------------
  presets.previous_rack = preset({
    name: "Previous rack",
    text: "◀ RACK",
    size: "18",
    bgcolor: BLUE,
    actions: [act("previousRack")],
  });
  presets.next_rack = preset({
    name: "Next rack",
    text: "RACK ▶",
    size: "18",
    bgcolor: BLUE,
    actions: [act("nextRack")],
  });
  presets.previous_plugin = preset({
    name: "Previous plug-in",
    text: "◀ PLUG-IN",
    bgcolor: BLUE,
    actions: [act("previousPlugin")],
  });
  presets.next_plugin = preset({
    name: "Next plug-in",
    text: "PLUG-IN ▶",
    bgcolor: BLUE,
    actions: [act("nextPlugin")],
  });
  presets.rack_page = preset({
    name: "Open the Rack page",
    text: "RACK\nPAGE",
    actions: [act("rackPage")],
  });
  presets.overview = preset({
    name: "Back to the overview",
    text: "OVER\nVIEW",
    actions: [act("overview")],
  });
  presets.refresh = preset({
    name: direct ? "Refresh the rack list" : "Resync",
    text: direct ? "REFRESH\nRACKS" : "RESYNC",
    actions: [act("refresh")],
  });

  // --- Racks ----------------------------------------------------------------
  const listed = direct ? self.state.racks : [];
  const numbers =
    listed.length > 0
      ? listed.map((r) => r.index + 1)
      : [1, 2, 3, 4, 5, 6, 7, 8];
  const rackIds = [];
  for (const n of numbers) {
    const id = `rack_${n}`;
    rackIds.push(id);
    presets[id] = preset({
      name:
        listed.length > 0
          ? `Show rack ${n} (${listed.find((r) => r.index + 1 === n)?.name})`
          : `Show rack ${n}`,
      text: listed.length > 0 ? `$(${L}:rack_${n}_name)` : `RACK\n${n}`,
      size: listed.length > 0 ? "auto" : "18",
      actions: [act("showRack", { rack: String(n) })],
      feedbacks: direct
        ? [
            {
              feedbackId: "rackShown",
              options: { rack: String(n) },
              style: { bgcolor: GREEN, color: WHITE },
            },
          ]
        : [],
    });
  }

  // --- Remora ---------------------------------------------------------------
  presets.follow_toggle = preset({
    name: "Follow the desk: toggle",
    text: "FOLLOW",
    size: "18",
    bgcolor: AMBER,
    actions: [act("follow", { mode: "toggle" })],
  });
  presets.follow_on = preset({
    name: "Follow the desk: on",
    text: "FOLLOW\nON",
    actions: [act("follow", { mode: "on" })],
  });
  presets.follow_off = preset({
    name: "Follow the desk: off",
    text: "FOLLOW\nOFF",
    actions: [act("follow", { mode: "off" })],
  });
  presets.send_cc = preset({
    name: "Send a CC (edit the number)",
    text: "CC 30",
    size: "18",
    actions: [act("sendCC", { cc: 30, value: 127 })],
  });

  // --- Status ---------------------------------------------------------------
  presets.status = preset({
    name: "Link to SuperRack",
    text: `$(${L}:link)`,
    size: "7",
    bgcolor: direct ? RED : GREY,
    feedbacks: direct
      ? [
          {
            feedbackId: "connected",
            options: {},
            style: { bgcolor: DARKGREEN, color: WHITE },
          },
        ]
      : [],
  });
  presets.current_rack = preset({
    name: "The rack SuperRack is on, as far as this module knows",
    text: `$(${L}:rack_number)\n$(${L}:rack_name)`,
    size: "auto",
  });
  presets.last_error = preset({
    name: "SuperRack's last refusal",
    text: `$(${L}:last_error)`,
    size: "7",
    feedbacks: [
      {
        feedbackId: "recentError",
        options: { seconds: 5 },
        style: { bgcolor: RED, color: WHITE },
      },
    ],
  });

  const structure = [
    {
      id: "navigate",
      name: "Navigate",
      definitions: [
        {
          id: "navigate-main",
          type: "simple",
          name: "Racks, plug-ins and pages",
          presets: [
            "previous_rack",
            "next_rack",
            "previous_plugin",
            "next_plugin",
            "rack_page",
            "overview",
            "refresh",
          ],
        },
      ],
      keywords: ["rack", "plug-in", "plugin", "overview", "next", "previous"],
    },
    {
      id: "racks",
      name: "Racks",
      description:
        listed.length > 0
          ? "One per rack SuperRack has listed, labelled with its name; green while SuperRack is on it."
          : direct
            ? "Racks 1–8 by number until SuperRack connects and lists its racks."
            : "Racks 1–8 by number: Remora's OSC lists no racks, so edit the number (or type a rack's name).",
      definitions: [
        {
          id: "racks-main",
          type: "simple",
          name: "Show a rack",
          presets: rackIds,
        },
      ],
      keywords: ["rack", "show", "select"],
    },
  ];
  if (!direct) {
    structure.push({
      id: "remora",
      name: "Remora",
      description:
        "Follow is Remora's; Send CC goes out on Remora's MIDI port, for SuperRack (MIDI).",
      definitions: [
        {
          id: "remora-main",
          type: "simple",
          name: "Follow and MIDI",
          presets: ["follow_toggle", "follow_on", "follow_off", "send_cc"],
        },
      ],
      keywords: ["remora", "follow", "midi", "cc"],
    });
  }
  structure.push({
    id: "status",
    name: "Status",
    definitions: [
      {
        id: "status-main",
        type: "simple",
        name: "Status",
        presets: direct ? ["status", "current_rack", "last_error"] : ["status"],
      },
    ],
  });

  // Only the presets the structure shows are handed over.
  const shown = new Set(
    structure.flatMap((s) => s.definitions.flatMap((d) => d.presets)),
  );
  self.setPresetDefinitions(
    structure,
    Object.fromEntries(Object.entries(presets).filter(([id]) => shown.has(id))),
  );
}
