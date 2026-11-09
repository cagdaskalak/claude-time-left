import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Accent, BarStyle, Bg, History, Job, Look, Prefs, Profile, Shape, Step, StepStatus, TimerDraft } from '../types'
import { ACCENTS, barSvg, shapesFor, barText, bellSvg, clockSvg, dotSvg, powerSvg, SHAPES, STYLES, swatchSvg, THICKNESS, timerSvg, wireSvg } from './art'
import { estimate, formatLeft, formatSpan, shellKey, stepKey } from './estimate'

// ---------------------------------------------------------------- state

const DEFAULT_PREFS: Prefs = {
  view: 'compact',
  accent: 'calm',
  showSteps: true,
  notify: true,
  showAfter: 15,
  place: 'band',
  size: 'medium',
  style: 'aurora',
  blocks: 'auto',
  shape: 'rounded',
  thickness: 'medium',
  power: 'auto',
}
const PANE = 'time-left'
const SETTINGS = 'time-left-settings'

/** Old names from earlier versions, so a saved look carries over. */
const OLD_STYLES: Record<string, BarStyle> = { smooth: 'aurora', serious: 'minimal', retro: 'terminal', pixel: 'arcade', fun: 'candy' }

/** Settings as stored, made whole and safe: anything unknown falls back to the default. */
function normalize(raw: unknown): Prefs {
  const x = { ...DEFAULT_PREFS, ...((raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs>) }
  const style = OLD_STYLES[x.style as string] ?? x.style
  const pick = <T extends string>(v: T, ok: readonly string[], d: T): T => (ok.includes(v) ? v : d)
  return {
    ...x,
    style: pick(style, Object.keys(STYLES), DEFAULT_PREFS.style),
    accent: pick(x.accent, Object.keys(ACCENTS), DEFAULT_PREFS.accent),
    shape: pick(x.shape, Object.keys(SHAPES), DEFAULT_PREFS.shape),
    thickness: pick(x.thickness, Object.keys(THICKNESS), DEFAULT_PREFS.thickness),
    blocks: pick(x.blocks, ['auto', 'none', '5', '10', '20', '30'], DEFAULT_PREFS.blocks),
    size: pick(x.size, ['small', 'medium', 'large'], DEFAULT_PREFS.size),
    view: pick(x.view, ['compact', 'detailed'], DEFAULT_PREFS.view),
    place: pick(x.place, ['band', 'panel'], DEFAULT_PREFS.place),
    power: pick(x.power, ['auto', 'always', 'off'], DEFAULT_PREFS.power),
    showAfter: [0, 15, 60].includes(Number(x.showAfter)) ? Number(x.showAfter) : DEFAULT_PREFS.showAfter,
  }
}

const job = atom({ plugin: 'time-left', key: 'job' } as const, null, { shape: 'job-1' })
const prefs = atom({ plugin: 'time-left', key: 'prefs' } as const, DEFAULT_PREFS, { shape: 'prefs-3' })
const tick = atom({ plugin: 'time-left', key: 'tick' } as const, 0)
const isExpanded = atom({ plugin: 'time-left', key: 'isExpanded' } as const, false)
const settingsTab = atom({ plugin: 'time-left', key: 'settingsTab' } as const, 'closed')
const profiles = atom({ plugin: 'time-left', key: 'profiles' } as const, [], { shape: 'profiles-1' })
const activeProfile = atom({ plugin: 'time-left', key: 'activeProfile' } as const, '')
const notice = atom({ plugin: 'time-left', key: 'notice' } as const, '')
const lastDeleted = atom({ plugin: 'time-left', key: 'lastDeleted' } as const, null, { shape: 'deleted-1' })
const DEFAULT_DRAFT: TimerDraft = { action: 'off', mode: 'for', minutes: 60, day: 1, time: '08:00' }
const timerDraft = atom({ plugin: 'time-left', key: 'timerDraft' } as const, DEFAULT_DRAFT, { shape: 'draft-1' })

// ---------------------------------------------------------------- profiles

/** How many looks a person can save: enough for every mood, few enough to fit the panel at a glance. */
const MAX_PROFILES = 12
const MAX_NAME = 24

const lookOf = (p: Prefs): Look => {
  const { power: _p, powerUntil: _u, powerSince: _s, offAfterJob: _o, hideRecommended: _r, ...look } = p
  void _r
  void _p
  void _u
  void _s
  void _o
  return look
}

/** Ready-made looks. The first is the one recommended. */
const STARTERS: { profile: Profile; why: string }[] = [
  {
    profile: { name: 'Clear', look: lookOf(DEFAULT_PREFS) },
    why: 'Easiest to read at a glance: the time left is big, the bar is split into the steps so you can count them, it stays hidden for quick answers (it waits 15 s), and it tells you when a long task ends.',
  },
  {
    profile: {
      name: 'Quiet',
      look: { ...lookOf(DEFAULT_PREFS), style: 'minimal', accent: 'mono', thickness: 'thin', size: 'small', showAfter: 60, notify: false },
    },
    why: 'Out of the way: a thin grey line, small text, and only for tasks longer than a minute.',
  },
  {
    profile: {
      name: 'Arcade',
      look: { ...lookOf(DEFAULT_PREFS), style: 'arcade', accent: 'rgb', thickness: 'thick', size: 'large', shape: 'square' },
    },
    why: 'Fun: 8-bit rainbow blocks and big text.',
  },
  {
    profile: {
      name: 'Night shift',
      look: { ...lookOf(DEFAULT_PREFS), style: 'night', shape: 'chevron', thickness: 'thick', view: 'detailed' },
    },
    why: 'For long runs: gold arrows on dark steel, with every step listed.',
  },
]

const sameLook = (a: Look, b: Look) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

async function say($: $, text: string): Promise<void> {
  await update($, notice, () => text)
}

async function useProfile($: $, pr: Profile): Promise<void> {
  const before = normalize(await read($, prefs))
  await setPrefs($, x => normalize({ ...x, ...pr.look }))
  await update($, activeProfile, () => pr.name)
  await $.store.set('activeProfile', pr.name)
  if (pr.look.place !== before.place) await placeIt($, pr.look.place)
  await say($, `Using “${pr.name}”.`)
}

async function saveProfile($: $, rawName: string): Promise<void> {
  const name = rawName.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)
  if (!name) return say($, 'Type a name first.')
  if (STARTERS.some(st => st.profile.name.toLowerCase() === name.toLowerCase()))
    return say($, `“${name}” is a ready-made look. Pick another name.`)
  const look = lookOf(normalize(await read($, prefs)))
  const list = await read($, profiles)
  const at = list.findIndex(x => x.name.toLowerCase() === name.toLowerCase())
  if (at < 0 && list.length >= MAX_PROFILES) return say($, `You have ${MAX_PROFILES} saved. Delete one to save another.`)
  const next = at >= 0 ? list.map((x, i) => (i === at ? { name, look } : x)) : [...list, { name, look }]
  await update($, profiles, () => next)
  await $.store.set('profiles', next)
  await update($, activeProfile, () => name)
  await $.store.set('activeProfile', name)
  await say($, at >= 0 ? `Updated “${name}”.` : `Saved “${name}”.`)
}

async function deleteProfile($: $, name: string): Promise<void> {
  const list = await read($, profiles)
  const gone = list.find(x => x.name === name)
  if (!gone) return
  const next = list.filter(x => x.name !== name)
  await update($, profiles, () => next)
  await $.store.set('profiles', next)
  await update($, lastDeleted, () => gone)
  if ((await read($, activeProfile)) === name) {
    await update($, activeProfile, () => '')
    await $.store.set('activeProfile', '')
  }
  await say($, `Deleted “${name}”.`)
}

async function undoDelete($: $): Promise<void> {
  const gone = await read($, lastDeleted)
  if (!gone) return
  const list = await read($, profiles)
  if (list.length >= MAX_PROFILES) return say($, `You have ${MAX_PROFILES} saved. Delete one first.`)
  const next = [...list.filter(x => x.name !== gone.name), gone]
  await update($, profiles, () => next)
  await $.store.set('profiles', next)
  await update($, lastDeleted, () => null)
  await say($, `Brought back “${gone.name}”.`)
}

type $ = EngineInterface

const HISTORY = 'history-1'
const KEEP = 20

async function loadHistory($: $): Promise<History> {
  const stored = await $.store.get(HISTORY)
  return stored && typeof stored === 'object' ? (stored as History) : {}
}

/** Remember how long a kind of work took, for next time. */
async function remember($: $, keys: string[], ms: number): Promise<void> {
  if (!(ms > 2000)) return
  const hist = await loadHistory($)
  for (const k of keys) hist[k] = [...(hist[k] ?? []), Math.round(ms)].slice(-KEEP)
  await $.store.set(HISTORY, hist)
}

async function setPrefs($: $, fn: (p: Prefs) => Prefs): Promise<void> {
  const next = await update($, prefs, p => fn(normalize(p)))
  await $.store.set('prefs', next)
  await update($, notice, () => '')
}

