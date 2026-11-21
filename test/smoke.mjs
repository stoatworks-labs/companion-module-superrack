// Runs the module's real source — ModuleInstance itself, with a stand-in for
// Companion's side of the instance — against a pretend SuperRack on a real TCP
// socket (test/fake-superrack.mjs) and a pretend Remora on a real UDP socket.
// Checks: the wire format, the handshake and keepalive, the rack list and what
// it feeds, where each action leaves SuperRack, that nothing but the five
// commands ever goes, the failure paths, and Remora's OSC addresses.

import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import { readdirSync, readFileSync } from "node:fs";
import { FakeSuperRack } from "./fake-superrack.mjs";

// Every failure here is a hang rather than a throw (a link that never comes
// up, a reply that never arrives), so a watchdog turns a hang into a failure.
const watchdog = setTimeout(() => {
  console.error("\nTIMED OUT — no completion within 60s.");
  process.exit(2);
}, 60000);
watchdog.unref?.();

const logs = [];
globalThis.COMPANION_LOGGER = (_source, level, message) => {
  logs.push({ level, message });
  if (process.env.VERBOSE) console.log(`    [${level}] ${message}`);
};

const SRC = new URL("../src/", import.meta.url).pathname;
const wire = await import(`${SRC}prolink-wire.js`);
const racksLib = await import(`${SRC}racks.js`);
const { default: ModuleInstance } = await import(`${SRC}main.js`);

let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, ms = 2000, what = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// --- a stand-in for Companion's side of an instance ------------------------
function makeContext() {
  const ctx = {
    _isInstanceContext: true,
    id: "test-connection",
    label: "sr",
    actions: {},
    feedbacks: {},
    variables: {},
    values: {},
    structure: null,
    presets: null,
    statuses: [],
    checked: [],
    setActionDefinitions: (d) => (ctx.actions = d),
    setFeedbackDefinitions: (d) => (ctx.feedbacks = d),
    setVariableDefinitions: (d) => (ctx.variables = d),
    setVariableValues: (v) => Object.assign(ctx.values, v),
    setPresetDefinitions: (s, p) => {
      ctx.structure = s;
      ctx.presets = p;
    },
    setCompositeElementDefinitions: () => {},
    checkFeedbacks: (types) => ctx.checked.push(types),
    checkFeedbacksById: () => {},
    checkAllFeedbacks: () => ctx.checked.push(["*"]),
    updateStatus: (status, message) => ctx.statuses.push({ status, message }),
    saveConfig: () => {},
    subscribeActions: () => {},
    unsubscribeActions: () => {},
    unsubscribeFeedbacks: () => {},
    recordAction: () => {},
    oscSend: () => {},
    getVariableValue: (id) => ctx.values[id],
  };
  return ctx;
}
const lastStatus = (ctx) => ctx.statuses.at(-1) ?? {};

const RACKS = [
  { index: 0, name: "Kick", firstInputChannel: 0 },
  { index: 1, name: "Snare", firstInputChannel: 1 },
  { index: 2, name: "Vox", inputs: 2, firstInputChannel: 4 },
  { index: 3, name: "head 1", firstInputChannel: 6 },
  { index: 4, name: "Rack 5", firstInputChannel: -1 },
  { index: 5, name: "n/a", firstInputChannel: -1 },
  { index: 6, name: "mains", inputs: 2, firstInputChannel: 14 },
].map((r) => ({
  inputs: 1,
  outputs: 1,
  ...r,
  firstOutputChannel: r.firstInputChannel,
}));

const PORT = 55102;

// =============================================================================
console.log("\n== the wire ==");

