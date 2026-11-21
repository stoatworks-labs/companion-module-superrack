// The console end of ProLink, as a LAWO mc² plays it for SuperRack's "ProLink
// LAWO Console Remote" controller. Ported from Remora's ProLinkConsole.swift
// (stoatworks-labs/remora), which ran against SuperRack Performer 15.15.12.13.
//
// SuperRack dials the console, on TCP 50002. The console:
// - answers SuperRack's Init with its own, and is connected at SuperRack's
//   HandshakeAck;
// - keeps the link alive both ways with IAmAlive;
// - asks for the racks (GetRacksInfo -1), and keeps them from
//   NotifyRacksConfigChanged;
// - sends commands one at a time, as the mc² does: the next goes when SuperRack
//   answers (ResultCommand, or the Give… for a Get…), or after `answerTimeoutMs`
//   without an answer.

import net from "node:net";
import { EventEmitter } from "node:events";
import * as wire from "./prolink-wire.js";
import { racksFromArgs } from "./racks.js";

/**
 * Everything this module may send SuperRack: the rack list, and showing and
 * stepping racks, plug-ins and pages, as a console's rack keys do. `send`
 * refuses any other command, so nothing that changes the audio or the session
 * (snapshots, mutes, bypass, names) can go.
 */
export const COMMANDS = new Set([
  "GetRacksInfo",
  "ShowRack",
  "NavigateRack",
  "NavigatePlugin",
  "SetViewMode",
]);

/** SetViewMode's values in waveslib.tcl. */
export const ViewMode = Object.freeze({ normal: 1, rack: 2, overview: 3 });

/**
 * Events:
 * - "state" (state): { kind: "stopped" | "listening" | "handshaking" |
 *   "connected" | "failed", port?, peer?, name?, why? }
 * - "racks" (racks): after each GiveRackInfo or NotifyRacksConfigChanged
 * - "result" (id, error, text): each ResultCommand; error 0 is OK
 * - "unanswered" (id): a command SuperRack did not answer in time
 * - "dropped" (): the link went, and every command not yet answered with it
 * - "log" (level, text)
 */
export class ProLinkConsole extends EventEmitter {
  constructor({
    port = 50002,
    host = "0.0.0.0",
    consoleName = "Companion",
    keepAliveMs = 2000,
    answerTimeoutMs = 1000,
    now = () => Date.now(),
  } = {}) {
    super();
    this.port = port;
    this.host = host;
    this.consoleName = consoleName;
    this.keepAliveMs = keepAliveMs;
    this.answerTimeoutMs = answerTimeoutMs;
    this.now = now;
    this.state = { kind: "stopped" };
    this.racks = [];
    this.server = null;
    this.link = null;
    this.timer = null;
    this.nextId = 0;
    this.#reset();
  }

  get isConnected() {
    return this.state.kind === "connected";
  }

