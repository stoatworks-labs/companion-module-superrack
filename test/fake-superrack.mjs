// A pretend SuperRack for the tests: it dials the module the way SuperRack's
// ProLink LAWO Console Remote controller dials a console, and plays SuperRack's
// side with the checks SuperRack's own client makes (as written up in Remora's
// docs/PROTOCOL.md and LAWO's mc² scripts):
//
//   header  protocol 1, "Wave", command 1–5, Init keepAlive -1 or 200..60000,
//           OSC size > 0
//   Init    description ≤ 256 bytes, command set major 1, minor ≤ 0, format 0
//   order   SuperRack's Init → the console's Init → SuperRack's HandshakeAck
//   OSC     first argument an int32 id; ShowRack, NavigateRack, NavigatePlugin
//           and SetViewMode take exactly one more int32
//
// It answers as SuperRack did on 2026-11-07: GetRacksInfo with GiveRackInfo
// (`id count [rack] [rack] …`), anything else with ResultCommand
// (`id error "<Command> succeeded|failed"`). It also keeps a pretend screen —
// which rack is shown, and which page — so a test can check where a sequence of
// commands actually lands. Anything off the list above is a violation.

import net from "node:net";
import * as wire from "../src/prolink-wire.js";
import { rackRecord, takesChannel } from "../src/racks.js";

export const ALLOWED = new Set([
  "GetRacksInfo",
  "ShowRack",
  "NavigateRack",
  "NavigatePlugin",
  "SetViewMode",
]);

export class FakeSuperRack {
  constructor({
    racks,
    keepAliveMs = 2000,
    description = "SuperRack Performer (fake)",
  }) {
    this.racks = racks;
    this.keepAliveMs = keepAliveMs;
    this.description = description;
    this.violations = [];
    this.commands = []; // { name, id, args: [ints] }
    this.received = []; // every frame type, in order
    this.screen = { rack: 0, page: "overview", plugin: 0 };
    this.connected = false;
    this.closedWith = null;
    this.consoleInit = null;
    this.parser = new wire.Parser();
    this.waiters = [];
  }

  /** Dials the console. Resolves once the handshake is done (or fails). */
  connect(port, host = "127.0.0.1") {
    return new Promise((resolve, reject) => {
      const s = net.connect(port, host);
      this.socket = s;
      s.on("error", (e) => {
        this.violation(`socket: ${e.message}`);
        reject(e);
      });
      s.on("close", () => {
        this.connected = false;
        clearInterval(this.ka);
        this.notify();
      });
      s.on("data", (b) => this.#data(b));
      s.on("connect", () => {
        s.setNoDelay(true);
        s.write(this.#init());
        this.onHandshake = resolve;
      });
    });
  }

  #init() {
    const desc = Buffer.from(this.description, "utf8");
    const body = Buffer.alloc(28);
    body.writeUInt32BE(0, 0);
    body.writeUInt16BE(1, 4);
    // SuperRack 15.15.12.13 announced command set 1.1.
    body.writeUInt16BE(1, 6);
    body.writeUInt32BE(desc.length, 24);
    return Buffer.concat([
      wire.header(wire.Command.initialize, this.keepAliveMs),
      body,
      desc,
    ]);
  }

  violation(text) {
    this.violations.push(text);
  }

  #data(bytes) {
    let frames;
    try {
      frames = this.parser.feed(bytes);
    } catch (e) {
      this.violation(`bad frame from the console: ${e.message}`);
      this.socket.destroy();
      return;
    }
    for (const f of frames) this.#frame(f);
    this.notify();
  }