await check("header is 16 bytes: 1, Wave, command, value", () => {
  const h = wire.header(wire.Command.osc, 44);
  assert.equal(h.length, 16);
  assert.equal(
    h.toString("hex"),
    "00000001" + Buffer.from("Wave").toString("hex") + "00000005" + "0000002c",
  );
});
await check("console Init: format 0, command set 1.0, the name", () => {
  const b = wire.initMessage(2000, "Companion");
  const [f] = new wire.Parser().feed(b);
  assert.deepEqual(
    { ...f, guid: undefined },
    {
      type: "init",
      keepAlive: 2000,
      dataFormat: 0,
      major: 1,
      minor: 0,
      guid: undefined,
      description: "Companion",
    },
  );
});
await check("parser takes a frame one byte at a time", () => {
  const msg = wire.command("ShowRack", 7, [{ type: "i", value: 4 }]);
  const p = new wire.Parser();
  const got = [];
  for (const byte of msg) got.push(...p.feed(Buffer.from([byte])));
  assert.equal(got.length, 1);
  const m = wire.decodeOSC(got[0].data);
  assert.equal(m.address, "/waves.com/remote/ShowRack");
  assert.deepEqual(
    m.args.map((a) => a.value),
    [7, 4],
  );
});
await check("parser takes two frames in one read", () => {
  const two = Buffer.concat([
    wire.iAmAlive(),
    wire.close(wire.Reason.alreadyConnected),
  ]);
  assert.deepEqual(new wire.Parser().feed(two), [
    { type: "iAmAlive" },
    { type: "close", reason: 1002 },
  ]);
});
await check(
  "parser refuses a bad magic, a keepAlive out of range, an empty OSC",
  () => {
    const bad = Buffer.from(wire.iAmAlive());
    bad.write("Wavx", 4);
    assert.throws(() => new wire.Parser().feed(bad), wire.WireError);
    assert.throws(
      () => new wire.Parser().feed(wire.header(wire.Command.initialize, 100)),
      wire.WireError,
    );
    assert.throws(
      () => new wire.Parser().feed(wire.header(wire.Command.osc, 0)),
      wire.WireError,
    );
  },
);
await check("OSC round trip: i f s T F [ ] h d", () => {
  const args = [
    { type: "i", value: -3 },
    { type: "f", value: 0.5 },
    { type: "s", value: "Vox ✓" },
    { type: "T", value: true },
    { type: "F", value: false },
    { type: "[", value: null },
    { type: "h", value: 1n << 40n },
    { type: "d", value: 1.25 },
    { type: "]", value: null },
  ];
  const m = wire.decodeOSC(wire.encodeOSC({ address: "/a/b", args }));
  assert.deepEqual(m, { address: "/a/b", args });
});
await check("a rack record round-trips as ,isiiiiiiTTi", () => {
  const rec = racksLib.rackRecord(RACKS[2]);
  assert.equal(rec.map((a) => a.type).join(""), "isiiiiiiFTi");
  assert.deepEqual(racksLib.rackFromRecord(rec), {
    index: 2,
    name: "Vox",
    inputs: 2,
    outputs: 1,
    inputStemFormat: 100,
    outputStemFormat: 100,
    firstInputChannel: 4,
    firstOutputChannel: 4,
    muted: false,
    isIn: true,
    processingGroup: 0,
  });
});
await check(
  "a rack list skips loose ints and a record that doesn't read",
  () => {
    const o = { type: "[", value: null };
    const c = { type: "]", value: null };
    const args = [
      { type: "i", value: 9 },
      { type: "i", value: 3 },
      o,
      ...racksLib.rackRecord(RACKS[0]),
      c,
      o,
      { type: "i", value: 1 },
      c,
      o,
      ...racksLib.rackRecord(RACKS[1]),
      c,
    ];
    assert.deepEqual(
      racksLib.racksFromArgs(args).map((r) => r.name),
      ["Kick", "Snare"],
    );
  },
);

