// The two ways this module reaches SuperRack. Both take the same calls from
// actions.js; each says plainly when it can't do one.
//
//   Direct (ProLink)    Companion ──TCP 50002──▶ SuperRack's ProLink LAWO
//                       Console Remote controller dials this module, which
//                       plays the console. SuperRack answers every command
//                       and lists its racks.
//
//   Through Remora      Companion ──UDP 9020──▶ Remora ──MIDI or ProLink──▶
//                       SuperRack. Remora answers nothing to a command, but
//                       when its state target is set (Settings › Companion ›
//                       Remora's state) it sends what it knows to this module's
//                       UDP port (9021): the host, its racks, the rack it's on
//                       and how it knows, and Follow.

import dgram from "node:dgram";
import { ProLinkConsole, ViewMode } from "./prolink-console.js";
import { decodeOSC, encodeOSC } from "./prolink-wire.js";
import { findRack, planShow, takesChannel } from "./racks.js";

/** Rack moves: a newer one makes the older unsent ones pointless. */
const RACK_MOVES = ["ShowRack", "NavigateRack"];

export class ProLinkBackend {
  /**
   * @param self the module instance: `config`, `log`, and `onLink`, `onRacks`,
   *   `onPosition`, `onResult` to hear about changes.
   */
  constructor(self) {
    this.self = self;
    this.console = null;
    /** Where SuperRack is once each rack move in flight succeeds, by command
     *  id: { lands: a rack index, or { step: ±1 } for Next/Previous Rack, or
     *  null for unknown; how: "reported" or "counted" }. */
    this.moves = new Map();
    /** The rack index this module last saw SuperRack land on, or null. */
    this.position = null;
    /** How: "reported" after a ShowRack SuperRack answered; "counted" after a
     *  Next or Previous Rack, which says it succeeded but not where it landed
     *  (Remora calls it the same). */
    this.positionHow = null;
  }

  get racks() {
    return this.console?.racks ?? [];
  }

  get connected() {
    return this.console?.isConnected ?? false;
  }

  async start() {
    const c = new ProLinkConsole({
      port: Number(this.self.config.prolinkport) || 50002,
      consoleName:
        String(this.self.config.consolename || "Companion").trim() ||
        "Companion",
    });
    this.console = c;
    c.on("log", (level, text) => this.self.log(level, `ProLink: ${text}`));
    c.on("state", (st) => {
      if (st.kind !== "connected") this.#setPosition(null);
      this.self.onLink(st);
    });
    c.on("racks", (racks) => {
      if (
        this.position !== null &&
        !racks.some((r) => r.index === this.position)
      ) {
        this.#setPosition(null);
      }
      this.self.onRacks(racks);
    });
    c.on("result", (id, error, text) => {
      this.#landed(id, error === 0);
      this.self.onResult(error, text);
    });
    c.on("unanswered", (id) => {
      if (this.moves.has(id)) this.#landed(id, false);
    });
    c.on("dropped", () => this.moves.clear());
    await c.start();
    this.self.onLink(c.state);
  }

  async stop() {
    const c = this.console;
    this.console = null;
    this.moves.clear();
    if (c) {
      c.removeAllListeners();
      await c.stop();
    }
  }