  #frame(f) {
    this.received.push(f.type);
    switch (f.type) {
      case "init":
        if (this.consoleInit)
          return this.violation("a second Init from the console");
        if (f.dataFormat !== 0) this.violation(`format ${f.dataFormat} (1003)`);
        if (f.major !== 1 || f.minor > 0)
          this.violation(`command set ${f.major}.${f.minor} (1004)`);
        this.consoleInit = f;
        this.socket.write(wire.handshakeAck());
        this.connected = true;
        this.ka = setInterval(
          () => this.socket.write(wire.iAmAlive()),
          this.keepAliveMs,
        );
        this.onHandshake?.();
        break;
      case "handshakeAck":
        this.violation("a HandshakeAck from the console");
        break;
      case "close":
        this.closedWith = f.reason;
        break;
      case "iAmAlive":
        break;
      case "osc":
        this.#command(wire.decodeOSC(f.data));
        break;
    }
  }

  #command(m) {
    if (!m) return this.violation("an OSC message that doesn't decode");
    if (!m.address.startsWith("/waves.com/remote/"))
      return this.violation(`address ${m.address}`);
    const name = wire.commandName(m);
    if (m.args[0]?.type !== "i")
      return this.violation(`${name}: first argument must be an int32 id`);
    const id = m.args[0].value;
    const rest = m.args.slice(1);
    if (!ALLOWED.has(name))
      this.violation(`${name} is not one the module may send`);
    if (
      ["ShowRack", "NavigateRack", "NavigatePlugin", "SetViewMode"].includes(
        name,
      ) &&
      (rest.length !== 1 || rest[0].type !== "i")
    ) {
      this.violation(`${name}: needs exactly one int32 after the id`);
    }
    const ints = rest.map((a) => a.value);
    this.commands.push({ name, id, args: ints });
    if (this.silent) return; // a SuperRack that stops answering
    if (name === "GetRacksInfo") {
      const want = ints[0] ?? -1;
      const racks =
        want === -1 ? this.racks : this.racks.filter((r) => r.index === want);
      return this.sendOSC("GiveRackInfo", [
        { type: "i", value: id },
        ...this.#rackItems(racks),
      ]);
    }
    let ok = true;
    if (name === "ShowRack") {
      const hit = this.racks.find((r) => takesChannel(r, ints[0]));
      ok = Boolean(hit);
      if (hit) this.screen = { ...this.screen, rack: hit.index, page: "rack" };
    } else if (name === "NavigateRack") {
      const to = this.screen.rack + (ints[0] === 0 ? 1 : -1);
      if (to >= 0 && to < this.racks.length)
        this.screen = { ...this.screen, rack: to };
    } else if (name === "NavigatePlugin") {
      this.screen = {
        ...this.screen,
        plugin: this.screen.plugin + (ints[0] === 0 ? 1 : -1),
      };
    } else if (name === "SetViewMode") {
      this.screen = {
        ...this.screen,
        page: { 1: "normal", 2: "rack", 3: "overview" }[ints[0]] ?? "?",
      };
    }
    this.sendOSC("ResultCommand", [
      { type: "i", value: id },
      { type: "i", value: ok ? 0 : 5 },
      { type: "s", value: `${name} ${ok ? "succeeded" : "failed"}` },
    ]);
  }

  #rackItems(racks) {
    const items = [{ type: "i", value: racks.length }];
    for (const r of racks)
      items.push({ type: "[", value: null }, ...rackRecord(r), {
        type: "]",
        value: null,
      });
    return items;
  }

  sendOSC(name, args) {
    this.socket.write(
      wire.oscFrame({ address: `/waves.com/remote/${name}`, args }),
    );
  }

  /** What SuperRack pushes when its racks change. */
  notifyRacks(racks) {
    this.racks = racks;
    this.sendOSC("NotifyRacksConfigChanged", this.#rackItems(racks));
  }

  /** What SuperRack pushes when one rack changes: its record, bare. */
  notifyRack(rack) {
    this.racks = this.racks.map((r) => (r.index === rack.index ? rack : r));
    this.sendOSC("NotifySingleRackConfigChanged", rackRecord(rack));
  }

  notify() {
    for (const w of this.waiters.splice(0)) w();
  }

  /** Resolves when `test()` holds, or rejects after `ms`. */
  until(test, ms = 2000, what = "condition") {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(`timed out waiting for ${what}`)),
        ms,
      );
      const check = () => {
        if (test()) {
          clearTimeout(deadline);
          clearInterval(poll);
          resolve();
        }
      };
      const poll = setInterval(check, 10);
      check();
    });
  }

  close() {
    clearInterval(this.ka);
    this.socket?.destroy();
  }
}
