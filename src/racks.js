// SuperRack's racks as ProLink lists them, how a typed rack is found, and how a
// rack is reached. Ported from Remora's ProLinkRack.swift, RackMatcher (Rack.swift)
// and SuperRackProLinkModule.show (stoatworks-labs/remora).

/**
 * One rack: LAWO's MR_RACK_INFO (waveslib.tcl), 11 values, typed
 * `,isiiiiii(T|F)(T|F)i` on the wire.
 *
 * - index: the rack's place in SuperRack's rack list, from 0.
 * - firstInputChannel: the first input channel feeding the rack, from 0, or -1
 *   for none. ShowRack(channel) shows the rack this channel feeds.
 * - processingGroup: 0 main, 1–3 the groups, 255 none.
 */
export function rackFromRecord(a) {
  if (a.length !== 11) return null;
  const ints = [0, 2, 3, 4, 5, 6, 7, 10];
  if (ints.some((i) => a[i].type !== "i")) return null;
  if (a[1].type !== "s") return null;
  if (![8, 9].every((i) => a[i].type === "T" || a[i].type === "F")) return null;
  return {
    index: a[0].value,
    name: a[1].value,
    inputs: a[2].value,
    outputs: a[3].value,
    inputStemFormat: a[4].value,
    outputStemFormat: a[5].value,
    firstInputChannel: a[6].value,
    firstOutputChannel: a[7].value,
    muted: a[8].type === "T",
    isIn: a[9].type === "T",
    processingGroup: a[10].value,
  };
}

/** The record's 11 OSC arguments — for the test's fake SuperRack. */
export function rackRecord(r) {
  const i = (value) => ({ type: "i", value });
  const t = (b) => ({ type: b ? "T" : "F", value: b });
  return [
    i(r.index),
    { type: "s", value: r.name },
    i(r.inputs ?? 1),
    i(r.outputs ?? 1),
    i(r.inputStemFormat ?? 100),
    i(r.outputStemFormat ?? 100),
    i(r.firstInputChannel ?? -1),
    i(r.firstOutputChannel ?? -1),
    t(r.muted ?? false),
    t(r.isIn ?? true),
    i(r.processingGroup ?? 0),
  ];
}

/**
 * Every rack in a GiveRackInfo (`id count [rack] [rack] …`, as SuperRack sent it
 * on 2026-11-07) or a NotifyRacksConfigChanged (`count [rack] …`). Each record
 * is an OSC array of its own, and loose ints are skipped. A record that does not
 * read is left out, rather than failing the list.
 */
export function racksFromArgs(args) {
  const racks = [];
  let i = 0;
  while (i < args.length) {
    if (args[i].type !== "[") {
      i++;
      continue;
    }
    const end = args.findIndex((a, j) => j > i && a.type === "]");
    if (end < 0) break;
    const r = rackFromRecord(args.slice(i + 1, end));
    if (r) racks.push(r);
    i = end + 1;
  }
  return racks;
}

/** Whether this input channel (from 0) feeds the rack. */
export function takesChannel(r, ch) {
  return (
    r.firstInputChannel >= 0 &&
    ch >= r.firstInputChannel &&
    ch < r.firstInputChannel + Math.max(1, r.inputs)
  );
}

/** Lower case, letters and digits only: "Head 1" and "head1" are the same. */
export function normalise(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The rack a typed name means, as Remora matches a channel name: exactly, after
 * normalising ("head1" finds "head 1"), or else by the name without its trailing
 * number when only one rack has that ("lec 2" finds "Lec"). Racks named "n/a" are
 * never matched by name. When several racks share the name, the first wins.
 */
export function matchRack(name, racks) {
  const n = normalise(name);
  if (!n) return null;
  const usable = racks.filter((r) => {
    const rn = normalise(r.name);
    return rn !== "" && rn !== "na";
  });
  const exact = usable.find((r) => normalise(r.name) === n);
  if (exact) return exact;
  const stem = n.replace(/\p{N}+$/u, "");
  if (!stem || stem === n) return null;
  const candidates = usable.filter((r) => normalise(r.name) === stem);
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * What a rack field holds: a rack number (from 1) if it is all digits, or else a
 * name. The same rule as Remora's /remora/rack/select, so a button means the
 * same rack in either mode.
 */
export function parseRackField(value) {
  const s = String(value ?? "").trim();
  if (s === "") return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= 1 ? { number: n } : null;
  }
  return { name: s };
}

/** The rack a parsed field names, from SuperRack's list, or null. */
export function findRack(field, racks) {
  if (!field) return null;
  if (field.number !== undefined) {
    return racks.find((r) => r.index === field.number - 1) ?? null;
  }
  return matchRack(field.name, racks);
}

/**
 * How to reach a rack over ProLink:
 *
 * - a rack an input channel feeds: ShowRack on its first input channel, as the
 *   mc²'s hot-rack key does;
 * - a rack no input feeds, which ShowRack cannot reach: ShowRack on the nearest
 *   rack one does feed, then Next or Previous Rack from there. On 2026-11-07,
 *   Remora reached SuperRack's Rack 12 that way (ShowRack on mains, then two Next).
 *
 * Returns { steps: [{ name, args, landsOn }], via } or { error }. Each step's
 * `landsOn` is the rack index SuperRack is on once that step has succeeded.
 */
export function planShow(target, racks) {
  if (target.firstInputChannel >= 0) {
    return {
      steps: [
        {
          name: "ShowRack",
          args: [{ type: "i", value: target.firstInputChannel }],
          landsOn: target.index,
        },
      ],
      via: null,
    };
  }
  const fed = racks.filter((r) => r.firstInputChannel >= 0);
  if (fed.length === 0) {
    return {
      error: `no rack has an input channel, so ${target.name} can't be reached`,
    };
  }
  const from = fed.reduce((best, r) => {
    const d = Math.abs(r.index - target.index);
    const bd = Math.abs(best.index - target.index);
    return d < bd || (d === bd && r.index < best.index) ? r : best;
  });
  const delta = target.index - from.index;
  const steps = [
    {
      name: "ShowRack",
      args: [{ type: "i", value: from.firstInputChannel }],
      landsOn: from.index,
    },
  ];
  for (let k = 1; k <= Math.abs(delta); k++) {
    steps.push({
      name: "NavigateRack",
      args: [{ type: "i", value: delta > 0 ? 0 : 1 }],
      landsOn: from.index + (delta > 0 ? k : -k),
    });
  }
  return { steps, via: from };
}
