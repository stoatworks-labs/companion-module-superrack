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
  and can send SuperRack any MIDI CC. With Remora's state feed pointed at the module, Remora also
  says which racks there are, the rack SuperRack is on and how it knows, and whether it's
  following, so this way gets rack names and feedback too.

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
- **Feedbacks:** SuperRack is reachable, a rack is shown (only once confirmed, or also when only
  counted), Remora is following the desk, and SuperRack refused a command (Direct).
- **Variables:** the link, SuperRack's name and address, how many racks it has, the rack it's on,
  its name and how that's known, Remora's Follow and any problem it reports, SuperRack's last
  answer and refusal (Direct), and every rack's name (`$(superrack:rack_3_name)`), which follows a
  rename in SuperRack.
- **Presets:** navigation, one button per rack labelled with its name (green while SuperRack is
  confirmed on it, amber when it got there only by count), Remora's Follow (green while following)
  and CC, and status.

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
3. For feedback, in Remora, **Settings › Companion › Remora's state**: turn it on, with the address
   of the machine running Companion (127.0.0.1 if it's the same one) and the module's _Port for
   Remora's state_ (UDP **9021**). It's off until you do this. The state feed needs a Remora
   release after 0.5.0.

The module asks Remora for its state when it starts and every 5 seconds after, so the connection
goes green only while Remora is answering. If nothing comes back for 12 seconds, the status says
so, and the rack and Follow buttons go dark: commands still go out, but there's no telling where
they land. Set _Port for Remora's state_ to 0 to go without the feed; the connection then shows
OK as soon as its socket is open, whether Remora is there or not.

## What the module knows, and what it doesn't

SuperRack answers each ProLink command and pushes its rack list whenever a rack changes, but it
**never says which rack it's on**. Directly, the module works that out from its own commands;
through Remora, it takes Remora's word, which Remora works out the same way. So:

- **Rack is shown** and `$(superrack:rack_name)` are "as far as this module knows", and
  `$(superrack:rack_how)` says how:
  - `reported`: SuperRack answered the ShowRack that put it there;
  - `seen`: Remora read the rack's name in SuperRack's window;
  - `counted`: Next or Previous Rack from a rack that was known. SuperRack says the step worked,
    not where it landed;
  - `sent`: Remora sent a command and nothing has answered.

  By default the feedback lights only for `reported` and `seen`; the rack presets also show
  `counted` and `sent`, in amber.

- A click on a rack in SuperRack's own window isn't seen either way, so the feedback can stay on the
  rack last shown. Directly, a move made by Remora or a desk isn't seen either; through Remora,
  Remora's own moves (following the desk, say) do show. A step past the first or last rack, a
  refusal, or a command that goes unanswered makes the position unknown, and the feedback goes dark
  rather than guess. The next _Show a rack_ puts it right.
- A rack **no input feeds** can't be shown by ProLink in one go. The module shows the nearest rack
  an input does feed, then steps Next or Previous from there, as Remora does; the racks in between
  flash past on SuperRack's screen.
- Racks are matched by number from 1, or by name the way Remora matches channel names: `head1`
  finds "Head 1", and `lec 2` finds "Lec" when only one rack is called that. Racks named "n/a" are
  only reachable by number.

Through Remora without the state feed there is no feedback at all: Remora answers nothing to a
command, so one that went nowhere looks the same as one that worked.

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
  Remora, it checks the OSC that goes out, and runs a pretend Remora state feed: racks, the rack and
  how it's known, Follow, a problem, Remora going quiet and coming back, and the port being taken.
  You don't need Companion installed.
- The ProLink side is a port of Remora's, which was run against SuperRack Performer 15.15.12.13 on
  2026-11-07 (Remora's `docs/PROTOCOL.md`). This module was checked against an independent
  SuperRack client written for that work, and loaded into Companion 5.1.2, where a rack preset
  pressed over the HTTP API took a pretend SuperRack to a rack with no input and its feedback
  followed.
- Through Remora, the module's OSC went to Remora 0.4.1 running headless, which turned every
  message into the expected MIDI. The state feed was run end to end against Remora built from its
  main branch (headless, scratch settings), with the pretend SuperRack on Remora's ProLink port: the
  racks reached the module through Remora, a rack shown by name came back `reported`, a rack with
  no input came back `counted`, Follow and Remora's "not connected" problem came through. The
  same chain through Companion 5.1.2, with buttons pressed over the HTTP API: the Vox rack button
  went green, the button for a rack with no input went amber, and the Follow toggle went green.
- **This module has not yet driven a real SuperRack.**

<!-- attributions:start -->

This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT, see [LICENSE](LICENSE).