console.log("\n== finding a rack ==");
const R = RACKS.map((r) => ({ ...r }));
const nameOf = (r) => r?.name ?? null;
await check("names match loosely, as Remora matches them", () => {
  assert.equal(nameOf(racksLib.matchRack("head1", R)), "head 1");
  assert.equal(nameOf(racksLib.matchRack("VOX", R)), "Vox");
  assert.equal(
    nameOf(racksLib.matchRack("vox 2", R)),
    "Vox",
    "trailing number dropped",
  );
  assert.equal(racksLib.matchRack("n/a", R), null, "n/a is never a name match");
  assert.equal(racksLib.matchRack("", R), null);
  assert.equal(racksLib.matchRack("bass", R), null);
});
await check("a field of digits is a rack number, anything else a name", () => {
  assert.deepEqual(racksLib.parseRackField(" 3 "), { number: 3 });
  assert.deepEqual(racksLib.parseRackField("head 1"), { name: "head 1" });
  assert.equal(racksLib.parseRackField(""), null);
  assert.equal(racksLib.parseRackField("0"), null);
  assert.equal(nameOf(racksLib.findRack({ number: 6 }, R)), "n/a");
});
await check("a rack with an input: one ShowRack on its first channel", () => {
  const p = racksLib.planShow(R[2], R);
  assert.deepEqual(
    p.steps.map((s) => [s.name, s.args[0].value, s.landsOn]),
    [["ShowRack", 4, 2]],
  );
});
await check(
  "a rack with none: ShowRack on the nearest fed rack, then steps",
  () => {
    const p = racksLib.planShow(R[5], R);
    assert.equal(p.via.name, "mains");
    assert.deepEqual(
      p.steps.map((s) => [s.name, s.args[0].value, s.landsOn]),
      [
        ["ShowRack", 14, 6],
        ["NavigateRack", 1, 5],
      ],
    );
    const q = racksLib.planShow(R[4], R);
    assert.equal(q.via.name, "head 1", "a tie goes to the lower rack");
    assert.deepEqual(
      q.steps.map((s) => [s.name, s.args[0].value]),
      [
        ["ShowRack", 6],
        ["NavigateRack", 0],
      ],
    );
  },
);

// =============================================================================
console.log("\n== Direct: the link ==");

const ctx = makeContext();
const mod = new ModuleInstance(ctx);
const config = {
  mode: "prolink",
  prolinkport: PORT,
  consolename: "Companion test",
};
await mod.init(config);

await check("listening: status Connecting, link variable says where", () => {
  assert.equal(lastStatus(ctx).status, "connecting");
  assert.equal(ctx.values.link, `Waiting for SuperRack on TCP ${PORT}`);
  assert.equal(ctx.values.mode, "Direct");
});
await check("before any racks: a bank of racks 1–8 by number", () => {
  const rackPresets = Object.keys(ctx.presets).filter((k) =>
    /^rack_\d+$/.test(k),
  );
  assert.equal(rackPresets.length, 8);
});

const sr = new FakeSuperRack({ racks: RACKS });
await sr.connect(PORT);
await until(
  () => ctx.values.rack_count === RACKS.length,
  2000,
  "the rack list",
);

await check(
  "handshake: the console's Init answers SuperRack's, with the name",
  () => {
    assert.equal(sr.consoleInit.description, "Companion test");
    assert.equal(sr.consoleInit.keepAlive, 2000);
  },
);
await check(
  "connected: status Ok, variables name SuperRack and its address",
  () => {
    assert.equal(lastStatus(ctx).status, "ok");
    assert.equal(ctx.values.superrack, "SuperRack Performer (fake)");
    assert.equal(ctx.values.peer, "127.0.0.1");
    assert.equal(ctx.feedbacks.connected.callback({ options: {} }), true);
  },
);
await check("asked for the racks first: GetRacksInfo -1", () => {
  assert.deepEqual(sr.commands[0], {
    name: "GetRacksInfo",
    id: sr.commands[0].id,
    args: [-1],
  });
});
await check("one variable per rack, with its name", () => {
  assert.equal(ctx.values.rack_3_name, "Vox");
  assert.equal(ctx.values.rack_7_name, "mains");
  assert.ok(ctx.variables.rack_7_name);
});
await check("the rack dropdown lists SuperRack's racks; n/a by number", () => {
  const opt = ctx.actions.showRack.options[0];
  assert.equal(opt.allowCustom, true);
  assert.deepEqual(
    opt.choices.map((c) => c.id),
    ["Kick", "Snare", "Vox", "head 1", "Rack 5", "6", "mains"],
  );
  assert.equal(opt.choices[4].label, "5. Rack 5 (no input)");
});
await check("one preset per rack, labelled by its name variable", () => {
  assert.equal(ctx.presets.rack_3.style.text, "$(sr:rack_3_name)");
  assert.deepEqual(ctx.presets.rack_3.steps[0].down, [
    { actionId: "showRack", options: { rack: "3" } },
  ]);
  assert.equal(ctx.presets.rack_3.feedbacks[0].feedbackId, "rackShown");
  assert.equal(ctx.presets.rack_9, undefined);
});

