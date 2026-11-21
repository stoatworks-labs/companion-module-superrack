import { InstanceBase, InstanceStatus } from "@companion-module/base";
import { UpgradeScripts } from "./upgrades.js";
import UpdateActions from "./actions.js";
import UpdateFeedbacks from "./feedbacks.js";
import UpdateVariableDefinitions, { variableValues } from "./variables.js";
import UpdatePresets from "./presets.js";
import { ProLinkBackend, RemoraBackend } from "./backends.js";
import { aboutField } from "./about-field.js";
import { defaultState, describeLink } from "./state.js";

export default class ModuleInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.state = defaultState();
    this.backend = null;
    this.racksKey = null;
  }

  async init(config) {
    this.config = config;
    // "SuperRack refused a command" goes dark on a clock, not on a message, so
    // it is re-checked every second while an error is recent enough to matter.
    this.ticker = setInterval(() => {
      const at = this.state.lastErrorAt;
      if (at > 0 && Date.now() - at <= 601000)
        this.checkFeedbacks("recentError");
    }, 1000);
    await this.#startBackend();
  }

  async destroy() {
    clearInterval(this.ticker);
    await this.backend?.stop();
    this.backend = null;
  }

  async configUpdated(config) {
    this.config = config;
    await this.backend?.stop();
    this.backend = null;
    await this.#startBackend();
  }

  get mode() {
    return this.config?.mode === "remora" ? "remora" : "prolink";
  }

  async #startBackend() {
    this.state = defaultState();
    this.racksKey = null;
    this.backend =
      this.mode === "remora"
        ? new RemoraBackend(this)
        : new ProLinkBackend(this);
    this.#definitionsForRacks();
    this.refreshVariableValues();
    await this.backend.start();
  }

  getConfigFields() {
    return [
      {
        type: "static-text",
        id: "info",
        width: 12,
        label: "Two ways to reach SuperRack",
        value:
          "<b>Direct (ProLink)</b>: SuperRack connects to this module as it would to a LAWO mc² desk, lists its racks and answers every command. In SuperRack: Setup › Controllers › + › <b>ProLink LAWO Console Remote</b>, console IP = this Companion machine, port below, then Assign. Its PORT has to be a wired Ethernet adapter.<br><b>Through Remora</b>: commands go to Remora's OSC, and Remora drives SuperRack over MIDI or ProLink and keeps it following the desk. With Remora's state target pointed here, it also says which racks there are, the rack it's on and how it knows, and whether it's following.",
      },
      {
        type: "dropdown",
        id: "mode",
        label: "Reach SuperRack",
        width: 12,
        default: "prolink",
        choices: [
          {
            id: "prolink",
            label: "Direct (ProLink): this module is the console",
          },
          { id: "remora", label: "Through Remora (MIDI or ProLink)" },
        ],
      },
      {
        type: "number",
        id: "prolinkport",
        label: "ProLink port (SuperRack connects here)",
        width: 6,
        min: 1,
        max: 65535,
        asInteger: true,
        default: 50002,
        isVisibleExpression: "$(options:mode) != 'remora'",
      },
      {
        type: "textinput",
        id: "consolename",
        label: "Console name SuperRack is given",
        width: 6,
        default: "Companion",
        isVisibleExpression: "$(options:mode) != 'remora'",
      },
      {
        type: "static-text",
        id: "prolinkinfo",
        width: 12,
        label: "",
        value:
          "SuperRack dials once when you press Assign: start this connection first. One SuperRack at a time. Remora uses the same port when its Plug-in Host is SuperRack (ProLink), so on Remora's Mac pick Through Remora instead, or another port. When you stop using this, clear the controller's assignment in SuperRack, or it keeps redialling.",
        isVisibleExpression: "$(options:mode) != 'remora'",
      },
      {
        type: "textinput",
        id: "remorahost",
        label: "Remora's Mac",
        tooltip: "IPv4 address or hostname of the Mac running Remora",
        width: 6,
        default: "127.0.0.1",
        isVisibleExpression: "$(options:mode) == 'remora'",
      },
      {
        type: "number",
        id: "remoraport",
        label: "Remora's OSC port",
        width: 6,
        min: 1,
        max: 65535,
        asInteger: true,
        default: 9020,
        isVisibleExpression: "$(options:mode) == 'remora'",
      },
      {
        type: "number",
        id: "remorastateport",
        label: "Port for Remora's state (0 = off)",
        tooltip:
          "UDP port on this machine that Remora's state comes to. In Remora: Settings › Companion › Remora's state, with this machine's address and this port.",
        width: 6,
        min: 0,
        max: 65535,
        asInteger: true,
        default: 9021,
        isVisibleExpression: "$(options:mode) == 'remora'",
      },
      {
        type: "static-text",
        id: "remorainfo",
        width: 12,
        label: "",
        value:
          "Remora listens for OSC on UDP 9020 unless it's been changed in its settings. For feedback, set Remora's state target (Settings › Companion › Remora's state) to this machine (127.0.0.1 on the same Mac) and the port above; it's off until you do. Send CC and Follow work only this way; Show the rack for a channel works only Direct.",
        isVisibleExpression: "$(options:mode) == 'remora'",
      },

      // Vendored from stoatworks-backend/about. A Companion module has no
      // UI of its own, so this config panel is the only surface it has.
      aboutField(),
    ];
  }

  // --- what the backend reports -------------------------------------------

  onLink(link) {
    this.state.link = link;
    switch (link.kind) {
      case "connected":
        this.updateStatus(InstanceStatus.Ok, describeLink(link));
        break;
      case "remora":
        this.#remoraStatus(link);
        break;
      case "failed":
        this.updateStatus(
          InstanceStatus.ConnectionFailure,
          `${link.why}. Is Remora on this machine with SuperRack (ProLink)? Use Through Remora, or another port.`,
        );
        break;
      default:
        this.updateStatus(InstanceStatus.Connecting, describeLink(link));
    }
    if (link.kind !== "connected" && link.kind !== "remora") {
      this.state.racks = [];
      this.#definitionsForRacks();
    }
    this.refreshVariableValues();
    this.checkFeedbacks("connected", "rackShown");
  }

  #remoraStatus(link) {
    const text = describeLink(link);
    switch (link.feed) {
      case "live":
        // Remora is there. Whether it can reach SuperRack is its own report.
        if (link.problem || link.hostLink?.state === "failed")
          this.updateStatus(InstanceStatus.UnknownWarning, text);
        else this.updateStatus(InstanceStatus.Ok, text);
        break;
      case "waiting":
        this.updateStatus(InstanceStatus.Connecting, text);
        break;
      case "silent":
        this.updateStatus(
          InstanceStatus.UnknownWarning,
          `${text}. Commands still go. For feedback, set Remora's state target (Settings › Companion › Remora's state) to this machine, port ${link.statePort}.`,
        );
        break;
      case "failed":
        this.updateStatus(
          InstanceStatus.ConnectionFailure,
          `${text}. Commands still go; pick another port for Remora's state, here and in Remora.`,
        );
        break;
      default:
        // No state port: nothing is known about Remora, so the most this can
        // say is where commands go.
        this.updateStatus(InstanceStatus.Ok, `${text} (one-way)`);
    }
  }

  onRacks(racks) {
    this.state.racks = racks;
    this.#definitionsForRacks();
    this.refreshVariableValues();
    this.checkFeedbacks("rackShown");
  }

  onPosition(index, how = null, name = "") {
    this.state.position = index;
    this.state.positionHow = index === null ? null : how;
    this.state.positionName = index === null ? "" : name;
    this.refreshVariableValues();
    this.checkFeedbacks("rackShown");
  }

  onFollow(value) {
    this.state.follow = value;
    this.refreshVariableValues();
    this.checkFeedbacks("following");
  }

  onResult(error, text) {
    this.state.lastResult = text;
    if (error !== 0) {
      this.state.lastError = `${text || "failed"} (error ${error})`;
      this.state.lastErrorAt = Date.now();
    }
    this.refreshVariableValues();
    this.checkFeedbacks("recentError");
  }

  /** The rack names feed the dropdowns, the per-rack variables and the
   *  per-rack presets, so all three are rebuilt when the list changes. */
  #definitionsForRacks() {
    const key = JSON.stringify(this.state.racks.map((r) => [r.index, r.name]));
    if (key === this.racksKey) return;
    this.racksKey = key;
    this.updateActions();
    this.updateFeedbacks();
    this.updateVariableDefinitions();
    this.updatePresets();
  }

  refreshVariableValues() {
    this.setVariableValues(variableValues(this));
  }

  updateActions() {
    UpdateActions(this);
  }

  updateFeedbacks() {
    UpdateFeedbacks(this);
  }

  updateVariableDefinitions() {
    UpdateVariableDefinitions(this);
  }

  updatePresets() {
    UpdatePresets(this);
  }
}

export { UpgradeScripts };