/** The power in force now: a timer that ran out means Auto again. */
function powerNow(p: Prefs, now: number): Prefs['power'] {
  return p.powerUntil !== undefined && now >= p.powerUntil ? 'auto' : p.power
}

/** Sets the power, with an optional timer after which it goes back to Auto. */
async function setPower($: $, power: Prefs['power'], forMs?: number): Promise<void> {
  const now = await $.clock.now()
  const until = forMs !== undefined ? now + forMs : undefined
  await setPrefs($, x => ({ ...x, power, powerUntil: until, powerSince: until !== undefined ? now : undefined, offAfterJob: false }))
  if (until !== undefined) armTimer($, until)
  if (power !== 'off') {
    // Back on: bring a job in progress up to date at once.
    await update($, tick, n => (n + 1) % 1_000_000)
    const j = await read($, job)
    if (isActive(j) && j.prompt && j.outcome === roughOutcome(j.prompt)) void nameJob($, j.id, j.prompt)
  }
}

/** Sets the power until a moment, then back to Auto. */
async function setPowerUntil($: $, power: Prefs['power'], until: number): Promise<void> {
  await setPower($, power, until - (await $.clock.now()))
}

async function cancelTimer($: $): Promise<void> {
  await setPrefs($, x => ({ ...x, power: 'auto', powerUntil: undefined, powerSince: undefined, offAfterJob: false }))
}

/** One timer for the power's end; a reload arms it again from what is stored. */
function armTimer($: $, until: number): void {
  void $.clock.now().then(now => {
    $.clock.after(Math.max(0, until - now) + 500, () => {
      void (async () => {
        const p = normalize(await read($, prefs))
        if (p.powerUntil !== undefined && p.powerUntil <= (await $.clock.now()))
          await setPrefs($, x => ({ ...x, power: 'auto', powerUntil: undefined, powerSince: undefined }))
      })()
    })
  })
}

function nameJob($: $, id: string, text: string): Promise<unknown> {
  return summarize($, text)
    .then(o => (o ? update($, job, x => (x && x.id === id ? { ...x, outcome: o } : x)) : undefined))
    .catch(() => undefined)
}

async function isOff($: $): Promise<boolean> {
  return powerNow(normalize(await read($, prefs)), await $.clock.now()) === 'off'
}

function mutate($: $, fn: (j: Job) => Job): Promise<unknown> {
  return update($, job, j => (j ? fn(j) : j))
}

function isActive(j: Job | null): j is Job {
  return j !== null && j.endedAt === undefined
}

// ---------------------------------------------------------------- words

/** A few plain words for what the person asked, without a model. */
function roughOutcome(prompt: string): string {
  const firstLine =
    prompt
      .replace(/<[^>]+>/g, ' ')
      .split(/\n|(?<=[.!?])\s/)
      .map(s => s.trim())
      .find(s => s.length > 3) ?? 'Current task'
  const words = firstLine.split(/\s+/).slice(0, 5).join(' ')
  return words.length > 36 ? words.slice(0, 35) + '…' : words
}