  #setState(st) {
    const a = JSON.stringify(this.state);
    this.state = st;
    if (JSON.stringify(st) !== a) this.emit("state", st);
  }

  #log(level, text) {
    this.emit("log", level, text);
  }

  #reset() {
    this.parser = new wire.Parser();
    this.peer = "";
    this.peerName = "";
    this.peerKeepAliveMs = this.keepAliveMs;
    this.lastHeard = this.now();
    this.lastSent = this.now();
    this.racksRequest = null;
    this.waiting = [];
    this.inFlight = null;
  }

  /** Listens. Resolves once listening, or once listening has failed (the
   *  state says which). */
  start() {
    if (this.server) return Promise.resolve();
    const server = net.createServer((socket) => this.#accept(socket));
    this.server = server;
    return new Promise((resolve) => {
      const failed = (err) => {
        if (this.server !== server) return resolve();
        this.server = null;
        const why =
          err.code === "EADDRINUSE"
            ? `TCP ${this.port} is already in use on this machine`
            : `can't listen on TCP ${this.port}: ${err.message}`;
        this.#setState({ kind: "failed", port: this.port, why });
        resolve();
      };
      server.once("error", failed);
      server.listen(this.port, this.host, () => {
        server.off("error", failed);
        server.on("error", (err) =>
          this.#log("error", `listener: ${err.message}`),
        );
        this.port = server.address().port;
        if (!this.link) this.#setState({ kind: "listening", port: this.port });
        resolve();
      });
    });
  }

  /** Closes the link (telling SuperRack why) and stops listening. */
  async stop() {
    this.#drop(wire.Reason.disconnectRequestShutdown, "stopped");
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.#setState({ kind: "stopped" });
  }

  // --- commands ----------------------------------------------------------

  /**
   * Queues `/waves.com/remote/<name> id args…` and returns its id. Null when
   * SuperRack is not connected: nothing waits for the link, so a rack asked for
   * while it is down is not shown later. Null, and nothing sent, for a command
   * that is not in COMMANDS.
   */
  send(name, args = []) {
    if (!COMMANDS.has(name)) {
      this.#log(
        "warn",
        `${name} not sent: this module only shows and steps racks, plug-ins and pages`,
      );
      return null;
    }
    if (!this.isConnected) return null;
    this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1;
    this.waiting.push({ id: this.nextId, name, args });
    this.#pump();
    return this.nextId;
  }

  /** Drops the queued commands with these names that have not gone yet, and
   *  returns their ids: a newer rack move makes them pointless. */
  cancelWaiting(names) {
    const gone = this.waiting
      .filter((c) => names.includes(c.name))
      .map((c) => c.id);
    this.waiting = this.waiting.filter((c) => !names.includes(c.name));
    return gone;
  }

  /** Shows the rack this input channel (from 0) feeds, on SuperRack's Rack view. */
  showRack(inputChannelIndex) {
    return this.send("ShowRack", [{ type: "i", value: inputChannelIndex }]);
  }

  /** One rack on or back: NavigateRack 0 or 1, as the mc²'s Next and Previous
   *  Rack send them. */
  navigateRack(next) {
    return this.send("NavigateRack", [{ type: "i", value: next ? 0 : 1 }]);
  }

  /** One plug-in on or back: NavigatePlugin 0 or 1, as the mc² sends them. */
  navigatePlugin(next) {
    return this.send("NavigatePlugin", [{ type: "i", value: next ? 0 : 1 }]);
  }

  setViewMode(mode) {
    return this.send("SetViewMode", [{ type: "i", value: mode }]);
  }

  /** Asks for the whole rack list; "racks" follows when it comes. Done by itself
   *  on every connect. */
  requestRacks() {
    const id = this.send("GetRacksInfo", [{ type: "i", value: -1 }]);
    if (id !== null) this.racksRequest = id;
    return id;
  }

  #pump() {
    if (
      this.inFlight ||
      !this.isConnected ||
      !this.link ||
      this.waiting.length === 0
    ) {
      return;
    }
    const c = this.waiting.shift();
    this.inFlight = { id: c.id, sent: this.now() };
    this.#write(wire.command(c.name, c.id, c.args));
    this.#log(
      "debug",
      `TX ${wire.describe({ address: c.name, args: [{ type: "i", value: c.id }, ...c.args] })}`,
    );
  }

  #answered(id) {
    if (!this.inFlight || id !== this.inFlight.id) return;
    this.inFlight = null;
    this.#pump();
  }

  #write(bytes) {
    if (!this.link) return;
    this.link.write(bytes);
  }

  // --- the link ------------------------------------------------------------

  #accept(socket) {
    const peer = (socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
    if (!this.server) {
      socket.destroy();
      return;
    }
    if (this.link) {
      // One SuperRack at a time: tell the newcomer why (waveslib.tcl's
      // AlreadyConnected), and let it go.
      this.#log("warn", `refusing ${peer}: SuperRack is already connected`);
      socket.end(wire.close(wire.Reason.alreadyConnected));
      return;
    }
    this.link = socket;
    this.#reset();
    this.peer = peer;
    socket.setNoDelay(true);
    this.#setState({ kind: "handshaking", port: this.port, peer });
    this.#log("info", `connection from ${peer}`);
    socket.on("data", (bytes) => {
      if (this.link === socket) this.#received(bytes);
    });
    socket.on("error", (err) => {
      if (this.link === socket) this.#log("debug", `socket: ${err.message}`);
    });
    socket.on("close", () => {
      if (this.link === socket) this.#drop(null, "SuperRack closed the link");
    });
    this.#startTimer();
  }

  #received(bytes) {
    this.lastHeard = this.now();
    let frames;
    try {
      frames = this.parser.feed(bytes);
    } catch (e) {
      this.#drop(
        wire.Reason.receivedBadHeader,
        `bad data from SuperRack: ${e.message}`,
      );
      return;
    }
    for (const f of frames) {
      this.#handleFrame(f);
      if (!this.link) return; // that frame dropped the link
    }
  }

  #handleFrame(f) {
    switch (f.type) {
      case "init": {
        if (this.state.kind !== "handshaking" || this.peerName !== "") {
          this.#drop(wire.Reason.receivedBadHeader, "a second Init");
          return;
        }
        this.#log(
          "info",
          `SuperRack's Init: keepAlive ${f.keepAlive} ms, format ${f.dataFormat}, command set ${f.major}.${f.minor}, "${f.description}"`,
        );
        if (f.dataFormat !== 0) {
          this.#drop(
            wire.Reason.notSupportedFormat,
            `data format ${f.dataFormat}`,
          );
          return;
        }
        if (f.major !== 1) {
          this.#drop(
            wire.Reason.notSupportedProtocolVersion,
            `command set ${f.major}.${f.minor}`,
          );
          return;
        }
        this.peerKeepAliveMs = f.keepAlive > 0 ? f.keepAlive : this.keepAliveMs;
        this.peerName = f.description || "SuperRack";
        this.#write(wire.initMessage(this.keepAliveMs, this.consoleName));
        break;
      }
      case "handshakeAck":
        if (this.state.kind !== "handshaking" || this.peerName === "") return;
        this.#setState({
          kind: "connected",
          port: this.port,
          peer: this.peer,
          name: this.peerName,
        });
        this.requestRacks();
        break;
      case "iAmAlive":
        break;
      case "close":
        this.#drop(null, `SuperRack closed the link (reason ${f.reason})`);
        break;
      case "osc": {
        const m = wire.decodeOSC(f.data);
        if (!m) {
          this.#log(
            "debug",
            `an OSC message that does not decode (${f.data.length} bytes)`,
          );
          return;
        }
        this.#log("debug", `RX ${wire.describe(m)}`);
        this.#handleMessage(m);
        break;
      }
    }
  }

  #handleMessage(m) {
    const id = wire.messageId(m);
    switch (wire.commandName(m)) {
      case "GiveRackInfo": {
        this.#answered(id);
        const got = racksFromArgs(m.args);
        if (id !== null && id === this.racksRequest) {
          this.racksRequest = null;
          this.#setRacks(got);
        } else {
          this.#setRacks(this.#merged(got));
        }
        break;
      }
      case "NotifyRacksConfigChanged":
        this.#setRacks(racksFromArgs(m.args));
        break;
      case "GiveNumRacks": {
        this.#answered(id);
        const n = m.args[1]?.type === "i" ? m.args[1].value : null;
        if (
          n !== null &&
          n !== this.racks.length &&
          this.racksRequest === null
        ) {
          this.requestRacks();
        }
        break;
      }
      case "ResultCommand": {
        if (m.args[0]?.type !== "i" || m.args[1]?.type !== "i") return;
        const err = m.args[1].value;
        const text = m.args[2]?.type === "s" ? m.args[2].value : "";
        if (err !== 0) {
          this.#log(
            "warn",
            `SuperRack refused command ${id}: error ${err} ${text}`,
          );
        }
        this.#answered(id);
        this.emit("result", id, err, text);
        break;
      }
      default:
        if (wire.commandName(m).startsWith("Give")) this.#answered(id);
    }
  }

  #merged(updates) {
    const all = [...this.racks];
    for (const r of updates) {
      const i = all.findIndex((x) => x.index === r.index);
      if (i >= 0) all[i] = r;
      else all.push(r);
    }
    return all.sort((a, b) => a.index - b.index);
  }

  #setRacks(racks) {
    if (JSON.stringify(racks) !== JSON.stringify(this.racks)) {
      this.#log(
        "info",
        `${racks.length} racks: ` +
          racks
            .map(
              (r) =>
                `${r.name} (${r.firstInputChannel >= 0 ? `in ${r.firstInputChannel + 1}` : "no input"})`,
            )
            .join(", "),
      );
    }
    this.racks = racks;
    this.emit("racks", racks);
  }

  /**
   * IAmAlive at half the shorter of the two keepAlives, so a late tick never
   * misses SuperRack's. The link is dropped after three of SuperRack's
   * keepAlives and a second without a word (the mc² waits two), or a handshake
   * that takes over five seconds.
   */
  #startTimer() {
    clearInterval(this.timer);
    this.lastSent = this.now();
    this.timer = setInterval(() => this.tick(), 250);
  }

  /** The timer's work, every 250 ms while SuperRack is connected or connecting. */
  tick() {
    if (!this.link) return;
    const now = this.now();
    switch (this.state.kind) {
      case "handshaking":
        if (now - this.lastHeard > 5000) {
          this.#drop(wire.Reason.connectTimeout, "the handshake took over 5 s");
        }
        break;
      case "connected": {
        const silent = now - this.lastHeard;
        if (silent > 3 * this.peerKeepAliveMs + 1000) {
          this.#drop(
            wire.Reason.keepAliveTimeout,
            `SuperRack silent for ${silent} ms`,
          );
          return;
        }
        const every = Math.max(
          200,
          Math.floor(Math.min(this.keepAliveMs, this.peerKeepAliveMs) / 2),
        );
        // Counted from the last IAmAlive, not the last frame of any kind, as
        // Remora does: whether SuperRack counts a command as a keepalive has
        // not been seen, so a busy link still sends IAmAlive on time.
        if (now - this.lastSent >= every) {
          this.lastSent = now;
          this.#write(wire.iAmAlive());
        }
        if (this.inFlight && now - this.inFlight.sent > this.answerTimeoutMs) {
          const id = this.inFlight.id;
          this.#log(
            "warn",
            `no answer to command ${id} within ${this.answerTimeoutMs} ms: sending the next`,
          );
          this.inFlight = null;
          this.emit("unanswered", id);
          this.#pump();
        }
        break;
      }
    }
  }

  #drop(reason, why) {
    const socket = this.link;
    if (!socket) return;
    clearInterval(this.timer);
    this.timer = null;
    this.link = null;
    this.racksRequest = null;
    this.waiting = [];
    this.inFlight = null;
    this.#log("info", `link dropped: ${why}`);
    if (reason === null) socket.destroy();
    else socket.end(wire.close(reason));
    this.emit("dropped");
    if (this.server) this.#setState({ kind: "listening", port: this.port });
    else if (this.state.kind !== "stopped")
      this.#setState({ kind: "failed", why });
  }
}
