# Companion — SuperRack user guide

This module runs Waves SuperRack from a Stream Deck or any other Bitfocus Companion surface: show
a rack, step racks and plug-ins, and switch between the Rack page and the overview, with buttons
that carry SuperRack's own rack names and light up for the rack it's on.

The [README](../README.md) covers installing the module. This guide is about picking the right way
to reach SuperRack and knowing what the buttons can and can't tell you.

> **Before you rely on this:** SuperRack never says which rack it's on. Everything this module
> shows about the current rack comes from its own commands, so a click in SuperRack's window isn't
> seen. And the module hasn't yet driven a real SuperRack: its ProLink side is a port of Remora's,
> which has.
>
> This module was built with AI assistance, directed and reviewed by a human author. It isn't
> affiliated with Waves or LAWO.

---

## Direct or Through Remora

|                                 | Direct (ProLink)                           | Through Remora                                      |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| What's in between               | nothing: SuperRack connects to this module | Remora, which drives SuperRack over MIDI or ProLink |
| Rack dropdowns                  | SuperRack's racks, by name                 | typed numbers or names                              |
| Feedback                        | connected, rack shown, refusals            | none                                                |
| Show the rack a channel feeds   | yes                                        | no                                                  |
| Follow the desk, send a MIDI CC | no                                         | yes                                                 |
| SuperRack on another computer   | yes                                        | as Remora allows                                    |

**Pick Direct** when Companion is the only thing driving SuperRack, or when Remora is on its MIDI
route: you get names and feedback.

**Pick Through Remora** when Remora already holds SuperRack's ProLink link, or when you want
buttons that turn following on and off. Every action exists in both modes, so a page built one way
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

| Feedback                    | Lights when                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| SuperRack is connected      | the ProLink link is up                                             |
| Rack is shown               | this module's last move landed on that rack                        |
| SuperRack refused a command | SuperRack answered a command with an error in the last few seconds |

**Rack is shown is "as far as this module knows".**

- A click in SuperRack's window, or a move made by Remora or a desk, isn't seen. The button stays
  on the rack this module last showed.
- After a step past the first or last rack, a refusal, or a command SuperRack didn't answer within
  a second, the module doesn't know where SuperRack is, and every rack button goes dark. It
  doesn't guess.
- The next _Show a rack_ puts it right.

The **Status** presets show the link, the rack the module thinks SuperRack is on, and SuperRack's
last refusal. They're worth having on any page of rack buttons.

---

## Through Remora

In Remora, **Settings › Companion**: _Listen for OSC_ is on by default, on UDP **9020**. In
Companion, pick **Through Remora**, with Remora's Mac and that port.

The buttons send Remora's OSC (`/remora/rack/select`, `/remora/rack/next` and so on), and Remora
moves SuperRack however its Plug-in Host is set up. A typed rack is passed on as typed: a number as
a number, a name as a name. Remora matches it with the same rule as above.

Remora sends nothing back. The connection goes green as soon as its socket is open, whether Remora
is running or not, and a command that went nowhere looks the same as one that worked. If a button
seems dead, look at Remora's Plug-in Host tab.

**Follow the desk** turns Remora's following on, off, or toggles it. **Send a MIDI CC** sends any
CC to SuperRack on Remora's MIDI channel, for anything you've mapped in SuperRack that the other
buttons don't cover.