  #setPosition(index, how = null) {
    const h = index === null ? null : how;
    if (this.position === index && this.positionHow === h) return;
    this.position = index;
    this.positionHow = h;
    this.self.onPosition(index, h);
  }

  #landed(id, ok) {
    if (!this.moves.has(id)) return;
    const { lands, how } = this.moves.get(id);
    this.moves.delete(id);
    if (!ok || lands === null) return this.#setPosition(null);
    if (typeof lands === "number") return this.#setPosition(lands, how);
    // Next or Previous Rack from a rack this module knows: the neighbour in
    // SuperRack's list, which is the order NavigateRack stepped on 2026-11-07.
    // At either end, what SuperRack does is unknown, so the position is too.
    const next = this.position === null ? null : this.position + lands.step;
    this.#setPosition(
      next !== null && this.racks.some((r) => r.index === next) ? next : null,
      "counted",
    );
  }

  #cancelMoves() {
    for (const id of this.console.cancelWaiting(RACK_MOVES))
      this.moves.delete(id);
  }

  #ready(what) {
    if (this.connected) return true;
    this.self.log("warn", `SuperRack isn't connected, so ${what} was not sent`);
    return false;
  }

  /** Shows a rack, by number (from 1) or by name: `field` from parseRackField. */
  showRack(field) {
    if (!field || !this.#ready("the rack")) return;
    const target = findRack(field, this.racks);
    if (!target) {
      this.self.log(
        "warn",
        field.number !== undefined
          ? `SuperRack has no rack ${field.number}`
          : `SuperRack has no rack called "${field.name}"`,
      );
      return;
    }
    const plan = planShow(target, this.racks);
    if (plan.error) {
      this.self.log("warn", plan.error);
      return;
    }
    if (plan.via) {
      this.self.log(
        "info",
        `${target.name} has no input channel: showing ${plan.via.name}, then ${plan.steps.length - 1} × ${
          target.index > plan.via.index ? "Next" : "Previous"
        } Rack`,
      );
    }
    this.#cancelMoves();
    for (const step of plan.steps) {
      const id = this.console.send(step.name, step.args);
      if (id !== null)
        this.moves.set(id, {
          lands: step.landsOn,
          how: step.name === "ShowRack" ? "reported" : "counted",
        });
    }
  }

  /** Shows the rack an input channel (from 1) feeds, as the mc²'s hot-rack key. */
  showChannel(channel) {
    if (!(channel >= 1) || !this.#ready(`channel ${channel}'s rack`)) return;
    this.#cancelMoves();
    const id = this.console.showRack(channel - 1);
    const rack = this.racks.find((r) => takesChannel(r, channel - 1));
    if (id !== null) {
      // Unknown afterwards if no listed rack takes that channel: SuperRack
      // then answers with an error and stays where it was, or shows a rack
      // this module can't name.
      this.moves.set(id, {
        lands: rack ? rack.index : null,
        how: "reported",
      });
    }
  }

  stepRack(dir) {
    if (!this.#ready(dir > 0 ? "Next Rack" : "Previous Rack")) return;
    const id = this.console.navigateRack(dir > 0);
    if (id !== null)
      this.moves.set(id, {
        lands: { step: dir > 0 ? 1 : -1 },
        how: "counted",
      });
  }

  stepPlugin(dir) {
    if (!this.#ready(dir > 0 ? "Next Plug-in" : "Previous Plug-in")) return;
    this.console.navigatePlugin(dir > 0);
  }

  openRack() {
    if (this.#ready("Rack page")) this.console.setViewMode(ViewMode.rack);
  }

  overview() {
    if (this.#ready("Overview")) this.console.setViewMode(ViewMode.overview);
  }

  resync() {
    if (this.#ready("the rack list request")) this.console.requestRacks();
  }

  follow() {
    this.self.log(
      "warn",
      "Follow is Remora's: pick Through Remora in this connection's settings to switch it",
    );
  }

  cc(number) {
    this.self.log(
      "warn",
      `CC ${number} not sent: ProLink has no MIDI. Send CC needs Through Remora, with Remora on SuperRack (MIDI)`,
    );
  }
}

/** How often to ask for Remora's state, and how long a silence means it's gone.
 *  Remora sends only changes, so the asking is what shows it's still there. */
export const REMORA_FEED = { queryMs: 5000, staleMs: 12000 };

/** The `how` values that come from the host itself (Remora's README). */
const CONFIRMED = new Set(["reported", "seen"]);
export const isConfirmed = (how) => CONFIRMED.has(how);

/**
 * Remora's OSC listener (Settings › Companion in Remora; UDP 9020 by default):
 * Sources/RemoraEngine/Bridge.swift `oscMessage` in stoatworks-labs/remora. It
 * answers nothing to a command. Its state feed (Sources/RemoraEngine/
 * StateFeed.swift) goes to the target set in Remora's settings, not back to the
 * sender, one message to a datagram: on change, and all seven on
 * /remora/state/query.
 */
export class RemoraBackend {
  constructor(self) {
    this.self = self;
    this.socket = null;
    this.timer = null;
    /** off (no state port) | waiting | live | silent | failed (port taken). */
    this.feed = "off";
    this.why = "";
    this.startedAt = 0;
    this.heardAt = 0;
    this.queriedAt = 0;
    this.host = { id: "", product: "" };
    this.hostLink = { state: "none", text: "" };
    this.problem = "";
    this.rackList = [];
    this.position = null;
    this.positionHow = null;
    this.positionName = "";
    this.following = null;
  }

  get racks() {
    return this.rackList;
  }

  /** Remora's state is arriving and it says nothing is wrong with the host. */
  get connected() {
    return (
      this.feed === "live" &&
      this.problem === "" &&
      (this.hostLink.state === "connected" || this.hostLink.state === "none")
    );
  }

  get target() {
    return {
      host: String(this.self.config.remorahost || "127.0.0.1").trim(),
      port: Number(this.self.config.remoraport) || 9020,
    };
  }

  /** The UDP port Remora's state comes to; 0 turns the feed off. */
  get statePort() {
    const v = this.self.config.remorastateport;
    if (v === undefined || v === null || v === "") return 9021;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 9021;
  }

  get timing() {
    return { ...REMORA_FEED, ...(this.self.remoraTiming ?? {}) };
  }

  async start() {
    const port = this.statePort;
    let s = dgram.createSocket("udp4");
    let bound = false;
    if (port > 0) {
      bound = await new Promise((resolve) => {
        const fail = (e) => {
          this.why =
            e.code === "EADDRINUSE"
              ? `UDP ${port} is already in use on this machine`
              : `UDP ${port}: ${e.message}`;
          resolve(false);
        };
        s.once("error", fail);
        s.bind(port, () => {
          s.off("error", fail);
          resolve(true);
        });
      });
    }
    if (!bound) {
      // Commands still go out, from a port of the system's choosing.
      if (port > 0) {
        try {
          s.close();
        } catch {
          // a socket that never bound may refuse to close
        }
        s = dgram.createSocket("udp4");
      }
      await new Promise((resolve) => s.bind(0, resolve));
    }
    this.socket = s;
    s.on("error", (err) =>
      this.self.log("error", `Remora: UDP ${err.message}`),
    );
    if (bound) {
      s.on("message", (b) => this.#message(b));
      this.feed = "waiting";
      this.startedAt = Date.now();
      this.query();
      this.timer = setInterval(() => this.#tick(), 250);
    } else {
      this.feed = port > 0 ? "failed" : "off";
    }
    this.#link();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.removeAllListeners("message");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      try {
        s.close(() => {
          clearTimeout(timer);
          resolve();
        });
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /** Asks Remora to send all of its state again. */
  query() {
    this.queriedAt = Date.now();
    this.send("/remora/state/query", [], { quiet: true });
  }

  #tick() {
    const now = Date.now();
    const { queryMs, staleMs } = this.timing;
    if (now - this.queriedAt >= queryMs) this.query();
    const since = this.heardAt || this.startedAt;
    if (
      (this.feed === "live" || this.feed === "waiting") &&
      now - since > staleMs
    ) {
      // Gone, or never set up to send here. What it said last can't be
      // trusted now, so the rack and Follow go unknown; the names stay, for
      // the dropdowns.
      this.feed = "silent";
      this.#setPosition(null, null, "");
      this.#setFollow(null);
      this.#link();
    }
  }

  #link() {
    const { host, port } = this.target;
    this.self.onLink({
      kind: "remora",
      host,
      port,
      statePort: this.statePort,
      feed: this.feed,
      why: this.why,
      hostId: this.host.id,
      product: this.host.product,
      hostLink: { ...this.hostLink },
      problem: this.problem,
    });
  }

  #setPosition(index, how, name) {
    const h = index === null ? null : how;
    const n = index === null ? "" : name;
    if (
      this.position === index &&
      this.positionHow === h &&
      this.positionName === n
    )
      return;
    this.position = index;
    this.positionHow = h;
    this.positionName = n;
    this.self.onPosition(index, h, n);
  }

  #setFollow(value) {
    if (this.following === value) return;
    this.following = value;
    this.self.onFollow(value);
  }

  #message(bytes) {
    let m;
    try {
      m = decodeOSC(bytes);
    } catch {
      return;
    }
    if (!m || !m.address.startsWith("/remora/state/")) return;
    this.heardAt = Date.now();
    let linkChanged = this.feed !== "live";
    this.feed = "live";
    const str = (i) => (m.args[i]?.type === "s" ? m.args[i].value : "");
    const int = (i) => (m.args[i]?.type === "i" ? m.args[i].value : null);
    switch (m.address) {
      case "/remora/state/host": {
        const id = str(0);
        const product = str(1);
        if (id !== this.host.id || product !== this.host.product) {
          this.host = { id, product };
          linkChanged = true;
        }
        break;
      }
      case "/remora/state/host/link": {
        const state = str(0) || "none";
        const text = str(1);
        if (state !== this.hostLink.state || text !== this.hostLink.text) {
          this.hostLink = { state, text };
          linkChanged = true;
        }
        break;
      }
      case "/remora/state/host/problem": {
        const problem = str(0);
        if (problem !== this.problem) {
          this.problem = problem;
          linkChanged = true;
        }
        break;
      }
      case "/remora/state/racks/names": {
        const names = m.args.filter((a) => a.type === "s").map((a) => a.value);
        const same =
          names.length === this.rackList.length &&
          names.every((n, i) => n === this.rackList[i].name);
        if (!same) {
          this.rackList = names.map((name, index) => ({ index, name }));
          this.self.onRacks(this.rackList);
        }
        break;
      }
      case "/remora/state/rack": {
        const number = int(0) ?? 0;
        const how = str(2);
        const known = number >= 1 && how !== "" && how !== "unknown";
        this.#setPosition(known ? number - 1 : null, how, str(1));
        break;
      }
      case "/remora/state/follow": {
        const f = int(0);
        this.#setFollow(f === null ? null : f !== 0);
        break;
      }
      default:
        // racks/count says what racks/names already shows.
        break;
    }
    if (linkChanged) this.#link();
  }

  send(address, args = [], { quiet = false } = {}) {
    if (!this.socket) return;
    const { host, port } = this.target;
    const data = encodeOSC({ address, args });
    this.socket.send(data, port, host, (err) => {
      if (err)
        this.self.log("error", `Remora: ${address} not sent: ${err.message}`);
    });
    if (!quiet)
      this.self.log(
        "debug",
        `Remora: ${address} ${args.map((a) => a.value).join(" ")}`,
      );
  }

  showRack(field) {
    if (!field) return;
    if (field.number !== undefined) {
      this.send("/remora/rack/select", [{ type: "i", value: field.number }]);
    } else {
      this.send("/remora/rack/select", [{ type: "s", value: field.name }]);
    }
  }

  showChannel(channel) {
    this.self.log(
      "warn",
      `Show the rack for channel ${channel} needs Direct (ProLink): Remora follows the desk's channels itself`,
    );
  }

  stepRack(dir) {
    this.send(dir > 0 ? "/remora/rack/next" : "/remora/rack/prev");
  }

  stepPlugin(dir) {
    this.send(dir > 0 ? "/remora/plugin/next" : "/remora/plugin/prev");
  }

  openRack() {
    this.send("/remora/rack/open");
  }

  overview() {
    this.send("/remora/overview");
  }

  resync() {
    this.send("/remora/rack/resync");
    if (this.feed !== "off" && this.feed !== "failed") this.query();
  }

  /** "on", "off" or "toggle". */
  follow(mode) {
    if (mode === "toggle") this.send("/remora/follow/toggle");
    else
      this.send("/remora/follow", [
        { type: "i", value: mode === "on" ? 1 : 0 },
      ]);
  }

  cc(number, value) {
    this.send("/remora/cc", [
      { type: "i", value: number },
      { type: "i", value: value },
    ]);
  }
}
