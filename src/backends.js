// The two ways this module reaches SuperRack. Both take the same calls from
// actions.js; each says plainly when it can't do one.
//
//   Direct (ProLink)    Companion ──TCP 50002──▶ SuperRack's ProLink LAWO
//                       Console Remote controller dials this module, which
//                       plays the console. SuperRack answers every command
//                       and lists its racks.
//
//   Through Remora      Companion ──UDP 9020──▶ Remora ──MIDI or ProLink──▶
//                       SuperRack. Remora's OSC is one-way: it answers nothing,
//                       so this mode has no rack list and no feedback.

import dgram from "node:dgram";
import { ProLinkConsole, ViewMode } from "./prolink-console.js";
import { encodeOSC } from "./prolink-wire.js";
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
    /** The rack SuperRack is on once each rack move in flight succeeds, by
     *  command id: a rack index, or { step: ±1 } for Next/Previous Rack. */
    this.moves = new Map();
    /** The rack index this module last saw SuperRack land on, or null. */
    this.position = null;
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

  #setPosition(index) {
    if (this.position === index) return;
    this.position = index;
    this.self.onPosition(index);
  }

  #landed(id, ok) {
    if (!this.moves.has(id)) return;
    const lands = this.moves.get(id);
    this.moves.delete(id);
    if (!ok || lands === null) return this.#setPosition(null);
    if (typeof lands === "number") return this.#setPosition(lands);
    // Next or Previous Rack from a rack this module knows: the neighbour in
    // SuperRack's list, which is the order NavigateRack stepped on 2026-11-07.
    // At either end, what SuperRack does is unknown, so the position is too.
    const next = this.position === null ? null : this.position + lands.step;
    this.#setPosition(
      next !== null && this.racks.some((r) => r.index === next) ? next : null,
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
      if (id !== null) this.moves.set(id, step.landsOn);
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
      this.moves.set(id, rack ? rack.index : null);
    }
  }

  stepRack(dir) {
    if (!this.#ready(dir > 0 ? "Next Rack" : "Previous Rack")) return;
    const id = this.console.navigateRack(dir > 0);
    if (id !== null) this.moves.set(id, { step: dir > 0 ? 1 : -1 });
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

/**
 * Remora's OSC listener (Settings › Companion in Remora; UDP 9020 by default):
 * Sources/RemoraEngine/Bridge.swift `oscMessage` in stoatworks-labs/remora.
 * Remora sends nothing back, so nothing here can tell whether it's running.
 */
export class RemoraBackend {
  constructor(self) {
    this.self = self;
    this.socket = null;
  }

  get racks() {
    return [];
  }

  get connected() {
    return false;
  }

  get position() {
    return null;
  }

  get target() {
    return {
      host: String(this.self.config.remorahost || "127.0.0.1").trim(),
      port: Number(this.self.config.remoraport) || 9020,
    };
  }

  async start() {
    const s = dgram.createSocket("udp4");
    this.socket = s;
    s.on("error", (err) =>
      this.self.log("error", `Remora: UDP ${err.message}`),
    );
    await new Promise((resolve) => s.bind(0, resolve));
    const { host, port } = this.target;
    this.self.onLink({ kind: "remora", host, port });
  }

  async stop() {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
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

  send(address, args = []) {
    if (!this.socket) return;
    const { host, port } = this.target;
    const data = encodeOSC({ address, args });
    this.socket.send(data, port, host, (err) => {
      if (err)
        this.self.log("error", `Remora: ${address} not sent: ${err.message}`);
    });
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