console.log("\n== Direct: where each action leaves SuperRack ==");
const fire = (id, options = {}) => ctx.actions[id].callback({ options });
const shown = (rack) => ctx.feedbacks.rackShown.callback({ options: { rack } });
const settle = async () => {
  await until(
    () =>
      !mod.backend.console.inFlight && mod.backend.console.waiting.length === 0,
    2000,
    "commands answered",
  );
  await sleep(20);
};

await check("Show a rack by name: ShowRack on its first channel", async () => {
  sr.commands.length = 0;
  await fire("showRack", { rack: "vox" });
  await settle();
  assert.deepEqual(
    sr.commands.map((c) => [c.name, ...c.args]),
    [["ShowRack", 4]],
  );
  assert.equal(sr.screen.rack, 2);
  assert.equal(ctx.values.rack_name, "Vox");
  assert.equal(ctx.values.rack_number, 3);
  assert.equal(shown("Vox"), true);
  assert.equal(shown("3"), true, "by number too");
  assert.equal(shown("Kick"), false);
});
await check("Show a rack by number", async () => {
  await fire("showRack", { rack: "4" });
  await settle();
  assert.equal(sr.screen.rack, 3);
  assert.equal(ctx.values.rack_name, "head 1");
});
await check(
  "Show a rack no input feeds: lands on it, by the nearest fed rack",
  async () => {
    sr.commands.length = 0;
    await fire("showRack", { rack: "6" });
    await settle();
    assert.deepEqual(
      sr.commands.map((c) => [c.name, ...c.args]),
      [
        ["ShowRack", 14],
        ["NavigateRack", 1],
      ],
    );
    assert.equal(sr.screen.rack, 5, "the fake's screen");
    assert.equal(ctx.values.rack_number, 6, "the module's idea of it");
    assert.equal(shown("6"), true);
  },
);
await check(
  "Next and Previous rack: NavigateRack 0 and 1, followed",
  async () => {
    sr.commands.length = 0;
    await fire("previousRack");
    await settle();
    await fire("previousRack");
    await settle();
    await fire("nextRack");
    await settle();
    assert.deepEqual(
      sr.commands.map((c) => [c.name, ...c.args]),
      [
        ["NavigateRack", 1],
        ["NavigateRack", 1],
        ["NavigateRack", 0],
      ],
    );
    assert.equal(sr.screen.rack, 4);
    assert.equal(ctx.values.rack_number, 5);
  },
);
await check(
  "Next rack off the end: position unknown, feedback dark",
  async () => {
    await fire("showRack", { rack: "mains" });
    await settle();
    await fire("nextRack");
    await settle();
    assert.equal(ctx.values.rack_number, "");
    assert.equal(shown("mains"), false);
  },
);
await check(
  "Plug-ins and pages: NavigatePlugin 0/1, SetViewMode 2/3",
  async () => {
    sr.commands.length = 0;
    for (const a of ["nextPlugin", "previousPlugin", "rackPage", "overview"])
      await fire(a);
    await settle();
    assert.deepEqual(
      sr.commands.map((c) => [c.name, ...c.args]),
      [
        ["NavigatePlugin", 0],
        ["NavigatePlugin", 1],
        ["SetViewMode", 2],
        ["SetViewMode", 3],
      ],
    );
    assert.equal(sr.screen.page, "overview");
  },
);
await check("Show the rack a channel feeds: ShowRack channel-1", async () => {
  sr.commands.length = 0;
  await fire("showChannel", { channel: "6" });
  await settle();
  assert.deepEqual(
    sr.commands.map((c) => [c.name, ...c.args]),
    [["ShowRack", 5]],
  );
  assert.equal(ctx.values.rack_name, "Vox", "channel 6 is Vox's second input");
});
await check(
  "a channel no rack takes: SuperRack refuses, error shows, position unknown",
  async () => {
    await fire("showChannel", { channel: "10" });
    await settle();
    assert.equal(ctx.values.rack_number, "");
    assert.match(ctx.values.last_error, /ShowRack failed \(error 5\)/);
    assert.equal(
      ctx.feedbacks.recentError.callback({ options: { seconds: 5 } }),
      true,
    );
  },
);
await check("Refresh: GetRacksInfo -1 again", async () => {
  sr.commands.length = 0;
  await fire("refresh");
  await settle();
  assert.deepEqual(
    sr.commands.map((c) => [c.name, ...c.args]),
    [["GetRacksInfo", -1]],
  );
});
await check("a rack nobody has, a junk channel: nothing sent", async () => {
  sr.commands.length = 0;
  await fire("showRack", { rack: "bass" });
  await fire("showRack", { rack: "99" });
  await fire("showChannel", { channel: "x" });
  await fire("showChannel", { channel: "0" });
  await settle();
  assert.deepEqual(sr.commands, []);
});
await check(
  "Follow and Send CC are Remora's: nothing sent, a warning logged",
  async () => {
    sr.commands.length = 0;
    logs.length = 0;
    await fire("follow", { mode: "toggle" });
    await fire("sendCC", { cc: 30, value: 127 });
    await settle();
    assert.deepEqual(sr.commands, []);
    assert.ok(logs.some((l) => l.level === "warn" && /Remora/.test(l.message)));
  },
);
await check("a burst of rack moves: the newest show wins", async () => {
  sr.commands.length = 0;
  for (const r of ["1", "2", "3", "6", "4"])
    await fire("showRack", { rack: r });
  await settle();
  assert.equal(sr.screen.rack, 3);
  assert.equal(ctx.values.rack_number, 4);
  assert.ok(
    sr.commands.length < 6,
    `${sr.commands.length} commands for 5 presses`,
  );
});

