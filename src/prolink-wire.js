// ProLink's framing between SuperRack and a console, as LAWO's mc² firmware
// 12.4.0.1 writes it (its `waves_osc` scripts, waveslib.tcl) and as SuperRack
// Performer 15.15.12.13 answered it on 2026-11-07. Ported from Remora's
// ProLinkWire.swift (stoatworks-labs/remora), which ran against that SuperRack.
//
// A 16-byte header — protocol version 1, "Wave", the command, one int32 — then a
// body for Init and OSC. Every integer is big-endian.

export const PROTOCOL_VERSION = 1;
export const MAGIC = Buffer.from("Wave", "ascii");
export const HEADER_SIZE = 16;
/** dataFormat, the command set's major and minor version, a 16-byte GUID, the
 *  description's size. */
export const INIT_BODY_SIZE = 28;
/** waveslib.tcl refuses an Init with a longer description. */
export const MAX_DESCRIPTION = 256;
/** This module's own bound on one OSC message. */
export const MAX_OSC = 1 << 20;
/** waveslib.tcl's bounds on an Init's keepAlive, in ms. -1 means none. */
export const KEEPALIVE_MIN = 200;
export const KEEPALIVE_MAX = 60000;

export const Command = Object.freeze({
  initialize: 1,
  handshakeAck: 2,
  close: 3,
  iAmAlive: 4,
  osc: 5,
});

/** Why a side closes the link, by waveslib.tcl's names. */
export const Reason = Object.freeze({
  keepAliveTimeout: 2,
  connectTimeout: 5,
  receivedBadHeader: 1001,
  alreadyConnected: 1002,
  notSupportedFormat: 1003,
  notSupportedProtocolVersion: 1004,
  consoleInLockState: 1005,
  disconnectRequestShutdown: 1006,
});

export class WireError extends Error {}

// --- building -----------------------------------------------------------

export function header(cmd, value) {
  const b = Buffer.alloc(HEADER_SIZE);
  b.writeUInt32BE(PROTOCOL_VERSION, 0);
  MAGIC.copy(b, 4);
  b.writeUInt32BE(cmd, 8);
  b.writeInt32BE(value | 0, 12);
  return b;
}

/**
 * The console's Init, sent after SuperRack's: dataFormat 0 (OSC 1.1) and command
 * set 1.0, as the mc² sends. SuperRack 15.15.12.13 announced 1.1 and took 1.0.
 */
export function initMessage(keepAlive, description, guid = Buffer.alloc(16)) {
  if (guid.length !== 16) throw new RangeError("guid is 16 bytes");
  let desc = Buffer.from(String(description), "utf8");
  if (desc.length > MAX_DESCRIPTION) desc = desc.subarray(0, MAX_DESCRIPTION);
  const body = Buffer.alloc(INIT_BODY_SIZE);
  body.writeUInt32BE(0, 0); // dataFormat: OSC 1.1
  body.writeUInt16BE(1, 4); // command set major
  body.writeUInt16BE(0, 6); // command set minor
  guid.copy(body, 8);
  body.writeUInt32BE(desc.length, 24);
  return Buffer.concat([header(Command.initialize, keepAlive), body, desc]);
}

export const handshakeAck = () => header(Command.handshakeAck, 0);
export const iAmAlive = () => header(Command.iAmAlive, 0);
export const close = (reason) => header(Command.close, reason);

export function oscFrame(message) {
  const data = encodeOSC(message);
  return Buffer.concat([header(Command.osc, data.length), data]);
}

/** One remote command: `/waves.com/remote/<name>` with the int32 id first,
 *  then its arguments. */
export function command(name, id, args = []) {
  return oscFrame({
    address: `/waves.com/remote/${name}`,
    args: [{ type: "i", value: id }, ...args],
  });
}

// --- parsing ------------------------------------------------------------

/**
 * Takes bytes as they arrive and returns whole frames. Throws a WireError on a
 * header or Init outside the bounds above, so a bad peer is dropped rather than
 * misread.
 *
 * A frame is one of:
 *   { type: "init", keepAlive, dataFormat, major, minor, guid, description }
 *   { type: "handshakeAck" } | { type: "iAmAlive" } | { type: "close", reason }
 *   { type: "osc", data }
 */
