# time-left

**See about how long is left on what Claude is doing.** Not one tool call: the whole job.

A live band above the chat box answers the question you keep asking while Claude works: *how much longer?* It reads Claude's own task list, the steps already done, the commands, agents and workflows running in the background, and how long similar work took before, and turns that into one honest line:

> **About 10–20 min left**
> Login bug fixed · Step 3 of 7 · 1 in the background

It never fakes precision. With no basis it says **No estimate yet**; when part of the work has never been timed it says **at least …**; and the range narrows as steps finish.

## Install

In a Claude Code terminal session:

```
/plugin install time-left --marketplace cagdaskalak/claude-time-left
```

From a shell:

```
claude plugin install time-left --marketplace cagdaskalak/claude-time-left
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `cagdaskalak/claude-time-left`, then **Add plugin**.

time-left is a hooks-module mod: it needs a Claude Code build with function-hook plugins (early access; built and tested on 2.1.317 and later).

## What it shows

- **Time left as a range**, from the work itself: finished steps price the ones still to do; commands, agents and workflows use how long similar ones took before (kept on your machine, last 20 of each).
- **The outcome you are waiting for**, in a few plain words.
- **Progress**: step 3 of 7, with a bar split into the steps so you can count them.
- **What runs now**, and everything in the background, in one click (**Details**).
- **A notice when a long task is done**, if you want one.

## Make it yours

**⚙ Settings** opens a side panel:

- **Profiles**: a recommended look (*Clear*), three ready-made ones (*Quiet*, *Arcade*, *Night shift*), and up to 12 of your own, saved by name.
- **Look**: 11 original bar styles (Aurora, Minimal, Neon, Comet, Liquid, Candy, Arcade, Terminal, Blocky, Jester, Night watch), 7 colours, 9 shapes (Rounded, Pill, Square, Slanted, Arrows, Hexagons, Beads, Wedge, Stairs), blocks, thickness and text size. Every option shows a live preview.
- **Behaviour**: above the chat box or in a resizable side panel; short or detailed; when it appears (at once, after 15 s, after a minute); the step list; the done notice.
- **On / off**: Auto (only while Claude works), Always on, or Off, with quick timers and your own (off for 15 min to 24 h, or until a day and time you pick). While off it keeps track quietly, so it is right the moment it is back.

Commands: `/time-left on`, `off`, `auto`, `always`, `settings`, `reset`.

Light and dark themes, readable sizes, and every animation stops when your system asks for reduced motion.

## Develop

```
claude plugin validate .
claude plugin test .
```

`hooks/register.tsx` is the mod (events, state, the band, the panels), `hooks/estimate.ts` the estimate (pure functions), `hooks/art.ts` every picture (SVG), `tests/` the tests.

## License

MIT © Cagdas Kalak