console.log("\n== Direct: SuperRack changes ==");
await check(
  "racks renamed and added: variables, dropdown and presets follow",
  async () => {
    const next = [
      ...RACKS.map((r) => ({ ...r })),
      { ...RACKS[0], index: 7, name: "Bass", firstInputChannel: 20 },
    ];
    next[2].name = "Lead Vox";
    sr.notifyRacks(next);
    await until(() => ctx.values.rack_8_name === "Bass", 2000, "the new rack");
    assert.equal(ctx.values.rack_3_name, "Lead Vox");
    assert.ok(
      ctx.actions.showRack.options[0].choices.some((c) => c.id === "Lead Vox"),
    );
    assert.ok(ctx.presets.rack_8);
    assert.equal(ctx.values.rack_count, 8);
  },
);

console.log("\n== Direct: keepalive and refusals ==");
await check("the module sends IAmAlive about once a second", async () => {
  const before = sr.received.filter((t) => t === "iAmAlive").length;
  await sleep(2300);
  const n = sr.received.filter((t) => t === "iAmAlive").length - before;
  assert.ok(n >= 2 && n <= 4, `${n} IAmAlive in 2.3 s`);
});
await check(
  "a second SuperRack is refused with AlreadyConnected (1002)",
  async () => {
    const s = net.connect(PORT, "127.0.0.1");
    const reply = await new Promise((resolve) => {
      const chunks = [];
      s.on("data", (b) => chunks.push(b));
      s.on("close", () => resolve(Buffer.concat(chunks)));
    });
    assert.deepEqual(new wire.Parser().feed(reply), [
      { type: "close", reason: 1002 },
    ]);
    assert.equal(lastStatus(ctx).status, "ok", "the first link is untouched");
  },
);
await check(
  "SuperRack never got a command outside the five, nor a violation",
  () => {
    assert.deepEqual(sr.violations, []);
    assert.ok(
      sr.commands.every((c) =>
        [
          "GetRacksInfo",
          "ShowRack",
          "NavigateRack",
          "NavigatePlugin",
          "SetViewMode",
        ].includes(c.name),
      ),
    );
  },
);
await check("the console itself refuses anything else", () => {
  assert.equal(
    mod.backend.console.send("RecallSnapshot", [{ type: "i", value: 1 }]),
    null,
  );
});