export class Parser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  feed(bytes) {
    this.buffer =
      this.buffer.length === 0
        ? Buffer.from(bytes)
        : Buffer.concat([this.buffer, bytes]);
    const frames = [];
    for (;;) {
      const next = this.#next();
      if (!next) break;
      frames.push(next.frame);
      this.buffer = this.buffer.subarray(next.used);
    }
    return frames;
  }

  #next() {
    const b = this.buffer;
    if (b.length < HEADER_SIZE) return null;
    const proto = b.readUInt32BE(0);
    if (proto !== PROTOCOL_VERSION || !b.subarray(4, 8).equals(MAGIC)) {
      throw new WireError(
        `bad header: protocol ${proto}, magic ${b.subarray(4, 8).toString("hex")}`,
      );
    }
    const cmd = b.readUInt32BE(8);
    const value = b.readInt32BE(12);
    switch (cmd) {
      case Command.initialize: {
        if (value !== -1 && (value < KEEPALIVE_MIN || value > KEEPALIVE_MAX)) {
          throw new WireError(`bad header: keepAlive ${value}`);
        }
        if (b.length < HEADER_SIZE + INIT_BODY_SIZE) return null;
        const o = HEADER_SIZE;
        const descSize = b.readUInt32BE(o + 24);
        const major = b.readUInt16BE(o + 4);
        if (descSize > MAX_DESCRIPTION || major === 0) {
          throw new WireError(
            `bad Init: description ${descSize} bytes, major ${major}`,
          );
        }
        const total = HEADER_SIZE + INIT_BODY_SIZE + descSize;
        if (b.length < total) return null;
        return {
          used: total,
          frame: {
            type: "init",
            keepAlive: value,
            dataFormat: b.readUInt32BE(o),
            major,
            minor: b.readUInt16BE(o + 6),
            guid: Buffer.from(b.subarray(o + 8, o + 24)),
            description: b.subarray(o + 28, total).toString("utf8"),
          },
        };
      }
      case Command.osc: {
        if (value <= 0) throw new WireError(`bad header: OSC size ${value}`);
        if (value > MAX_OSC)
          throw new WireError(`OSC message of ${value} bytes`);
        const total = HEADER_SIZE + value;
        if (b.length < total) return null;
        return {
          used: total,
          frame: {
            type: "osc",
            data: Buffer.from(b.subarray(HEADER_SIZE, total)),
          },
        };
      }
      case Command.handshakeAck:
        return { used: HEADER_SIZE, frame: { type: "handshakeAck" } };
      case Command.close:
        return { used: HEADER_SIZE, frame: { type: "close", reason: value } };
      case Command.iAmAlive:
        return { used: HEADER_SIZE, frame: { type: "iAmAlive" } };
      default:
        throw new WireError(`bad header: command ${cmd}`);
    }
  }
}

// --- OSC ----------------------------------------------------------------
//
// Just enough OSC 1.1 for ProLink and for Remora's listener: the types SuperRack
// sends back (int, string, float, bools and the array markers of a rack list)
// and the int32 and string arguments either end takes. An argument is
// { type, value }, with type one of i f s h d T F N [ ].

function oscString(s) {
  const raw = Buffer.from(String(s), "utf8");
  const padded = Buffer.alloc((raw.length + 4) & ~3);
  raw.copy(padded);
  return padded;
}

export function encodeOSC({ address, args = [] }) {
  const parts = [
    oscString(address),
    oscString("," + args.map((a) => a.type).join("")),
  ];
  for (const a of args) {
    switch (a.type) {
      case "i": {
        const b = Buffer.alloc(4);
        b.writeInt32BE(a.value | 0);
        parts.push(b);
        break;
      }
      case "f": {
        const b = Buffer.alloc(4);
        b.writeFloatBE(Number(a.value));
        parts.push(b);
        break;
      }
      case "h": {
        const b = Buffer.alloc(8);
        b.writeBigInt64BE(BigInt(a.value));
        parts.push(b);
        break;
      }
      case "d": {
        const b = Buffer.alloc(8);
        b.writeDoubleBE(Number(a.value));
        parts.push(b);
        break;
      }
      case "s":
        parts.push(oscString(a.value));
        break;
      case "T":
      case "F":
      case "N":
      case "[":
      case "]":
        break;
      default:
        throw new TypeError(`OSC type ${a.type} is not one this module writes`);
    }
  }
  return Buffer.concat(parts);
}

function readString(b, at) {
  if (at >= b.length) return null;
  const end = b.indexOf(0, at);
  if (end < 0) return null;
  return { value: b.subarray(at, end).toString("utf8"), next: (end + 4) & ~3 };
}

/** One OSC message, or null if it doesn't read. */
export function decodeOSC(b) {
  const addr = readString(b, 0);
  if (!addr || !addr.value.startsWith("/")) return null;
  if (addr.next >= b.length) return { address: addr.value, args: [] };
  const tags = readString(b, addr.next);
  if (!tags || !tags.value.startsWith(",")) return null;
  let i = tags.next;
  const args = [];
  for (const t of tags.value.slice(1)) {
    switch (t) {
      case "i":
      case "f":
        if (i + 4 > b.length) return null;
        args.push({
          type: t,
          value: t === "i" ? b.readInt32BE(i) : b.readFloatBE(i),
        });
        i += 4;
        break;
      case "h":
      case "d":
        if (i + 8 > b.length) return null;
        args.push({
          type: t,
          value: t === "h" ? b.readBigInt64BE(i) : b.readDoubleBE(i),
        });
        i += 8;
        break;
      case "s": {
        const s = readString(b, i);
        if (!s) return null;
        args.push({ type: "s", value: s.value });
        i = s.next;
        break;
      }
      case "T":
      case "F":
        args.push({ type: t, value: t === "T" });
        break;
      case "N":
        args.push({ type: "N", value: null });
        break;
      case "[":
      case "]":
        args.push({ type: t, value: null });
        break;
      default:
        return null;
    }
  }
  return { address: addr.value, args };
}

/** The command's name, after `/waves.com/remote/`. */
export const commandName = (m) => m.address.split("/").pop() ?? "";

/** The leading int32: a command's id, given back in the reply to it. */
export const messageId = (m) =>
  m.args[0]?.type === "i" ? m.args[0].value : null;

/** A message as one log line: `Name 3 "text" T [ … ]`. */
export function describe(m) {
  const arg = (a) => {
    switch (a.type) {
      case "s":
        return JSON.stringify(a.value);
      case "T":
      case "F":
      case "[":
      case "]":
      case "N":
        return a.type;
      default:
        return String(a.value);
    }
  };
  return [commandName(m), ...m.args.map(arg)].join(" ");
}
