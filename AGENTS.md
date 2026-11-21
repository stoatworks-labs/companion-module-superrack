# AGENTS.md — bringing an LLM up to speed on this Companion module

Orientation for an AI assistant (or a new human) picking this project up cold. There is no
`CLAUDE.md` here; this is the entry point.

---

## 1. What this is

A **Bitfocus Companion connection module** for **Waves SuperRack** (Performer and SoundGrid). It
shows a rack, steps racks and plug-ins, and switches between SuperRack's Rack page and overview
from a Stream Deck.

JavaScript, Node 22 runtime, `nodejs-ipc` API, `@companion-module/base` ~2.2.2, so it needs
Companion 5.1 or later.

## 2. Two backends behind one set of actions

```
Direct:          Companion ──▶ this module (TCP 50002, plays a LAWO mc²) ◀── SuperRack dials in
Through Remora:  Companion ──▶ this module ──UDP OSC 9020──▶ Remora ──MIDI or ProLink──▶ SuperRack
                                this module ◀──UDP OSC 9021── Remora's state feed (when set up)
```

- **Direct** (`ProLinkBackend` in `src/backends.js`) is the console end of ProLink, the link a
  LAWO mc² uses with SuperRack's "ProLink LAWO Console Remote" controller. **SuperRack dials the
  console**, so the module listens. Two-way: SuperRack lists its racks and answers every command.
- **Through Remora** (`RemoraBackend`) sends Remora's `/remora/...` OSC. Remora answers nothing to a
  command, but its **state feed** (off in Remora until its state target is set) sends the host,
  its link and any problem, the rack names, the rack it's on and how it knows, and Follow, to the
  module's UDP port (9021; 0 turns the listener off).

Every action is defined in both modes, so a page survives switching. Actions only one mode can do
say so in their name and log a warning when pressed in the other.

## 3. Where the protocol comes from

The ProLink side is a port of Remora's, in `stoatworks-labs/remora`:

| Here                     | Remora                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| `src/prolink-wire.js`    | `Sources/RemoraHosts/SuperRack/ProLinkWire.swift` (and its OSC codec)   |
| `src/prolink-console.js` | `Sources/RemoraHosts/SuperRack/ProLinkConsole.swift`                    |
| `src/racks.js`           | `ProLinkRack.swift`, the RackMatcher, and `SuperRackProLinkModule.show` |

Remora's `docs/PROTOCOL.md` ("Waves SuperRack over ProLink") is the write-up: the 16-byte frame
header, the Init body, the handshake order, keepalives, close reasons, the rack record, and what
SuperRack Performer 15.15.12.13 did on 2026-11-07. **That knowledge comes only from the Tcl
scripts in LAWO's mc² firmware and from runs against a licensed SuperRack.** Don't add anything
learned any other way.

Remora's OSC addresses are owned by Remora: commands in its README "Companion" and `Bridge.swift`,
the state feed in its README "Remora's state, for feedback" and `Sources/RemoraEngine/StateFeed.swift`.
Change one there and Through Remora breaks silently.

## 4. Rules that are not up for debate

- **The command list in `src/prolink-console.js` (`COMMANDS`) is deliberate:** GetRacksInfo,
  ShowRack, NavigateRack, NavigatePlugin, SetViewMode. Those are the commands an mc² sends and
  Remora was checked with. Don't add others, and don't go looking for more.
- **One command in flight**, each answered within 1 s or counted as unanswered, as Remora does.
- **The position is only ever what the commands imply, and says how it's known.** SuperRack never
  says which rack it's on. Direct: an answered ShowRack is `reported`; a Next/Previous Rack from a
  known rack is `counted` (SuperRack says it worked, not where it landed); an edge, a refusal or
  no answer makes it unknown (`null`). Through Remora: Remora's `how` as sent (`reported`, `seen`,
  `counted`, `sent`). _Rack is shown_ lights only for `reported`/`seen` unless asked to. Don't
  infer more.
- **Silence from Remora means unknown.** Remora sends only changes, so the module asks
  (`/remora/state/query`) at start and every 5 s; 12 s with nothing makes the rack and Follow
  unknown and the status a warning. Never keep showing a rack Remora has stopped vouching for.

## 5. Layout

| File                                                              | Role                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/main.js`                                                     | `InstanceBase`: config fields, mode switching, status, the 1 s ticker          |
| `src/backends.js`                                                 | `ProLinkBackend` and `RemoraBackend`, behind the same methods                  |
| `src/prolink-console.js`                                          | The TCP listener and ProLink session (handshake, keepalive, commands)          |
| `src/prolink-wire.js`                                             | Frames and the OSC codec                                                       |
| `src/racks.js`                                                    | Rack records, matching a typed rack, planning the route to a rack              |
| `src/state.js`                                                    | Default state and the link's description (kept apart to avoid an import cycle) |
| `src/actions.js` / `feedbacks.js` / `variables.js` / `presets.js` | The Companion surface                                                          |
| `src/about-field.js`                                              | Vendored from `stoatworks-backend/about`; don't edit here                      |
| `test/fake-superrack.mjs`                                         | A pretend SuperRack with SuperRack's client checks and a pretend screen        |
| `test/smoke.mjs`                                                  | Runs the real `ModuleInstance` against it, and a fake Remora                   |

## 6. Traps already paid for

- **Handle only the messages LAWO's scripts handle.** A message known only from a reading of
  SuperRack's own files doesn't belong here, even when a test client sends it. One was added on
  that basis and taken out again on 2026-11-21. Renames arrive in the full-list push the scripts
  read.
- **The IAmAlive clock only moves when an IAmAlive goes out**, not on every write, matching Remora,
  which ran against SuperRack.
- **The port clashes with Remora's.** Remora with its Plug-in Host on SuperRack (ProLink) listens
  on 50002 too. The module reports "TCP 50002 is already in use on this machine" and points at
  Through Remora.
- **base 2.2:** `setVariableDefinitions` takes an object keyed by id; presets are
  `setPresetDefinitions(structure, defs)` with `type: "simple"` and only presets the structure
  names; config visibility is `isVisibleExpression`; never a bare `checkFeedbacks()`. Preset text
  wants real newlines, not `\n`.
- **Rack presets are by number**, labelled `$(label:rack_N_name)`, so a rename relabels them. Each
  carries _Rack is shown_ twice: `basis: any` amber, then `basis: confirmed` green (later wins).
- **Remora's state goes to the target in Remora's settings, not back to the asker.** A query from
  the module's socket is answered to whatever Remora is set to, so a missing target looks exactly
  like a missing Remora: the status text says how to set it.
- **Remora sends everything only when it starts.** A module that starts after Remora hears only
  changes until it asks, so the query at start is load-bearing; a check fails if it's later than
  the first re-query.
- **The tests run the real module outside Companion**: a context object with
  `_isInstanceContext: true` and stubbed setters, and `globalThis.COMPANION_LOGGER` to catch logs.
  `npm test` is the whole suite; a check was confirmed to go red by breaking the code on purpose.

## 7. Context that matters

This drives live sound. A rack shown on SuperRack's screen is what an engineer is about to touch.
Prefer failing safe: never show a rack as current unless SuperRack confirmed the move, and keep the
link recovering by itself, since SuperRack only dials when its controller is assigned.

## 8. Conventions

- Not in the official Companion module store: it installs from the release `.tgz` or a developer
  modules path.
- Ships a user-facing AI-assisted disclaimer, and says it isn't affiliated with Waves or LAWO.
- Hasn't driven a real SuperRack yet. Say so until it has.
