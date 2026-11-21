# SuperRack

Shows and steps Waves SuperRack's racks and plug-ins. Not affiliated with Waves.

## Two ways to reach SuperRack

- **Direct (ProLink):** SuperRack connects to this module as it would to a LAWO mc² desk. It lists
  its racks (the dropdowns carry their names) and answers every command, so there is feedback.
- **Through Remora:** the module sends [Remora](https://github.com/stoatworks-labs/remora)'s OSC,
  and Remora drives SuperRack over MIDI or ProLink. Only this way can follow the desk and send a
  MIDI CC. With Remora's state feed pointed here, there are rack names and feedback too.

## Direct

1. Start this connection first. It listens on TCP **50002**.
2. In SuperRack: **Setup › Controllers › + › ProLink LAWO Console Remote**. Console IP = this
   Companion machine (127.0.0.1 if it's the same one), port 50002, then **Assign**.
3. The controller's **PORT** must be a wired Ethernet adapter; on Wi-Fi it didn't connect.

**SuperRack dials once, on Assign.** "Failed to connect" means this connection wasn't listening:
check its status and press Assign again.

**Clear the controller's assignment when you're done**, or SuperRack redials every 750 ms.

One SuperRack at a time. **Remora uses the same port** when its Plug-in Host is SuperRack
(ProLink): on Remora's Mac, pick Through Remora instead, or another port.

## Through Remora

Remora, **Settings › Companion**: _Listen for OSC_ (on by default), UDP **9020**. Put Remora's Mac
and that port in this connection.

**For feedback**, Remora, **Settings › Companion › Remora's state**: on, with this Companion
machine's address (127.0.0.1 if it's the same one) and _Port for Remora's state_ (**9021**). It's
off until you set it, and needs Remora 0.6.0 or later.

The module asks for Remora's state every 5 s. Nothing back for 12 s: the status warns, and the rack
and Follow feedback go dark. Commands still go. Port 0 = no state feed, no feedback.

## Which rack is shown

SuperRack never says which rack it's on. **Rack is shown** and the current-rack variables come
from this module's own commands (Direct) or Remora's state (Through Remora), and
`rack_how` says how it's known:

- `reported`: SuperRack answered the ShowRack; `seen`: Remora read SuperRack's window;
- `counted`: a Next or Previous Rack from a known rack (SuperRack says it worked, not where it
  landed); `sent`: Remora sent it, nothing answered.

The feedback lights for `reported` and `seen` unless set to _also when only counted or sent_. The
rack presets show those in amber, confirmed in green.

- A click in SuperRack's own window isn't seen. Directly, nor is a move by Remora or a desk.
- A step past the first or last rack, a refusal or no answer makes the position unknown, and the
  feedback goes dark rather than guess.

A rack no input feeds is reached by showing the nearest rack one does, then Next or Previous from
there; the racks in between flash past.

## Typing a rack

A rack field takes a number from 1 or a name. Names match loosely: `head1` finds "Head 1", and
`lec 2` finds "Lec" when only one rack has that name. Racks named "n/a" only by number. The
input-channel field of _Show the rack an input channel feeds_ takes Companion variables.
