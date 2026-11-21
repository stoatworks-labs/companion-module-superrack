# Companion — SuperRack user guide

This module runs Waves SuperRack from a Stream Deck or any other Bitfocus Companion surface: show
a rack, step racks and plug-ins, and switch between the Rack page and the overview, with buttons
that carry SuperRack's own rack names and light up for the rack it's on.

The [README](../README.md) covers installing the module. This guide is about picking the right way
to reach SuperRack and knowing what the buttons can and can't tell you.

> **Before you rely on this:** SuperRack never says which rack it's on. Everything this module
> shows about the current rack comes from its own commands, or from Remora's, so a click in
> SuperRack's window isn't seen. And the module hasn't yet driven a real SuperRack: its ProLink
> side is a port of Remora's, which has.
>
> This module was built with AI assistance, directed and reviewed by a human author. It isn't
> affiliated with Waves or LAWO.

---

## Direct or Through Remora

|                                 | Direct (ProLink)                           | Through Remora                                      |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| What's in between               | nothing: SuperRack connects to this module | Remora, which drives SuperRack over MIDI or ProLink |
| Rack dropdowns                  | SuperRack's racks, by name                 | by name with Remora's state feed, else typed        |
| Feedback                        | reachable, rack shown, refusals            | with the state feed: reachable, rack shown, Follow  |
| Show the rack a channel feeds   | yes                                        | no                                                  |
| Follow the desk, send a MIDI CC | no                                         | yes                                                 |
| SuperRack on another computer   | yes                                        | as Remora allows                                    |

**Pick Direct** when Companion is the only thing driving SuperRack, or when Remora is on its MIDI
route: you get names and feedback.

**Pick Through Remora** when Remora already holds SuperRack's ProLink link, or when you want
buttons that turn following on and off. Turn on Remora's state feed and you get names and
feedback this way too. Every action exists in both modes, so a page built one way
keeps working when you switch; the few that only one way can do say so in their name.

---

## Direct: connecting

1. In Companion, add the **SuperRack** connection on **Direct**. It listens on TCP **50002**.
2. In SuperRack: **Setup › Controllers › + › ProLink LAWO Console Remote**. The console IP is
   Companion's machine (127.0.0.1 if it's the same one), the port 50002, then **Assign**.
3. The controller's **PORT** must be a **wired** Ethernet adapter. On Wi-Fi SuperRack didn't
   connect. A USB adapter on an unmanaged switch with a self-assigned address worked; one plugged
   in after SuperRack started only appeared in the list after a restart.

**Order matters: start the connection, then press Assign.** SuperRack dials once. If nothing was
listening it says "Failed to connect" and gives up until you press Assign again.

Once connected, the connection's status goes green, `$(superrack:superrack)` gives SuperRack's
name for itself, and the Presets tab gets one button per rack.

**Finished with it? Clear the controller's assignment in SuperRack** (Clear Assignments, then
Apply). An assigned controller whose console has gone redials about every 750 ms and logs every
try.

### When it won't connect

