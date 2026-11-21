# companion-module-superrack

> **AI-assisted project.** This module was created with [Claude](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. Check it over before you rely on it for
> a show.

A [Bitfocus Companion](https://bitfocus.io/companion) module for Waves SuperRack (Performer and
SoundGrid), so a Stream Deck or any other Companion surface can show a rack, step racks and
plug-ins, and switch between the Rack page and the overview.

It reaches SuperRack one of two ways:

- **Direct (ProLink).** SuperRack's own _ProLink LAWO Console Remote_ controller connects to this
  module as it would to a LAWO mc² desk. SuperRack lists its racks, so the rack dropdowns carry
  their names, and it answers every command, so a refusal shows on the surface. Nothing else to
  install.
- **Through [Remora](https://github.com/stoatworks-labs/remora).** The module sends Remora's OSC,
  and Remora drives SuperRack over MIDI or ProLink, keeps it following the desk's selected channel,
  and can send SuperRack any MIDI CC. Remora sends nothing back, so this way has no rack list and
  no feedback.

Not affiliated with, or endorsed by, Waves Audio or LAWO. SuperRack runs as licensed; the
controller this module answers is one SuperRack offers.

<!-- downloads:start -->

## Download

Not released yet.

<!-- downloads:end -->

## What it does

- **Actions:** show a rack (picked from SuperRack's list, or typed as a number or a name), show
  the rack an input channel feeds, next and previous rack, next and previous plug-in, open the
  Rack page, back to the overview, refresh the rack list. Through Remora, also follow the desk
  on, off or toggle, and send a MIDI CC.
- **Feedbacks (Direct):** SuperRack is connected, a rack is shown, and SuperRack refused a
  command.
- **Variables:** the link, SuperRack's name and address, how many racks it has, the rack it's on
  and its name, its last answer and last refusal, and every rack's name
  (`$(superrack:rack_3_name)`), which follows a rename in SuperRack.
- **Presets:** navigation, one button per rack labelled with its name (green while SuperRack is on
  it), Remora's follow and CC, and status.

## Setting it up: Direct

1. In Companion, add the **SuperRack** connection and leave _Reach SuperRack_ on **Direct**. It
   listens on TCP **50002**, the mc²'s port.
2. In SuperRack, **Setup › Controllers › + › ProLink LAWO Console Remote**. The console IP is the
   machine running Companion (127.0.0.1 if it's the same one), the port 50002 unless you changed it.
   Press **Assign**.
3. The controller's **PORT** has to be a wired Ethernet adapter: on Wi-Fi SuperRack didn't connect.
   An adapter plugged in after SuperRack started only appears there once SuperRack restarts.

**SuperRack dials once, when you press Assign.** If Companion wasn't listening yet, SuperRack says
"Failed to connect" and stops; start the connection and press Assign again.

**When you stop using it, clear the controller's assignment in SuperRack.** While it's assigned and
the console is gone, SuperRack redials about every 750 ms and logs every try.

The module takes one SuperRack at a time. **Remora uses the same port** when its Plug-in Host is
_SuperRack (ProLink)_, so on Remora's Mac either use _Through Remora_ or give one of them another
port. Remora on its MIDI route doesn't use the port, and the two can run side by side.

## Setting it up: Through Remora

1. In Remora, **Settings › Companion**: _Listen for OSC_ is on by default, on UDP **9020**.
2. In Companion, set _Reach SuperRack_ to **Through Remora**, with Remora's Mac (127.0.0.1 if it's
   this one) and the port.

Remora answers nothing over OSC, so the connection shows OK as soon as its socket is open, whether
Remora is there or not. Remora's own Plug-in Host tab is where to check that commands arrive.

## What the module knows, and what it doesn't

SuperRack answers each ProLink command and pushes its rack list whenever a rack changes, but it
**never says which rack it's on**. The module works that out from its own commands, so:

- **Rack is shown** and `$(superrack:rack_name)` are "as far as this module knows". A click on a
  rack in SuperRack's window, or a move made by Remora or a desk, isn't seen, so the feedback can
  stay on the rack this module last showed. A step past the first or last rack, a refusal, or a
  command that goes unanswered makes the position unknown, and the feedback goes dark rather than
  guess. The next _Show a rack_ puts it right.
- A rack **no input feeds** can't be shown by ProLink in one go. The module shows the nearest rack
  an input does feed, then steps Next or Previous from there, as Remora does; the racks in between
  flash past on SuperRack's screen.
- Racks are matched by number from 1, or by name the way Remora matches channel names: `head1`
  finds "Head 1", and `lec 2` finds "Lec" when only one rack is called that. Racks named "n/a" are
  only reachable by number.

Through Remora there is no feedback at all: OSC is one-way, and a command that went nowhere looks
the same as one that worked.

## Installing

It's not in the official Companion module store, and needs **Companion 5.1** or later. Download
`companion-module-superrack-pkg.tgz` from the
[releases page](https://github.com/stoatworks-labs/companion-module-superrack/releases) and import
it with Companion's **Modules › Import module package**. Or point **Settings › Developer modules
path** at a folder containing this repo, run `npm install` in it, and restart Companion.

## How it has been tested

- `npm test` runs the module's own code, as Companion would, against a pretend SuperRack on a real
  TCP socket. The pretend SuperRack makes the checks SuperRack's ProLink client makes and keeps a
  pretend screen, so the tests check where each button actually lands SuperRack, including the
  route to a rack no input feeds, renames, keepalives and a SuperRack that stops answering. Through
  Remora, it checks the OSC that goes out. You don't need Companion installed.
- The ProLink side is a port of Remora's, which was run against SuperRack Performer 15.15.12.13 on
  2026-11-07 (Remora's `docs/PROTOCOL.md`). This module was checked against an independent
  SuperRack client written for that work, and loaded into Companion 5.1.2, where a rack preset
  pressed over the HTTP API took a pretend SuperRack to a rack with no input and lit up.
- Through Remora, the module's OSC went to Remora 0.4.1 running headless, which turned every
  message into the expected MIDI.
- **This module has not yet driven a real SuperRack.**

<!-- attributions:start -->

This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT, see [LICENSE](LICENSE).