async function summarize($: $, prompt: string): Promise<string | undefined> {
  const r = await $.model.complete({
    model: 'haiku',
    system:
      'You name what a person is waiting for. Answer with 2 to 4 plain words, at most 30 characters, sentence case, no quotes, no full stop. Name the result the person will get, e.g. \"Time-left mod\", \"Login bug fixed\", \"Video rendered\", \"Band redesign\".',
    prompt: prompt.slice(0, 4000),
    maxTokens: 24,
    timeoutMs: 15_000,
  })
  if (!r.isAnswered) return undefined
  const t = r.text.trim().replace(/^["'“]|["'”.]$/g, '').split('\n')[0]
  return t && t.length <= 36 ? t : undefined
}

/** What a tool call is doing, in a few words; undefined for quiet ones. */
function describe(e: { tool: string } & Record<string, unknown>): string | undefined {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : undefined)
  const short = (t: string, n = 48) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
  if (/__update_plan$|__wrap_up$|^TodoWrite$|^ToolSearch$/.test(tool)) return undefined
  switch (tool) {
    case 'Bash':
      return short(s('description') ?? s('command') ?? 'a command')
    case 'Agent':
      return `Agent: ${short(s('description') ?? 'a helper')}`
    case 'Workflow':
      return 'Starting a workflow'
    case 'Read':
      return `Reading ${short((s('file_path') ?? '').split('/').pop() ?? 'a file', 36)}`
    case 'Edit':
    case 'Write':
      return `Editing ${short((s('file_path') ?? '').split('/').pop() ?? 'a file', 36)}`
    case 'Grep':
    case 'Glob':
      return 'Searching the code'
    case 'WebFetch':
    case 'WebSearch':
      return 'Looking on the web'
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').pop() ?? tool
    return short(name.replace(/_/g, ' '))
  }
  return tool
}

function workflowMeta(e: Record<string, unknown>): { name: string; phases: string[] } {
  const script = typeof e.script === 'string' ? e.script : ''
  const name =
    (typeof e.name === 'string' && e.name) ||
    script.match(/name\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ||
    (typeof e.scriptPath === 'string' ? e.scriptPath.split('/').pop()?.replace(/\.\w+$/, '') : undefined) ||
    'workflow'
  const phasesBlock = script.match(/phases\s*:\s*\[([\s\S]*?)\]\s*,?\s*\}/)?.[1] ?? ''
  const phases = [...phasesBlock.matchAll(/title\s*:\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1] ?? '')
  return { name, phases }
}

function idsIn(text: string | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const m of text.matchAll(/\b(?:ID|id|Id|task[_ ]?id|agentId|agent_id)\s*[:=]\s*["'`]?([A-Za-z0-9_-]{5,})/g)) out.add(m[1] ?? '')
  for (const m of text.matchAll(/\b(wf_[A-Za-z0-9-]{4,})/g)) out.add(m[1] ?? '')
  return [...out]
}

// ---------------------------------------------------------------- the plan

type PlanItem = { content: string; status: StepStatus }

function applyItems(steps: Step[], items: PlanItem[], now: number): { steps: Step[]; finished: Step[] } {
  const finished: Step[] = []
  const next = items.map(it => {
    const old = steps.find(s => s.text === it.content)
    const s: Step = { text: it.content, status: it.status, startedAt: old?.startedAt, endedAt: old?.endedAt }
    if (it.status === 'in_progress' && s.startedAt === undefined) s.startedAt = now
    if (it.status === 'completed' && old && old.status !== 'completed') {
      s.startedAt ??= old.startedAt
      s.endedAt = now
      finished.push(s)
    }
    if (it.status !== 'completed') s.endedAt = undefined
    return s
  })
  return { steps: next, finished }
}

function complete(s: Step, now: number): Step {
  return { ...s, status: 'completed', endedAt: now }
}

function applyPlanCall(steps: Step[], e: Record<string, unknown>, now: number): { steps: Step[]; finished: Step[] } {
  if (Array.isArray(e.items)) {
    const items = (e.items as Record<string, unknown>[]).map(i => ({
      content: String(i.content ?? ''),
      status: (['pending', 'in_progress', 'completed'].includes(String(i.status)) ? i.status : 'pending') as StepStatus,
    }))
    return applyItems(steps, items, now)
  }
  const finished: Step[] = []
  let out = steps.map(s => ({ ...s }))
  const finish = (i: number) => {
    if (out[i] && out[i].status !== 'completed') {
      out[i] = complete(out[i], now)
      finished.push(out[i])
    }
  }
  const startAt = (i: number) => {
    if (out[i] && out[i].status !== 'completed') out[i] = { ...out[i], status: 'in_progress', startedAt: now }
  }
  if (e.advance === true) {
    const cur = out.findIndex(s => s.status === 'in_progress')
    if (cur >= 0) finish(cur)
    const nxt = out.findIndex(s => s.status === 'pending')
    if (nxt >= 0) startAt(nxt)
  }
  if (Array.isArray(e.done)) for (const n of e.done as number[]) finish(n - 1)
  if (typeof e.start === 'number') {
    out = out.map(s => (s.status === 'in_progress' ? s : s))
    startAt(e.start - 1)
  }
  return { steps: out, finished }
}

// ---------------------------------------------------------------- the job's end

async function maybeFinish($: $): Promise<void> {
  const j = await read($, job)
  if (!isActive(j) || j.isTurnRunning) return
  if (j.bg.some(b => b.endedAt === undefined) || (j.engineBgCount ?? 0) > 0) return
  const now = await $.clock.now()
  await mutate($, x => ({
    ...x,
    endedAt: now,
    now: undefined,
    steps: x.steps.map(s => (s.status === 'in_progress' ? complete(s, now) : s)),
  }))
  await remember($, ['job:*'], now - j.startedAt)
  const p = normalize(await read($, prefs))
  if (p.offAfterJob) await setPrefs($, x => ({ ...x, power: 'off', powerUntil: undefined, offAfterJob: false }))
  if (p.notify && powerNow(p, now) !== 'off' && now - j.startedAt > 60_000) {
    const text = `Done: ${j.outcome} (took ${formatSpan(now - j.startedAt)})`
    const sent = await $.ui.notify(text, { title: 'Claude finished' }).catch(() => ({ isSent: false }))
    if (!sent.isSent) $.ui.toast(text, { timeoutMs: 8000 })
  }
}

async function endBg($: $, match: (b: Bg) => boolean): Promise<void> {
  const now = await $.clock.now()
  const ended: Bg[] = []
  await mutate($, j => ({
    ...j,
    bg: j.bg.map(b => {
      if (b.endedAt !== undefined || !match(b)) return b
      const done = { ...b, endedAt: now }
      ended.push(done)
      return done
    }),
  }))
  // The engine's own count drops with what ended since its last word.
  if (ended.length) await mutate($, j => ({ ...j, engineBgCount: Math.max(0, (j.engineBgCount ?? 0) - ended.length) }))
  for (const b of ended) await remember($, [b.sig], now - b.startedAt)
}

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('prefs')
    if (stored && typeof stored === 'object') await update($, prefs, () => (normalize(stored)))
    const pr = normalize(stored)
    if (pr.place === 'panel') void $.ui.open({ id: PANE, title: 'Time left' })
    if (pr.powerUntil !== undefined) armTimer($, pr.powerUntil)
    if ((await read($, settingsTab)) !== 'closed') void $.ui.open({ id: SETTINGS, title: 'Time left · settings' })
    const savedProfiles = await $.store.get('profiles')
    if (Array.isArray(savedProfiles))
      await update($, profiles, () =>
        (savedProfiles as Profile[])
          .filter(x => x && typeof x.name === 'string')
          .slice(0, MAX_PROFILES)
          .map(x => ({ name: x.name.slice(0, MAX_NAME), look: lookOf(normalize(x.look)) })),
      )
    const savedActive = await $.store.get('activeProfile')
    if (typeof savedActive === 'string') await update($, activeProfile, () => savedActive)
    await $.command.register({ name: 'time-left', description: 'Time left: /time-left on, off, auto, always, settings, or reset' })
    $.clock.every(5000, () => {
      void (async () => {
        // Redraws only while a job runs and the mod is on: idle and off cost nothing.
        if (isActive(await read($, job)) && !(await isOff($))) await update($, tick, n => (n + 1) % 1_000_000)
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'time-left' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (/reset/.test(arg)) {
      await setPrefs($, () => DEFAULT_PREFS)
      return { text: 'Time-left settings are back to the defaults.' }
    }
    if (arg === 'off') {
      await setPower($, 'off')
      return { text: 'Time left is off. Type /time-left on to bring it back.' }
    }
    if (arg === 'always') {
      await setPower($, 'always')
      return { text: 'Time left is always on now, idle too.' }
    }
    if (arg === 'auto' || arg === 'on') {
      await setPower($, 'auto')
      await mutate($, j => ({ ...j, isDismissed: false }))
      return { text: 'Time left is on: it shows while Claude works.' }
    }
    if (arg === 'settings') {
      await openSettings($)
      return { text: 'Time-left settings are open in the side panel.' }
    }
    await mutate($, j => ({ ...j, isDismissed: false }))
    const pr = normalize(await read($, prefs))
    if (pr.place === 'panel') {
      await $.ui.open({ id: PANE, title: 'Time left' })
      return { text: 'The time-left panel is open beside the chat.' }
    }
    return { text: 'The time-left band shows above the prompt while Claude works.' }
  })

  // A new ask from the person starts a job; a background task's notice ends a piece.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    const now = await $.clock.now()
    if (kind === 'task-notification') {
      const ids = [...e.text.matchAll(/<(?:task-id|tool-use-id)>([^<]+)</g)].map(m => (m[1] ?? '').trim())
      if (ids.length) await endBg($, b => ids.includes(b.id) || b.aliases.some(a => ids.includes(a)))
    } else {
      const j = await read($, job)
      if (!isActive(j) && e.text.trim().length > 0) {
        const id = `job-${now}`
        const prompt = e.text
        await update($, job, () => ({
          id,
          outcome: roughOutcome(prompt),
          prompt: prompt.slice(0, 2000),
          startedAt: now,
          steps: [],
          bg: [],
          isTurnRunning: true,
        }))
        await update($, isExpanded, () => false)
        if (!(await isOff($))) void nameJob($, id, prompt)
      }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await mutate($, j => (isActive(j) ? { ...j, isTurnRunning: true } : j))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId === undefined) {
      await mutate($, j => ({ ...j, isTurnRunning: false, now: undefined }))
      $.clock.after(1500, () => void maybeFinish($))
    } else {
      const id = e.agentId
      await mutate($, j => ({
        ...j,
        bg: j.bg.map(b =>
          b.agentIds?.includes(id) && !b.doneAgentIds?.includes(id)
            ? { ...b, doneAgentIds: [...(b.doneAgentIds ?? []), id] }
            : b,
        ),
      }))
      await endBg($, b => b.kind === 'agent' && b.aliases.includes(id))
      void now
    }
    return next(e)
  })

  // The engine's own list of background work in flight, at each stop.
  on('classic.Stop', async ($, e, next) => {
    const list = e.background_tasks ?? []
    const j = await read($, job)
    if (isActive(j)) {
      const live = (b: Bg) =>
        list.some(t => b.aliases.includes(t.id) || t.id === b.id || (t.description && t.description === b.label))
      await endBg($, b => !live(b))
      const now = await $.clock.now()
      await mutate($, x => {
        const known = (t: (typeof list)[number]) =>
          x.bg.some(b => b.aliases.includes(t.id) || t.id === b.id || (t.description && t.description === b.label))
        const added: Bg[] = list
          .filter(t => !known(t))
          .map(t => ({
            id: t.id,
            kind: t.type === 'workflow' ? 'workflow' : t.type === 'shell' ? 'shell' : 'agent',
            label: (t.name ?? t.description ?? t.command ?? 'background task').slice(0, 60),
            sig: t.type === 'shell' && t.command ? shellKey(t.command) : `${t.type}:${t.name ?? t.agent_type ?? ''}`,
            startedAt: now,
            aliases: [t.id],
          }))
        return { ...x, engineBgCount: list.length, bg: [...x.bg, ...added] }
      })
      $.clock.after(300, () => void maybeFinish($))
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const agentId = r.agentId
    const now = await $.clock.now()
    if (agentId && e.background && !e.workflow && !e.resume && e.parentAgentId === undefined) {
      await mutate($, j =>
        j.bg.some(b => b.id === e.tool_use_id)
          ? j
          : {
              ...j,
              bg: [
                ...j.bg,
                {
                  id: e.tool_use_id,
                  kind: 'agent',
                  label: `Agent: ${e.description}`.slice(0, 60),
                  sig: `agent:${e.subagentType}`,
                  startedAt: now,
                  aliases: [agentId],
                },
              ],
            },
      )
    } else if (agentId) {
      await mutate($, j => ({
        ...j,
        bg: j.bg.map(b => {
          if (b.id !== e.tool_use_id) return b
          if (e.workflow) return { ...b, agentIds: [...(b.agentIds ?? []), agentId] }
          return { ...b, aliases: [...b.aliases, agentId] }
        }),
      }))
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const now = await $.clock.now()
    let j = await read($, job)

    // A task list with no job yet (the mod loaded mid-task): start one from it.
    const isPlan = /__update_plan$/.test(tool) || tool === 'TodoWrite'
    if (!isActive(j) && isPlan && e.agentId === undefined) {
      await update($, job, () => ({
        id: `job-${now}`,
        outcome: 'Current task',
        prompt: '',
        startedAt: now,
        steps: [],
        bg: [],
        isTurnRunning: true,
      }))
      j = await read($, job)
    }

    if (isActive(j) && e.agentId === undefined) {
      if (/__update_plan$/.test(tool)) {
        const r = applyPlanCall(j.steps, args, now)
        await mutate($, x => ({ ...x, steps: r.steps }))
        for (const s of r.finished)
          if (s.startedAt !== undefined) await remember($, [stepKey(s.text), 'step:*'], now - s.startedAt)
        if (j.outcome === 'Current task' && r.steps.length) {
          const id = j.id
          if (!(await isOff($))) void nameJob($, id, 'The task list:\n' + r.steps.map(s => '- ' + s.text).join('\n'))
        }
      } else if (tool === 'TodoWrite' && Array.isArray(args.todos)) {
        const items = (args.todos as Record<string, unknown>[]).map(t => ({
          content: String(t.content ?? t.activeForm ?? ''),
          status: String(t.status) as StepStatus,
        }))
        const r = applyItems(j.steps, items, now)
        await mutate($, x => ({ ...x, steps: r.steps }))
        for (const s of r.finished)
          if (s.startedAt !== undefined) await remember($, [stepKey(s.text), 'step:*'], now - s.startedAt)
      } else if (/__wrap_up$/.test(tool)) {
        const fin = j.steps.filter(s => s.status === 'in_progress')
        await mutate($, x => ({ ...x, steps: x.steps.map(s => (s.status === 'completed' ? s : complete(s, now))) }))
        for (const s of fin) if (s.startedAt !== undefined) await remember($, [stepKey(s.text), 'step:*'], now - s.startedAt)
      }
    }

    const label = e.agentId === undefined && isActive(j) ? describe(args as { tool: string }) : undefined
    if (label) await mutate($, x => ({ ...x, now: label, nowSince: now }))

    const ran = await next(e)

    if (isActive(await read($, job))) {
      const bgStart = (b: Omit<Bg, 'startedAt' | 'aliases'>, extra: string[] = []) =>
        mutate($, x => ({ ...x, bg: [...x.bg, { ...b, startedAt: now, aliases: [...idsIn(ran.text), ...extra] }] }))
      const failed = ran.deny !== undefined || ran.isError === true
      if (!failed && e.tool === 'Bash' && e.run_in_background) {
        await bgStart({ id: e.tool_use_id, kind: 'shell', label: (e.description ?? e.command).slice(0, 60), sig: shellKey(e.command) })
      } else if (!failed && tool === 'Workflow') {
        const meta = workflowMeta(args)
        await bgStart({
          id: e.tool_use_id,
          kind: 'workflow',
          label: `Workflow: ${meta.name}`.slice(0, 60),
          sig: `workflow:${meta.name}`,
          phases: meta.phases,
          agentIds: [],
        })
      }
      if (label) await mutate($, x => (x.now === label ? { ...x, now: undefined } : x))
    }
    return ran
  })

  // ---------------------------------------------------------------- drawing

  on('ui.close', async ($, e, next) => {
    // Closing the panel by hand brings the band back, so nothing is lost.
    if (e.id === PANE && e.origin.kind === 'person') await setPrefs($, x => ({ ...x, place: 'band' }))
    // A reload closes panes too; settings it closed come back by themselves.
    if (e.id === SETTINGS && e.origin.kind !== 'unload') await update($, settingsTab, () => 'closed')
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    const v = await readView($, e.props.bodyColumns, true)
    if (e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The time-left settings are drawn in the desktop app. Type /time-left on, off, auto or always here.</Text>
    }
    return drawSettings($, e, { ...v, tab: v.tab === 'closed' ? 'profiles' : v.tab })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p: Prefs = normalize(await read($, prefs))
    if (e.props.hasSurvey || p.place === 'panel') return next(e)
    const mine = await draw($, e, e.props.bodyColumns, false)
    if (!mine) return next(e)
    // Other mods' bands keep their place, under this one.
    const others = await next(e)
    if (!others || e.surface === 'terminal') return mine
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap="sm">
        {mine}
        {others}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const mine = await draw($, e, e.props.bodyColumns, true)
    if (mine) return mine
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>Nothing to wait for right now. This panel fills in when Claude starts a task.</Text>
  })
}

// ---------------------------------------------------------------- the drawing

type Site = Parameters<EngineInterface['ui']['resolve']>[0]
type Tab = 'closed' | 'profiles' | 'look' | 'behaviour' | 'power'

const HERO_SIZE = { small: 'body', medium: 'heading', large: 'title' } as const
const LINE_SIZE = { small: 'footnote', medium: 'footnote', large: 'body' } as const
const DOT_SIZE = { small: 14, medium: 20, large: 26 } as const
/** About how many CSS pixels one column is on the desktop: the bar is drawn at its real width. */
const PX_PER_COLUMN = 8.6

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const nb = (t: string) => t.replace(/ /g, ' ')

function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Everything a drawing needs, read once. */
type View = {
  p: Prefs
  now: number
  power: Prefs['power']
  tab: Tab
  j: Job | null
  expandedFlag: boolean
  hist: History
  columns: number
  isPane: boolean
  profiles: Profile[]
  active: string
  notice: string
  lastDeleted: Profile | null
  timerDraft: TimerDraft
}

async function readView($: $, columns: number, isPane: boolean): Promise<View> {
  const p: Prefs = normalize(await read($, prefs))
  await read($, tick)
  const now = await $.clock.now()
  return {
    p,
    now,
    power: powerNow(p, now),
    tab: (await read($, settingsTab)) as Tab,
    j: await read($, job),
    expandedFlag: await read($, isExpanded),
    hist: await loadHistory($),
    columns,
    isPane,
    profiles: await read($, profiles),
    active: await read($, activeProfile),
    notice: await read($, notice),
    lastDeleted: await read($, lastDeleted),
    timerDraft: { ...DEFAULT_DRAFT, ...(await read($, timerDraft)) },
  }
}

/** Settings live in a side panel of their own, so they never squeeze the band. */
async function openSettings($: $, tab: Tab = 'profiles'): Promise<void> {
  await update($, settingsTab, v => (v === 'closed' ? tab : v))
  await $.ui.open({ id: SETTINGS, title: 'Time left · settings' })
}

async function closeSettings($: $): Promise<void> {
  await update($, settingsTab, () => 'closed')
  await $.ui.close({ id: SETTINGS })
}

async function draw($: $, e: Site, columns: number, isPane: boolean) {
  const v = await readView($, columns, isPane)
  const { p, now } = v

  // Is there a job to show here?
  const j = v.j
  let showJob = j !== null && (isPane || !j.isDismissed)
  if (showJob && j && !isPane) {
    const done = j.endedAt !== undefined
    const elapsed = (j.endedAt ?? now) - j.startedAt
    const quiet = j.steps.length === 0 && j.bg.length === 0
    if (!done && quiet && elapsed < p.showAfter * 1000) showJob = false
    if (done && quiet && elapsed < 60_000) showJob = false
  }
  if (v.power === 'off') showJob = false
  const showIdle = !showJob && (v.power === 'always' || isPane)
  if (!showJob && !showIdle) return undefined

  if (e.surface !== 'desktop') return drawPlain($, e, v, showJob)

  const { Box } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" gap="md" paddingX="xs" paddingY="xs">
      {showJob && j ? drawJob($, e, v, j) : drawIdle($, e, v)}
    </Box>
  )
}

function settingsButton($: $, e: Site, v: View) {
  const { Button } = $.ui.resolve(e)
  return v.tab === 'closed' ? (
    <Button key="gear" label="⚙  Settings" onPress={() => void openSettings($)} />
  ) : (
    <Button key="gear" label="Close settings" variant="primary" onPress={() => void closeSettings($)} />
  )
}

function drawIdle($: $, e: Site, v: View) {
  const { Box, Text, Button, Svg } = $.ui.resolve(e) as Elements['desktop']
  const p = v.p
  const narrow = v.columns < 46
  const isOff = v.power === 'off'
  const last = v.j && v.j.endedAt !== undefined ? v.j : null
  const title = isOff
    ? 'Time left is off'
    : last
      ? `Last: ${last.outcome}, done in ${formatSpan(last.endedAt! - last.startedAt)}`
      : 'Nothing running right now'
  const sub = isOff
    ? p.powerUntil !== undefined
      ? `It comes back at ${clockTime(p.powerUntil)}.`
      : 'It keeps track quietly, so turning it on shows where things stand.'
    : 'It fills in as soon as Claude starts on something.'
  return (
    <Box flexDirection={narrow ? 'column' : 'row'} alignItems={narrow ? 'flex-start' : 'center'} gap="md">
      <Box flexDirection="row" alignItems="center" gap="md" flexGrow={1} flexShrink={1} minWidth={0}>
        <Svg
          source={dotSvg('waiting', isOff ? 'mono' : p.accent, false, DOT_SIZE[p.size])}
          alt={isOff ? 'Off' : 'Idle'}
          width={DOT_SIZE[p.size]}
          height={DOT_SIZE[p.size]}
        />
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          <Text size={LINE_SIZE[p.size]} weight="semibold" wrap="wrap">
            {title}
          </Text>
          <Text size="caption" dimColor wrap="wrap">
            {sub}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="row" gap="sm" flexShrink={0}>
        {isOff && <Button key="power-on" label="Turn on" variant="primary" onPress={() => void setPower($, 'auto')} />}
        {settingsButton($, e, v)}
      </Box>
    </Box>
  )
}

function drawJob($: $, e: Site, v: View, j: Job) {
  const { Box, Text, Button, Svg } = $.ui.resolve(e) as Elements['desktop']
  const { p, now, isPane } = v
  const narrow = v.columns < 46
  const isDone = j.endedAt !== undefined
  const elapsed = (j.endedAt ?? now) - j.startedAt
  const est = estimate(j, v.hist, now)
  const pendingBg = j.bg.filter(b => b.endedAt === undefined)
  const state: 'working' | 'waiting' | 'done' = isDone ? 'done' : j.isTurnRunning ? 'working' : 'waiting'
  const expanded = isPane || v.expandedFlag !== (p.view === 'detailed')
  const done = j.steps.filter(s => s.status === 'completed').length
  const left = isDone ? `took ${formatSpan(elapsed)}` : formatLeft(est) + (est.low !== undefined ? ' left' : '')
  const progressWord = isDone
    ? 'all done'
    : j.steps.length
      ? done === j.steps.length
        ? 'wrapping up'
        : `step ${Math.min(done + 1, j.steps.length)} of ${j.steps.length}`
      : pendingBg.length
        ? `${pendingBg.length} running in the background`
        : `${formatSpan(elapsed)} so far`
  const nowWord = isDone
    ? undefined
    : j.now
      ? `${j.now}${j.nowSince && now - j.nowSince > 20_000 ? ` · ${formatSpan(now - j.nowSince)}` : ''}`
      : state === 'waiting'
        ? 'Waiting for background work'
        : 'Thinking'
  // Every step ticked and nothing in the background: the guess has nothing left to price.
  const isWrapping = !isDone && j.steps.length > 0 && done === j.steps.length && pendingBg.length === 0
  const hero = isDone ? `Done in ${formatSpan(elapsed)}` : isWrapping ? 'Almost done' : cap(left)
  const facts = [
    isDone ? undefined : cap(progressWord),
    !isDone && j.steps.length > 0 && pendingBg.length > 0 ? `${pendingBg.length} in the background` : undefined,
  ]
    .filter((f): f is string => Boolean(f))
    .map(nb)
  const stepRows = expanded && p.showSteps && j.steps.length > 0
  const visibleSteps = (() => {
    const max = isPane ? 14 : 8
    if (j.steps.length <= max) return j.steps
    const cur = Math.max(0, j.steps.findIndex(s => s.status !== 'completed'))
    const from = Math.max(0, Math.min(cur - 2, j.steps.length - max))
    return j.steps.slice(from, from + max)
  })()
  const bar = barSvg({ progress: est.progress, isDone, isMoving: true, steps: j.steps.length, width: v.columns * PX_PER_COLUMN, prefs: p })

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection={narrow ? 'column' : 'row'} alignItems={narrow ? 'flex-start' : 'center'} gap="md">
        <Box flexDirection="row" alignItems="center" gap="md" flexGrow={1} flexShrink={1} minWidth={0}>
          <Svg
            source={dotSvg(state, p.accent, true, DOT_SIZE[p.size])}
            alt={isDone ? 'Done' : state === 'working' ? 'Working' : 'Waiting for background work'}
            width={DOT_SIZE[p.size]}
            height={DOT_SIZE[p.size]}
          />
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            <Text size={HERO_SIZE[p.size]} weight="semibold" tabular wrap="wrap">
              {hero}
            </Text>
            <Text size={LINE_SIZE[p.size]} weight="medium" wrap="wrap">
              {j.outcome}
            </Text>
            {facts.length > 0 && (
              <Text size={LINE_SIZE[p.size]} dimColor tabular wrap="wrap">
                {facts.join('  ·  ')}
              </Text>
            )}
          </Box>
        </Box>
        <Box flexDirection="row" alignItems="center" gap="sm" flexShrink={0}>
          {isDone ? (
            <Button key="dismiss" label="Hide" onPress={() => void mutate($, x => ({ ...x, isDismissed: true }))} />
          ) : !isPane ? (
            <Button key="more" label={expanded ? 'Less ▴' : 'Details ▾'} onPress={() => void update($, isExpanded, x => !x)} />
          ) : null}
          {settingsButton($, e, v)}
        </Box>
      </Box>

      <Svg
        source={bar.source}
        alt={
          isDone
            ? 'Progress: done'
            : est.progress === undefined
              ? 'Progress: working, amount unknown'
              : `Progress: about ${Math.round(est.progress * 100)} percent`
        }
        height={bar.height}
      />

      {expanded && !isDone && (
        <Box flexDirection="column" gap="xs">
          {nowWord && (
            <Text size="footnote">
              <Text dimColor>Now: </Text>
              {nowWord}
            </Text>
          )}
          {stepRows &&
            visibleSteps.map(s => (
              <Text size="footnote" dimColor={s.status === 'completed'} wrap="truncate">
                {s.status === 'completed' ? '✓ ' : s.status === 'in_progress' ? '▸ ' : '○ '}
                {s.text}
                {s.status === 'completed' && s.startedAt !== undefined && s.endedAt !== undefined
                  ? `  ${formatSpan(s.endedAt - s.startedAt)}`
                  : s.status === 'in_progress' && s.startedAt !== undefined
                    ? `  ${formatSpan(now - s.startedAt)} so far`
                    : ''}
              </Text>
            ))}
          {pendingBg.map(b => (
            <Text size="footnote" wrap="truncate">
              <Text dimColor>In the background: </Text>
              {b.label}
              {b.kind === 'workflow' && (b.agentIds?.length ?? 0) > 0
                ? ` · ${b.doneAgentIds?.length ?? 0} of ${b.agentIds!.length} agents done`
                : ''}
              {` · ${formatSpan(now - b.startedAt)}`}
            </Text>
          ))}
          {(j.engineBgCount ?? 0) > pendingBg.length && (
            <Text size="footnote" dimColor>
              Plus {(j.engineBgCount ?? 0) - pendingBg.length} more background task(s).
            </Text>
          )}
          <Text size="caption" dimColor>
            {est.basis} {formatSpan(elapsed)} so far.
          </Text>
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------- settings

function drawSettings($: $, e: Site, v: View) {
  const { Box, Text, Button, Svg, Input, Select } = $.ui.resolve(e) as Elements['desktop']
  const p = v.p
  const set = (fn: (x: Prefs) => Prefs) => () => void setPrefs($, fn)

  /** A row of answers to one plain question; the picked one is filled in. */
  const accentFrom = ACCENTS[p.accent].from
  type Opt<T extends string> = { value: T; label: string; hint?: string; visual?: unknown }
  // Every option is the same row: a fixed column for its picture, then one
  // big button holding its name and hint. Rows are all one width, one or two
  // to a line by the panel's width, so the lists line up. Two to a line only
  // in a very wide panel: narrower, the app cuts button labels short ("Ess...").
  const perLine = v.columns >= 140 ? 2 : 1
  const rowWidth = perLine === 2 ? '49%' : '100%'
  // In a narrow panel the picture goes above the label, so the label gets the
  // whole width and is never cut short.
  const stack = v.columns < 48
  const PIC_COLUMN = 12
  /** One card: its picture, then what it holds (a button, a hint, more buttons). */
  const card = (key: string, on: boolean, ring: string, visual: unknown, content: unknown) => (
    <Box
      key={`${key}-card`}
      width={rowWidth}
      flexDirection={stack ? 'column' : 'row'}
      alignItems={stack ? 'flex-start' : 'center'}
      gap="sm"
      padding="sm"
      borderStyle="round"
      borderColor={on ? ring : 'subtle'}
      hover={{ borderColor: ring }}
    >
      <Box width={stack ? undefined : PIC_COLUMN} flexShrink={0} flexDirection="row" justifyContent={stack ? 'flex-start' : 'center'} alignItems="center">
        {visual as never}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="column" alignItems="flex-start" gap="xs">
        {content as never}
      </Box>
    </Box>
  )
  const optionRow = (key: string, on: boolean, visual: unknown, label: string, hint: string | undefined, onPress: () => void, ring = accentFrom) =>
    card(key, on, ring, visual, [
      <Button key={key} label={on ? `✓ ${label}` : label} variant={on ? 'primary' : 'secondary'} onPress={onPress} />,
      hint ? (
        <Text key={`${key}-hint`} size="caption" dimColor wrap="wrap">
          {hint}
        </Text>
      ) : null,
    ])
  const grid = (children: unknown[]) => (
    <Box flexDirection="row" flexWrap="wrap" alignItems="stretch" columnGap="sm" rowGap="xs">
      {children as never}
    </Box>
  )
  /** One plain question; its answers are rows of the same size. */
  const choice = <T extends string>(key: string, question: string, options: Opt<T>[], current: T, pick: (t: T) => void, note?: string) => (
    <Box flexDirection="column" gap="xs">
      <Text size="footnote" weight="semibold">
        {question}
      </Text>
      {note && (
        <Text size="caption" dimColor wrap="wrap">
          {note}
        </Text>
      )}
      {grid(options.map(o => optionRow(`${key}-${o.value}`, o.value === current, o.visual, o.label, o.hint, () => pick(o.value))))}
    </Box>
  )
  /** Pictures fit the row's picture column, keeping their proportions. */
  const PIC_MAX = 96
  const picture = (svg: string, w: number, ht: number, alt: string) => {
    const k = Math.min(1, PIC_MAX / w)
    return <Svg source={svg} alt={alt} width={Math.round(w * k)} height={Math.round(ht * k)} />
  }
  const barPic = (over: Partial<Look>, w = PIC_MAX, alt = 'Bar preview') => {
    const b = barSvg({ progress: 0.6, isDone: false, isMoving: false, steps: 5, width: w, prefs: { ...p, ...over } })
    return <Svg source={b.source} alt={alt} width={w} height={b.height} />
  }

  const tabs: [Tab, string][] = [
    ['profiles', '⭐  Profiles'],
    ['look', '🎨  Look'],
    ['behaviour', '🧭  Behaviour'],
    ['power', '⏻  On / off'],
  ]

  // Which profile is in use, and whether it was changed since.
  const look = lookOf(p)
  const all = [...STARTERS.map(st => st.profile), ...v.profiles]
  const activeP = all.find(x => x.name === v.active)
  const activeWords = activeP ? (sameLook(activeP.look, look) ? activeP.name : `${activeP.name} (changed)`) : 'Your own mix'

  const miniBar = (lk: Look, w = 132) => {
    const b = barSvg({ progress: 0.6, isDone: false, isMoving: false, steps: 5, width: w, prefs: { ...lk, thickness: lk.thickness === 'thin' ? 'medium' : lk.thickness } })
    return <Svg source={b.source} alt={`${STYLES[lk.style].label} bar`} width={w} height={b.height} />
  }

  let body
  /** What a look is made of, in a few words. */
  const describe = (lk: Look) => `${STYLES[lk.style].label} · ${ACCENTS[lk.accent].label} · ${SHAPES[lk.shape]}`
  const isFull = v.profiles.length >= MAX_PROFILES
  const panelPx = Math.max(200, v.columns * PX_PER_COLUMN - 56)

  /** Saving: the look on screen, under a name the person picks. Shown wherever looks are made. */
  const saveCard = (key: string) => (
    <Box key={`${key}-save`} flexDirection="column" gap="sm" padding="md" borderStyle="round" borderColor={accentFrom}>
      <Text size="footnote" weight="semibold">
        Save this look as a profile
      </Text>
      {miniBar(look, Math.min(220, panelPx - 40))}
      <Text size="caption" dimColor wrap="wrap">
        {describe(look)}, with your Behaviour choices.
      </Text>
      {isFull ? (
        <Text size="caption" dimColor wrap="wrap">
          All {MAX_PROFILES} places are used. Delete one above to save another.
        </Text>
      ) : (
        <Box flexDirection="column" gap="xs">
          <Input key={key} placeholder="Name it, like Late night" submitLabel="Save" onSubmit={name => void saveProfile($, name)} />
          <Text size="caption" dimColor>
            {v.profiles.length} of {MAX_PROFILES} places used.
          </Text>
        </Box>
      )}
    </Box>
  )

  if (v.tab === 'profiles') {
    const rec = STARTERS[0]!
    const recOn = v.active === rec.profile.name && sameLook(rec.profile.look, look)
    const recBar = barSvg({ progress: 0.62, isDone: false, isMoving: true, steps: 5, width: panelPx, prefs: rec.profile.look })
    const meter = barSvg({
      progress: v.profiles.length / MAX_PROFILES,
      isDone: false,
      isMoving: false,
      steps: 0,
      width: 120,
      prefs: { ...p, blocks: String(MAX_PROFILES) as Prefs['blocks'], thickness: 'thin' },
    })
    body = (
      <Box flexDirection="column" gap="md">
        {!p.hideRecommended && (
        <Box flexDirection="column" gap="sm" padding="md" borderStyle="round" borderColor={ACCENTS[rec.profile.look.accent].from}>
          <Box flexDirection="row" alignItems="center" gap="sm">
            <Text size="caption" weight="semibold" color={ACCENTS[rec.profile.look.accent].from}>
              ★ RECOMMENDED
            </Text>
            <Box flexGrow={1} />
            <Button key="rec-hide" plain dimColor label="Hide" onPress={() => void setPrefs($, x => ({ ...x, hideRecommended: true }))} />
          </Box>
          <Text size="heading" weight="semibold">
            Recommended: {rec.profile.name}
          </Text>
          <Svg source={recBar.source} alt={`${rec.profile.name}: ${describe(rec.profile.look)}`} height={recBar.height} />
          <Text size="footnote" dimColor wrap="wrap">
            {rec.why}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm">
            <Button key="use-rec" label={recOn ? '✓ In use' : 'Use it'} variant="primary" onPress={() => void useProfile($, rec.profile)} />
            <Text size="caption" dimColor>
              {describe(rec.profile.look)}
            </Text>
          </Box>
        </Box>
        )}

        <Box flexDirection="column" gap="xs">
          <Text size="footnote" weight="semibold">
            {p.hideRecommended ? 'Ready-made looks' : 'More ready-made looks'}
          </Text>
          {grid(
            STARTERS.slice(1).map(st =>
              optionRow(
                `use-${st.profile.name}`,
                v.active === st.profile.name,
                miniBar(st.profile.look, PIC_MAX),
                st.profile.name,
                st.why.split(':')[0],
                () => void useProfile($, st.profile),
                ACCENTS[st.profile.look.accent].from,
              ),
            ),
          )}
          {p.hideRecommended && (
            <Box flexDirection="row">
              <Button key="rec-show" plain dimColor label="Show the recommended look again" onPress={() => void setPrefs($, x => ({ ...x, hideRecommended: false }))} />
            </Box>
          )}
        </Box>

        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm">
            <Text size="footnote" weight="semibold">
              Your profiles
            </Text>
            <Svg source={meter.source} alt={`${v.profiles.length} of ${MAX_PROFILES} places used`} width={120} height={meter.height} />
            <Text size="caption" dimColor tabular>
              {v.profiles.length} of {MAX_PROFILES}
            </Text>
          </Box>
          {grid(
            v.profiles.map(pr => {
              const on = v.active === pr.name
              const ring = ACCENTS[pr.look.accent].from
              return card(`mine-${pr.name}`, on, ring, miniBar(pr.look, PIC_MAX), [
                <Button key={`use-${pr.name}`} label={on ? `✓ ${pr.name}` : pr.name} variant={on ? 'primary' : 'secondary'} onPress={() => void useProfile($, pr)} />,
                <Text key={`desc-${pr.name}`} size="caption" dimColor wrap="wrap">
                  {describe(pr.look)}
                </Text>,
                <Box key={`acts-${pr.name}`} flexDirection="row" flexWrap="wrap" gap="sm">
                  <Button key={`upd-${pr.name}`} plain label="↻ Update" onPress={() => void saveProfile($, pr.name)} />
                  <Button key={`del-${pr.name}`} plain label="✕ Delete" onPress={() => void deleteProfile($, pr.name)} />
                </Box>,
              ])
            }),
          )}
          {v.profiles.length === 0 && (
            <Text size="caption" dimColor wrap="wrap">
              None yet. Change the look in the Look and Behaviour tabs, then save it here or at the bottom of those tabs.
            </Text>
          )}
          {saveCard('profile-name')}
        </Box>
      </Box>
    )
  } else if (v.tab === 'look') {
    const previewW = PIC_MAX
    body = (
      <Box flexDirection="column" gap="md">
        <Box flexDirection="column" gap="xs">
          <Text size="footnote" weight="medium">
            Pick a bar style
          </Text>
          {grid(
            (Object.keys(STYLES) as BarStyle[]).map(style => {
              const bar = barSvg({
                progress: 0.6,
                isDone: false,
                isMoving: false,
                steps: 5,
                width: previewW,
                prefs: { ...p, style, thickness: p.thickness === 'thin' ? 'medium' : p.thickness },
              })
              return optionRow(
                `style-${style}`,
                p.style === style,
                <Svg source={bar.source} alt={`${STYLES[style].label} bar`} width={previewW} height={bar.height} />,
                STYLES[style].label,
                STYLES[style].hint,
                () => void setPrefs($, x => ({ ...x, style })),
              )
            }),
          )}
        </Box>

        <Box flexDirection="column" gap="xs">
          <Text size="footnote" weight="medium">
            Colour
          </Text>
          {grid(
            (Object.keys(ACCENTS) as Accent[]).map(a =>
              optionRow(
                `accent-${a}`,
                p.accent === a,
                <Svg source={swatchSvg(a, false)} alt={`${ACCENTS[a].label} colour`} width={28} height={28} />,
                ACCENTS[a].label,
                a === 'rgb' ? 'Moves through every colour' : undefined,
                () => void setPrefs($, x => ({ ...x, accent: a })),
                ACCENTS[a].from,
              ),
            ),
          )}
        </Box>

        {shapesFor(p.style).length === 0 ? (
          <Box flexDirection="column" gap="xs">
            <Text size="footnote" weight="semibold">
              Shape
            </Text>
            <Text size="caption" dimColor wrap="wrap">
              {STYLES[p.style].label} keeps its own shape, so there is nothing to pick here. Pick another style above to choose a shape.
            </Text>
          </Box>
        ) : (
          choice(
            'shape',
            'Shape',
            shapesFor(p.style).map(sh => ({
              value: sh,
              label: SHAPES[sh],
              visual: barPic({ shape: sh, thickness: p.thickness === 'thin' ? 'medium' : p.thickness }, PIC_MAX, `${SHAPES[sh]} shape`),
            })),
            shapesFor(p.style).includes(p.shape) ? p.shape : shapesFor(p.style)[0]!,
            sh => void setPrefs($, x => ({ ...x, shape: sh })),
            shapesFor(p.style).length < Object.keys(SHAPES).length ? `${STYLES[p.style].label} only comes in these shapes.` : undefined,
          )
        )}
        {choice(
          'blocks',
          'Split the bar into',
          [
            { value: 'auto', label: 'One per step', hint: 'Count the steps at a glance', visual: barPic({ blocks: 'auto' }, PIC_MAX, 'One block per step') },
            { value: 'none', label: 'One long bar', hint: 'Smooth and simple', visual: barPic({ blocks: 'none' }, PIC_MAX, 'One long bar') },
            { value: '10', label: '10 blocks', hint: 'Each is a tenth', visual: barPic({ blocks: '10' }, PIC_MAX, 'Ten blocks') },
            { value: '20', label: '20 blocks', hint: 'Finer steps', visual: barPic({ blocks: '20' }, PIC_MAX, 'Twenty blocks') },
            { value: '30', label: '30 blocks', hint: 'Like a level meter', visual: barPic({ blocks: '30' }, PIC_MAX, 'Thirty blocks') },
          ] as Opt<Prefs['blocks']>[],
          p.blocks === '5' ? 'auto' : p.blocks,
          b => void setPrefs($, x => ({ ...x, blocks: b })),
        )}
        {choice(
          'thick',
          'Bar thickness',
          (Object.keys(THICKNESS) as Prefs['thickness'][]).map(t => ({
            value: t,
            label: THICKNESS[t].label,
            visual: barPic({ thickness: t }, PIC_MAX, `${THICKNESS[t].label} bar`),
          })),
          p.thickness,
          t => void setPrefs($, x => ({ ...x, thickness: t })),
        )}
        {choice(
          'size',
          'Text size',
          (['small', 'medium', 'large'] as const).map(sz => ({
            value: sz,
            label: cap(sz),
            visual: (
              <Box flexDirection="column" minWidth={0}>
                <Text size={HERO_SIZE[sz]} weight="semibold">
                  5 min left
                </Text>
                <Text size={LINE_SIZE[sz]} dimColor>
                  Step 3 of 7
                </Text>
              </Box>
            ),
          })),
          p.size,
          sz => void setPrefs($, x => ({ ...x, size: sz })),
        )}
        {saveCard('profile-name-look')}
        <Box flexDirection="row">
          <Button
            key="reset-look"
            label="Back to the default look"
            onPress={set(x => ({
              ...x,
              style: DEFAULT_PREFS.style,
              accent: DEFAULT_PREFS.accent,
              blocks: DEFAULT_PREFS.blocks,
              shape: DEFAULT_PREFS.shape,
              thickness: DEFAULT_PREFS.thickness,
              size: DEFAULT_PREFS.size,
            }))}
          />
        </Box>
      </Box>
    )
  } else if (v.tab === 'behaviour') {
    body = (
      <Box flexDirection="column" gap="md">
        {choice(
          'place',
          'Where should it sit?',
          [
            { value: 'band', label: 'Above the chat box', hint: 'Always in sight while you type', visual: picture(wireSvg('band', p.accent), 112, 68, 'A box above the chat box') },
            { value: 'panel', label: 'Side panel', hint: 'More room; drag its edge to resize', visual: picture(wireSvg('panel', p.accent), 112, 68, 'A panel beside the chat') },
          ] as Opt<Prefs['place']>[],
          p.place,
          pl => void placeIt($, pl),
        )}
        {choice(
          'view',
          'How much should it show at first?',
          [
            { value: 'compact', label: 'Essentials', hint: 'Time left, outcome, progress', visual: picture(wireSvg('compact', p.accent), 112, 68, 'A short box') },
            { value: 'detailed', label: 'Everything', hint: 'Also what runs now and each step', visual: picture(wireSvg('detailed', p.accent), 112, 68, 'A tall box with a list') },
          ] as Opt<Prefs['view']>[],
          p.view,
          vw => void setPrefs($, x => ({ ...x, view: vw })),
        )}
        {choice(
          'after',
          'When a task starts, show it',
          [
            { value: '0', label: 'Right away', hint: 'Even for quick answers', visual: picture(clockSvg(0, p.accent), 56, 56, 'Lightning: at once') },
            { value: '15', label: 'After 15 s', hint: 'Skips quick answers', visual: picture(clockSvg(15, p.accent), 56, 56, 'Clock: 15 seconds') },
            { value: '60', label: 'After a minute', hint: 'Only for longer work', visual: picture(clockSvg(60, p.accent), 56, 56, 'Clock: one minute') },
          ] as Opt<'0' | '15' | '60'>[],
          String(p.showAfter) as '0' | '15' | '60',
          a => void setPrefs($, x => ({ ...x, showAfter: Number(a) })),
        )}
        {choice(
          'steps',
          'List the steps in the details?',
          [
            { value: 'yes', label: 'Yes', hint: 'Done, now, next', visual: picture(wireSvg('steps-on', p.accent), 112, 68, 'A list of steps') },
            { value: 'no', label: 'No', hint: 'Keep the details short', visual: picture(wireSvg('steps-off', p.accent), 112, 68, 'No list') },
          ] as Opt<'yes' | 'no'>[],
          p.showSteps ? 'yes' : 'no',
          s2 => void setPrefs($, x => ({ ...x, showSteps: s2 === 'yes' })),
        )}
        {choice(
          'notify',
          'Tell me when a long task is done?',
          [
            { value: 'yes', label: 'Yes', hint: 'A notice when a task over a minute ends', visual: picture(bellSvg(true, p.accent), 56, 56, 'A ringing bell') },
            { value: 'no', label: 'No', hint: 'Stay quiet', visual: picture(bellSvg(false, p.accent), 56, 56, 'A silent bell') },
          ] as Opt<'yes' | 'no'>[],
          p.notify ? 'yes' : 'no',
          s2 => void setPrefs($, x => ({ ...x, notify: s2 === 'yes' })),
        )}
        {saveCard('profile-name-behaviour')}
      </Box>
    )
  } else {
    body = drawPowerTab()
  }

  function drawPowerTab() {
    const until = p.powerUntil
    const since = p.powerSince ?? v.now
    const isOffTimer = until !== undefined && p.power === 'off'
    const d = v.timerDraft
    const draftUntil = draftEnd(d, v.now)
    const draftHead = draftUntil === undefined ? 'That time has passed' : `${d.action === 'off' ? 'Off' : 'Always on'} until ${dayTime(draftUntil, v.now)}`
    const draftWords = draftUntil === undefined ? 'Pick a later day or time.' : `${formatSpan(draftUntil - v.now)} from now, then back to Auto.`
    const setDraft = (fn: (x: TimerDraft) => TimerDraft) => void update($, timerDraft, x => fn({ ...DEFAULT_DRAFT, ...x }))
    const countdown =
      until !== undefined
        ? barSvg({
            progress: Math.max(0, Math.min(1, (v.now - since) / Math.max(1, until - since))),
            isDone: false,
            isMoving: true,
            steps: 0,
            width: Math.max(160, v.columns * PX_PER_COLUMN - 40),
            prefs: { ...p, blocks: 'none' },
          })
        : undefined

    return (
      <Box flexDirection="column" gap="md">
        {choice(
          'power',
          'When should it show?',
          [
            { value: 'auto', label: 'Auto', hint: 'Only while Claude works', visual: picture(powerSvg('auto', p.accent), 56, 56, 'Auto') },
            { value: 'always', label: 'Always on', hint: 'Stays up, idle too', visual: picture(powerSvg('always', p.accent), 56, 56, 'Always on') },
            { value: 'off', label: 'Off', hint: 'Hidden; still keeps track', visual: picture(powerSvg('off', p.accent), 56, 56, 'Off') },
          ] as Opt<Prefs['power']>[],
          v.power,
          pw => void setPower($, pw),
        )}

        {(until !== undefined || p.offAfterJob) && (
          <Box flexDirection="column" gap="sm" padding="sm" borderStyle="round" borderColor={accentFrom}>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm">
              <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                <Text size={HERO_SIZE[p.size]} weight="semibold" tabular wrap="wrap">
                  {until !== undefined ? `${formatSpan(Math.max(0, until - v.now))} left` : 'Off after this task'}
                </Text>
                <Text size="footnote" dimColor wrap="wrap">
                  {until !== undefined
                    ? `${isOffTimer ? 'Off' : 'Always on'} until ${dayTime(until, v.now)}, then back to Auto.`
                    : 'It turns off once the current task is done.'}
                </Text>
              </Box>
              <Button key="t-cancel" label="Cancel timer" onPress={() => void cancelTimer($)} />
            </Box>
            {countdown && <Svg source={countdown.source} alt="How much of the timer has gone" height={countdown.height} />}
          </Box>
        )}

        <Box flexDirection="column" gap="xs">
          <Text size="footnote" weight="semibold">
            Quick timers
          </Text>
          {grid([
            optionRow('t-off1h', false, picture(timerSvg('hour', p.accent), 56, 56, 'Moon, one hour'), 'Off 1 hour', 'Back on by itself', () => void setPower($, 'off', 60 * 60_000)),
            optionRow('t-offmorning', false, picture(timerSvg('morning', p.accent), 56, 56, 'Sunrise at 08:00'), 'Off tonight', 'Back at 08:00', () => void setPowerUntil($, 'off', untilMorning(v.now))),
            optionRow('t-offjob', p.offAfterJob === true, picture(timerSvg('task', p.accent), 56, 56, 'Finish flag'), 'Off after task', 'Press again to undo', () => void setPrefs($, x => ({ ...x, offAfterJob: !x.offAfterJob }))),
            optionRow('t-on1h', false, picture(timerSvg('sun', p.accent), 56, 56, 'Sun, one hour'), 'On 1 hour', 'Then back to Auto', () => void setPower($, 'always', 60 * 60_000)),
          ])}
        </Box>

        <Box flexDirection="column" gap="sm" padding="sm" borderStyle="round" borderColor="subtle">
          <Text size="footnote" weight="semibold">
            Your own timer
          </Text>

          <Text size="caption" weight="semibold">
            1. What should it do?
          </Text>
          {grid([
            optionRow('d-off', d.action === 'off', picture(powerSvg('off', p.accent), 56, 56, 'Off'), 'Off', 'Hide the band', () => setDraft(x => ({ ...x, action: 'off' }))),
            optionRow('d-always', d.action === 'always', picture(powerSvg('always', p.accent), 56, 56, 'Always on'), 'Always on', 'Keep the band up', () => setDraft(x => ({ ...x, action: 'always' }))),
          ])}

          <Text size="caption" weight="semibold">
            2. For how long?
          </Text>
          <Box flexDirection="row" flexWrap="wrap" gap="xs">
            {LENGTHS.map(([m, label]) => {
              const on = d.mode === 'for' && d.minutes === m
              return <Button key={`d-len-${m}`} label={on ? `✓ ${label}` : label} variant={on ? 'primary' : 'secondary'} onPress={() => setDraft(x => ({ ...x, mode: 'for', minutes: m }))} />
            })}
            <Button key="d-at" label={d.mode === 'until' ? '✓ Until…' : 'Until…'} variant={d.mode === 'until' ? 'primary' : 'secondary'} onPress={() => setDraft(x => ({ ...x, mode: 'until' }))} />
          </Box>
          {d.mode === 'until' && (
            <Box flexDirection="row" flexWrap="wrap" gap="sm">
              <Select
                key="d-day"
                label="Day"
                value={String(d.day)}
                options={Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: dayName(i, v.now) }))}
                onSelect={val => setDraft(x => ({ ...x, day: Number(val) }))}
              />
              <Select
                key="d-time"
                label="Time"
                value={d.time}
                options={TIMES.map(t => ({ value: t, label: t }))}
                onSelect={val => setDraft(x => ({ ...x, time: val }))}
              />
            </Box>
          )}

          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm" padding="sm" borderStyle="round" borderColor={draftUntil === undefined ? 'subtle' : accentFrom}>
            {picture(timerSvg('custom', p.accent), 56, 56, 'A clock')}
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Text size="body" weight="semibold" wrap="wrap">
                {draftHead}
              </Text>
              <Text size="caption" dimColor wrap="wrap">
                {draftWords}
              </Text>
            </Box>
            <Button
              key="d-start"
              label="Start"
              variant="primary"
              onPress={() => {
                if (draftUntil !== undefined) void setPowerUntil($, d.action, draftUntil)
              }}
            />
          </Box>
        </Box>

        <Text size="caption" dimColor wrap="wrap">
          While it is off it still keeps track, at almost no cost, so it shows the right thing the moment it is back. You can also type /time-left on, off, auto or always.
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap="md" padding="sm">
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm">
        <Box flexDirection="column">
          <Text size="body" weight="semibold">
            Make it yours
          </Text>
          <Text size="caption" dimColor>
            Profile: {activeWords}
          </Text>
        </Box>
        {activeP && !sameLook(activeP.look, look) && v.profiles.some(x => x.name === activeP.name) && (
          <Button key="save-changes" label={`Save changes to “${activeP.name}”`} variant="primary" onPress={() => void saveProfile($, activeP.name)} />
        )}
        <Box flexGrow={1} />
        <Button key="settings-done" label="Done" onPress={() => void closeSettings($)} />
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap="xs">
        {tabs.map(([t, label]) => (
          <Button
            key={`tab-${t}`}
            label={label}
            variant={v.tab === t ? 'primary' : 'secondary'}
            onPress={() => void update($, settingsTab, () => t)}
          />
        ))}
      </Box>
      {body}
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm">
        <Text size="caption" dimColor>
          {v.notice || 'Changes show at once and are kept for next time.'}
        </Text>
        {v.lastDeleted && v.notice.startsWith('Deleted') && (
          <Button key="undo-delete" plain label="Undo" onPress={() => void undoDelete($)} />
        )}
      </Box>
    </Box>
  )
}

const LENGTHS: [number, string][] = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [1440, '1 day']]
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayName(offset: number, now: number): string {
  if (offset === 0) return 'Today'
  if (offset === 1) return 'Tomorrow'
  const d = new Date(now)
  d.setDate(d.getDate() + offset)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "16:40", "tomorrow 08:00", "Wed 11 Nov 08:00". */
function dayTime(at: number, now: number): string {
  const a = new Date(at)
  const n = new Date(now)
  const days = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86_400_000)
  const t = clockTime(at)
  return days === 0 ? t : days === 1 ? `tomorrow ${t}` : `${dayName(days, now)} ${t}`
}

/** When a drafted timer ends; undefined when that moment has passed. */
function draftEnd(d: TimerDraft, now: number): number | undefined {
  if (d.mode === 'for') return now + d.minutes * 60_000
  const [hh, mm] = d.time.split(':').map(Number)
  const at = new Date(now)
  at.setDate(at.getDate() + d.day)
  at.setHours(hh ?? 8, mm ?? 0, 0, 0)
  return at.getTime() > now ? at.getTime() : undefined
}

function untilMorning(now: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d.getTime()
}

// ---------------------------------------------------------------- the terminal

function drawPlain($: $, e: Site, v: View, showJob: boolean) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const j = v.j
  if (!showJob || !j) {
    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{v.power === 'off' ? '○ Time left is off.' : '○ Nothing running right now.'}</Text>
        {v.power === 'off' && <Button key="power-on" plain label="[turn on]" onPress={() => void setPower($, 'auto')} />}
      </Box>
    )
  }
  const est = estimate(j, v.hist, v.now)
  const isDone = j.endedAt !== undefined
  const elapsed = (j.endedAt ?? v.now) - j.startedAt
  const done = j.steps.filter(s => s.status === 'completed').length
  const wrapping = !isDone && j.steps.length > 0 && done === j.steps.length && !j.bg.some(x => x.endedAt === undefined)
  const left = isDone ? `Done in ${formatSpan(elapsed)}` : wrapping ? 'Almost done' : cap(formatLeft(est) + (est.low !== undefined ? ' left' : ''))
  const expanded = v.isPane || v.expandedFlag !== (v.p.view === 'detailed')
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={isDone ? 'success' : 'claude'}>{isDone ? '✓' : '●'}</Text>
        <Text bold>{left}</Text>
        <Text wrap="truncate">· {j.outcome}</Text>
        {j.steps.length > 0 && !isDone && (
          <Text dimColor>
            · step {Math.min(done + 1, j.steps.length)} of {j.steps.length}
          </Text>
        )}
        {isDone ? (
          <Button key="dismiss" plain label="[hide]" onPress={() => void mutate($, x => ({ ...x, isDismissed: true }))} />
        ) : !v.isPane ? (
          <Button key="more" plain label={expanded ? '[less]' : '[more]'} onPress={() => void update($, isExpanded, x => !x)} />
        ) : null}
      </Box>
      {!isDone && <Text color="claude">{barText(est.progress, Math.min(30, Math.floor(v.columns / 3)))}</Text>}
      {expanded && !isDone && j.now && <Text dimColor>Now: {j.now}</Text>}
      {expanded && !isDone && <Text dimColor>{est.basis}</Text>}
    </Box>
  )
}

async function placeIt($: $, place: Prefs['place']): Promise<void> {
  await setPrefs($, x => ({ ...x, place }))
  if (place === 'panel') await $.ui.open({ id: PANE, title: 'Time left' })
  else await $.ui.close({ id: PANE })
}