- **Status says the port is in use.** Something else holds 50002, usually Remora with its Plug-in
  Host on SuperRack (ProLink). Use Through Remora, or move one of them to another port (and type
  that port in SuperRack's controller).
- **"Failed to connect" in SuperRack.** The connection wasn't listening when Assign was pressed,
  or the IP is wrong, or the controller's PORT is Wi-Fi.
- **A second SuperRack** is turned away: the module takes one at a time.

---

## Showing a rack

_Show a rack_ takes a rack from SuperRack's list, or a number or a name you type:

- **A number** is the rack's place in SuperRack's list, from 1.
- **A name** matches loosely: `head1` finds "Head 1", and `lec 2` finds "Lec" when only one rack
  has that name. Racks called "n/a" can only be reached by number. Two racks with the same name are
  offered by number.

The rack presets use numbers and show the rack's name from `$(superrack:rack_N_name)`, so renaming
a rack in SuperRack relabels its button and doesn't break it. Adding or removing a rack in the
middle of the list does move the racks after it.

**How a rack is reached.** ProLink shows a rack by an input channel that feeds it, the way an mc²'s
hot-rack key does. A rack with an input is one command. A rack **no input feeds** can't be shown
directly, so the module shows the nearest rack that has an input and steps Next or Previous from
there. The racks in between flash past on SuperRack's screen; it's quick, but you'll see it.

_Show the rack an input channel feeds_ (Direct only) takes a channel number from 1 and shows the
rack that channel feeds. SuperRack refuses a channel no rack takes, and the refusal shows up.

---

## Reading the feedbacks

| Feedback                     | Lights when                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------- |
| SuperRack is reachable       | Direct: the ProLink link is up. Through Remora: its state arrives, no problem |
| Rack is shown                | SuperRack is on that rack, as far as the module knows (see below)             |
| Remora is following the desk | Remora's Follow is on (Through Remora, with the state feed)                   |
| SuperRack refused a command  | SuperRack answered a command with an error in the last few seconds (Direct)   |

**Rack is shown is "as far as this module knows", and how it knows matters.** The `rack_how`
variable says which:

- **reported:** SuperRack answered the ShowRack that put it there.
- **seen:** Remora read the rack's name in SuperRack's window (Through Remora, with Accessibility).
- **counted:** Next or Previous Rack from a rack that was known. SuperRack says the step worked,
  not where it landed. A rack no input feeds always ends this way, and so does SuperRack over MIDI
  without Accessibility.
- **sent:** Remora sent a command and nothing has answered.

The feedback lights only for **reported** and **seen** unless you set _Light when_ to _also when
it was only counted or sent_. The rack presets do both: **amber** for counted or sent, **green**
once confirmed.

- A click in SuperRack's own window isn't seen either way. Directly, nor is a move made by Remora
  or a desk; through Remora, Remora's own moves (following the desk) do show.
- After a step past the first or last rack, a refusal, or a command SuperRack didn't answer within
  a second, the module doesn't know where SuperRack is, and every rack button goes dark. It
  doesn't guess.
- The next _Show a rack_ puts it right.

The **Status** presets show the link, the rack the module thinks SuperRack is on and how it knows,
and (Direct) SuperRack's last refusal. They're worth having on any page of rack buttons.

---

## Through Remora

In Remora, **Settings › Companion**: _Listen for OSC_ is on by default, on UDP **9020**. In
Companion, pick **Through Remora**, with Remora's Mac and that port.

The buttons send Remora's OSC (`/remora/rack/select`, `/remora/rack/next` and so on), and Remora
moves SuperRack however its Plug-in Host is set up. A typed rack is passed on as typed: a number as
a number, a name as a name. Remora matches it with the same rule as above.

### Remora's state, for feedback

Remora answers nothing to a command, but it can send what it knows to the module. In Remora,
**Settings › Companion › Remora's state**: turn it on, with the address of the machine running
Companion (127.0.0.1 if it's the same one) and the module's _Port for Remora's state_ (UDP
**9021**). It's off until you set it, and it needs a Remora release after 0.5.0.

With it on, you get:

- the rack dropdowns and rack presets with Remora's rack names, relabelled when a rack is renamed;
- the rack SuperRack is on and how Remora knows it, including moves Remora made itself, following
  the desk;
- **Remora is following the desk**, lit on the Follow presets;
- **SuperRack is reachable**, and a warning status with Remora's own words when Remora can't reach
  SuperRack ("not connected (Remora is waiting on TCP 50002)").

The module asks Remora for its state when it starts and every 5 seconds. **Nothing back for 12
seconds** and the status warns that no state is arriving, and the rack and Follow buttons go dark:
commands still go out, but there's no telling where they land. It picks up again on the next
answer.

### Without the state feed

Set _Port for Remora's state_ to 0. The connection then goes green as soon as its socket is open,
whether Remora is running or not, and a command that went nowhere looks the same as one that
worked. If a button seems dead, look at Remora's Plug-in Host tab.

**Follow the desk** turns Remora's following on, off, or toggles it. **Send a MIDI CC** sends any
CC to SuperRack on Remora's MIDI channel, for anything you've mapped in SuperRack that the other
buttons don't cover.