console.log("\n== Direct: losing SuperRack ==");
await check(
  "SuperRack goes: back to waiting, racks and position cleared",
  async () => {
    sr.close();
    await until(
      () => ctx.values.link === `Waiting for SuperRack on TCP ${PORT}`,
      2000,
      "waiting again",
    );
    assert.equal(lastStatus(ctx).status, "connecting");
    assert.equal(ctx.values.rack_count, 0);
    assert.equal(ctx.values.rack_name, "");
    assert.equal(ctx.feedbacks.connected.callback({ options: {} }), false);
  },
);
await check("a press while SuperRack is away sends nothing later", async () => {
  await fire("showRack", { rack: "1" });
  const sr2 = new FakeSuperRack({ racks: RACKS });
  await sr2.connect(PORT);
  await until(
    () => ctx.values.rack_count === RACKS.length,
    2000,
    "the racks again",
  );
  await sleep(100);
  assert.deepEqual(
    sr2.commands.map((c) => c.name),
    ["GetRacksInfo"],
  );
  sr2.close();
  await until(() => ctx.values.rack_count === 0, 2000, "dropped");
});
await check(
  "SuperRack stops answering: the next command goes after 1 s anyway",
  async () => {
    const sr3 = new FakeSuperRack({ racks: RACKS });
    await sr3.connect(PORT);
    await until(() => ctx.values.rack_count === RACKS.length, 2000, "racks");
    sr3.silent = true;
    await fire("showRack", { rack: "1" });
    await fire("nextRack");
    await sleep(300);
    assert.equal(
      sr3.commands.filter((c) => c.name !== "GetRacksInfo").length,
      1,
      "one at a time",
    );
    await sleep(1100);
    assert.equal(
      sr3.commands.filter((c) => c.name !== "GetRacksInfo").length,
      2,
      "then the next",
    );
    assert.equal(
      ctx.values.rack_number,
      "",
      "an unanswered move leaves the position unknown",
    );
    sr3.close();
    await until(() => ctx.values.rack_count === 0, 2000, "dropped");
  },
);
await check(
  "garbage from the peer: dropped with ReceivedBadHeader (1001)",
  async () => {
    const s = net.connect(PORT, "127.0.0.1");
    await new Promise((r) => s.on("connect", r));
    const reply = new Promise((resolve) => {
      const chunks = [];
      s.on("data", (b) => chunks.push(b));
      s.on("close", () => resolve(Buffer.concat(chunks)));
    });
    s.write(Buffer.from("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
    assert.deepEqual(new wire.Parser().feed(await reply), [
      { type: "close", reason: 1001 },
    ]);
    await until(
      () => ctx.values.link === `Waiting for SuperRack on TCP ${PORT}`,
      2000,
      "waiting again",
    );
  },
);
await check("a command set 2 SuperRack: dropped with 1004", async () => {
  const s = net.connect(PORT, "127.0.0.1");
  await new Promise((r) => s.on("connect", r));
  const reply = new Promise((resolve) => {
    const chunks = [];
    s.on("data", (b) => chunks.push(b));
    s.on("close", () => resolve(Buffer.concat(chunks)));
  });
  const init = wire.initMessage(2000, "future");
  init.writeUInt16BE(2, 16 + 4);
  s.write(init);
  assert.deepEqual(new wire.Parser().feed(await reply), [
    { type: "close", reason: 1004 },
  ]);
});

console.log("\n== Direct: the port is taken ==");
await check(
  "a second connection on the same port: ConnectionFailure, says why",
  async () => {
    const ctx2 = makeContext();
    const mod2 = new ModuleInstance(ctx2);
    await mod2.init({ ...config });
    assert.equal(lastStatus(ctx2).status, "connection_failure");
    assert.match(
      lastStatus(ctx2).message,
      new RegExp(`TCP ${PORT} is already in use.*Through Remora`),
    );
    await mod2.destroy();
  },
);

// =============================================================================
console.log("\n== Through Remora ==");
const REMORA_PORT = 55120;
const remora = dgram.createSocket("udp4");
const heard = [];
remora.on("message", (b) => heard.push(wire.decodeOSC(b)));
await new Promise((r) => remora.bind(REMORA_PORT, "127.0.0.1", r));

await mod.configUpdated({
  ...config,
  mode: "remora",
  remorahost: "127.0.0.1",
  remoraport: REMORA_PORT,
});

await check("switching mode frees the ProLink port", async () => {
  const s = net.createServer();
  await new Promise((resolve, reject) => {
    s.once("error", reject);
    s.listen(PORT, "0.0.0.0", resolve);
  });
  await new Promise((r) => s.close(r));
});
await check("status says where commands go, and that it's one-way", () => {
  assert.equal(lastStatus(ctx).status, "ok");
  assert.match(
    lastStatus(ctx).message,
    new RegExp(`Remora at 127.0.0.1:${REMORA_PORT} \\(one-way\\)`),
  );
  assert.equal(ctx.values.mode, "Through Remora");
});
await check(
  "no rack list: the dropdown is empty but takes a name or number",
  () => {
    const opt = ctx.actions.showRack.options[0];
    assert.deepEqual(opt.choices, []);
    assert.equal(opt.allowCustom, true);
    assert.equal(
      Object.keys(ctx.presets).filter((k) => /^rack_\d+$/.test(k)).length,
      8,
    );
    assert.ok(ctx.presets.follow_toggle && ctx.presets.send_cc);
  },
);

const sends = async (id, options) => {
  heard.length = 0;
  await fire(id, options);
  await sleep(60);
  return heard.map((m) => [
    m.address,
    ...m.args.map((a) => `${a.type}:${a.value}`),
  ]);
};
await check(
  "Show a rack: /remora/rack/select with an int or a string",
  async () => {
    assert.deepEqual(await sends("showRack", { rack: "3" }), [
      ["/remora/rack/select", "i:3"],
    ]);
    assert.deepEqual(await sends("showRack", { rack: "head 1" }), [
      ["/remora/rack/select", "s:head 1"],
    ]);
  },
);
await check(
  "navigation: next, prev, plug-ins, page, overview, resync",
  async () => {
    const got = [];
    for (const a of [
      "nextRack",
      "previousRack",
      "nextPlugin",
      "previousPlugin",
      "rackPage",
      "overview",
      "refresh",
    ]) {
      got.push(...(await sends(a)));
    }
    assert.deepEqual(
      got.map((g) => g[0]),
      [
        "/remora/rack/next",
        "/remora/rack/prev",
        "/remora/plugin/next",
        "/remora/plugin/prev",
        "/remora/rack/open",
        "/remora/overview",
        "/remora/rack/resync",
      ],
    );
  },
);
await check(
  "Follow: /remora/follow 1, 0, and /remora/follow/toggle",
  async () => {
    assert.deepEqual(await sends("follow", { mode: "on" }), [
      ["/remora/follow", "i:1"],
    ]);
    assert.deepEqual(await sends("follow", { mode: "off" }), [
      ["/remora/follow", "i:0"],
    ]);
    assert.deepEqual(await sends("follow", { mode: "toggle" }), [
      ["/remora/follow/toggle"],
    ]);
  },
);
await check(
  "Send CC: /remora/cc number value; out of range sends nothing",
  async () => {
    assert.deepEqual(await sends("sendCC", { cc: 30, value: 127 }), [
      ["/remora/cc", "i:30", "i:127"],
    ]);
    assert.deepEqual(await sends("sendCC", { cc: 128, value: 1 }), []);
  },
);
await check(
  "Show the rack for a channel: Direct only, nothing sent",
  async () => {
    assert.deepEqual(await sends("showChannel", { channel: "3" }), []);
  },
);
await check("feedbacks stay dark: Remora answers nothing", () => {
  assert.equal(ctx.feedbacks.connected.callback({ options: {} }), false);
  assert.equal(
    ctx.feedbacks.rackShown.callback({ options: { rack: "3" } }),
    false,
  );
});

await check("destroy() settles", async () => {
  const r = await Promise.race([
    mod.destroy().then(() => "done"),
    sleep(3000).then(() => "hung"),
  ]);
  assert.equal(r, "done");
});
remora.close();

// =============================================================================
console.log("\n== definitions ==");
const ctx3 = makeContext();
const mod3 = new ModuleInstance(ctx3);
await mod3.init({ mode: "prolink", prolinkport: PORT, consolename: "" });
const sr4 = new FakeSuperRack({ racks: RACKS });
await sr4.connect(PORT);
await until(() => ctx3.values.rack_count === RACKS.length, 2000, "racks");

for (const [label, c] of [
  ["Direct", ctx3],
  ["Through Remora", ctx],
]) {
  await check(
    `${label}: every action has a name, options and a callback`,
    () => {
      for (const [id, a] of Object.entries(c.actions)) {
        assert.ok(a.name, id);
        assert.ok(Array.isArray(a.options), id);
        assert.equal(typeof a.callback, "function", id);
      }
    },
  );
  await check(`${label}: every feedback is boolean with a defaultStyle`, () => {
    for (const [id, f] of Object.entries(c.feedbacks)) {
      assert.equal(f.type, "boolean", id);
      assert.ok(f.defaultStyle, id);
    }
  });
  await check(
    `${label}: presets and structure agree, and point at real definitions`,
    () => {
      const referenced = new Set(
        c.structure.flatMap((s) => s.definitions.flatMap((g) => g.presets)),
      );
      for (const ref of referenced)
        assert.ok(c.presets[ref], `structure names ${ref}`);
      for (const [id, p] of Object.entries(c.presets)) {
        assert.ok(referenced.has(id), `${id} is in no section`);
        assert.equal(p.type, "simple", id);
        for (const step of p.steps)
          for (const a of [...step.down, ...step.up])
            assert.ok(c.actions[a.actionId], `${id} → ${a.actionId}`);
        for (const f of p.feedbacks)
          assert.ok(c.feedbacks[f.feedbackId], `${id} → ${f.feedbackId}`);
      }
    },
  );
  await check(`${label}: preset text names the connection's label`, () => {
    const texts = Object.values(c.presets)
      .map((p) => p.style.text)
      .filter((t) => t.includes("$("));
    assert.ok(texts.length > 0);
    for (const t of texts) assert.ok(!/\$\((?!sr:)/.test(t), t);
  });
}
await check("an empty console name falls back to Companion", () => {
  assert.equal(sr4.consoleInit.description, "Companion");
});
await check("the config's fields: mode, ports as numbers, no regex", () => {
  const fields = mod3.getConfigFields();
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  assert.deepEqual(
    byId.mode.choices.map((c) => c.id),
    ["prolink", "remora"],
  );
  for (const id of ["prolinkport", "remoraport"]) {
    assert.equal(byId[id].type, "number", id);
    assert.ok(Number.isInteger(byId[id].default), id);
  }
  assert.deepEqual(
    fields.filter((f) => "regex" in f).map((f) => f.id),
    [],
  );
});
sr4.close();
await mod3.destroy();

// =============================================================================
console.log("\n== traps the fleet has paid for ==");
const srcFiles = readdirSync(SRC).filter((f) => /\.(js|ts)$/.test(f));
const body = (f) => readFileSync(SRC + f, "utf8");
await check("no bare checkFeedbacks() in src/ (it checks nothing)", () => {
  assert.deepEqual(
    srcFiles.filter((f) => /[^A-Za-z]checkFeedbacks\(\s*\)/.test(body(f))),
    [],
  );
});
await check(
  "no parseVariablesInString/Field call in src/ (gone in base 2.x)",
  () => {
    assert.deepEqual(
      srcFiles.filter((f) =>
        /parseVariablesIn(String|Field)\s*\(/.test(body(f)),
      ),
      [],
    );
  },
);
await check("no file in src/ imports Regex (deprecated in base 2.2.2)", () => {
  assert.deepEqual(
    srcFiles.filter((f) =>
      /import\s*{[^}]*\bRegex\b[^}]*}\s*from\s*["']@companion-module\/base/.test(
        body(f),
      ),
    ),
    [],
  );
});
await check("companion/manifest.json version matches package.json", () => {
  const read = (p) =>
    JSON.parse(readFileSync(new URL(p, import.meta.url).pathname, "utf8"));
  assert.equal(
    read("../companion/manifest.json").version,
    read("../package.json").version,
  );
});
await check(
  "the console's command list is the five, and nothing else",
  async () => {
    const { COMMANDS } = await import(`${SRC}prolink-console.js`);
    assert.deepEqual([...COMMANDS].sort(), [
      "GetRacksInfo",
      "NavigatePlugin",
      "NavigateRack",
      "SetViewMode",
      "ShowRack",
    ]);
  },
);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
