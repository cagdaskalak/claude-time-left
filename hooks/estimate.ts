// The estimate: pure functions over a job, its history and the clock.
// No `$` here, so a test can feed it any job.
import type { Bg, History, Job, Step } from '../types'

const MIN = 60_000

export type Estimate = {
  /** Milliseconds left, as a range; absent when there is no basis. */
  low?: number
  high?: number
  /** True when part of the work has no basis: the range is a floor. */
  isFloor: boolean
  /** Fraction done, 0..1; absent when unknown. */
  progress?: number
  /** One plain line on what the guess rests on. */
  basis: string
}

export function median(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Similar steps share a key: the first four plain words, lowercased. */
export function stepKey(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
  return 'step:' + words.slice(0, 4).join(' ')
}
const STOP = new Set(['the', 'and', 'for', 'with', 'into', 'from', 'its', 'then'])

/** Similar shell commands share a key: the program and its first word. */
export function shellKey(command: string): string {
  const parts = command
    .replace(/^\s*(cd\s+\S+\s*&&\s*)+/, '')
    .replace(/^\s*(\w+=\S+\s+)+/, '')
    .trim()
    .split(/\s+/)
  const prog = (parts[0] ?? '').split('/').pop() ?? ''
  const next = parts.slice(1).find(p => !p.startsWith('-')) ?? ''
  return 'shell:' + [prog, next.split('/').pop()].join(' ').trim()
}

function stepDuration(s: Step): number | undefined {
  return s.startedAt !== undefined && s.endedAt !== undefined
    ? Math.max(0, s.endedAt - s.startedAt)
    : undefined
}

type Part = { low: number; high: number } | 'unknown'

/** How long one background piece still needs, from its own history. */
function bgLeft(bg: Bg, hist: History, now: number): Part {
  const past = hist[bg.sig] ?? []
  const typical = median(past)
  const elapsed = now - bg.startedAt
  if (typical === undefined) {
    // A workflow whose agents mostly finished is nearly done.
    if (bg.kind === 'workflow' && bg.agentIds && bg.agentIds.length >= 3) {
      const done = bg.doneAgentIds?.length ?? 0
      const left = bg.agentIds.length - done
      if (done > 0 && left === 0) return { low: 0.5 * MIN, high: 3 * MIN }
    }
    return 'unknown'
  }
  const spread = past.length >= 4 ? 0.35 : past.length >= 2 ? 0.55 : 0.8
  const left = typical - elapsed
  if (left <= 0) return { low: 0.5 * MIN, high: Math.max(2 * MIN, 0.3 * typical) }
  return { low: left * (1 - spread * 0.6), high: left * (1 + spread) }
}

export function estimate(job: Job, hist: History, now: number): Estimate {
  const steps = job.steps
  const done = steps.filter(s => s.status === 'completed')
  const current = steps.find(s => s.status === 'in_progress')
  const pending = steps.filter(s => s.status === 'pending')
  const doneTimes = done.map(stepDuration).filter((d): d is number => d !== undefined)
  const pendingBg = job.bg.filter(b => b.endedAt === undefined)

  // The plan part: steps still to do, priced by this job's finished steps,
  // else by similar steps from earlier sessions.
  let plan: Part | undefined
  let basis = ''
  if (steps.length > 0 && (current || pending.length > 0)) {
    const own = median(doneTimes)
    // A step is priced by this job's own finished steps, or by the same step
    // timed before. Steps from unrelated work are no basis: their average
    // made a 90-second job read "about 2–8 min" before its first step ended.
    const perStep = (s: Step): number | undefined => {
      const similar = median(hist[stepKey(s.text)] ?? [])
      if (similar !== undefined && (own === undefined || doneTimes.length < 2)) return similar
      return own
    }
    let sum = 0
    let isKnown = true
    for (const s of [...(current ? [current] : []), ...pending]) {
      const typical = perStep(s)
      if (typical === undefined) {
        isKnown = false
        break
      }
      if (s === current && current.startedAt !== undefined) {
        sum += Math.max(typical - (now - current.startedAt), 0.25 * typical)
      } else sum += typical
    }
    if (isKnown) {
      const n = doneTimes.length
      const spread = n >= 4 ? 0.35 : n >= 2 ? 0.5 : n === 1 ? 0.7 : 0.8
      plan = { low: sum * (1 - spread * 0.6), high: sum * (1 + spread) }
      basis =
        n > 0
          ? `From ${n} finished step${n === 1 ? '' : 's'}; it gets surer as steps finish.`
          : 'From similar steps in earlier sessions; a rough guess for now.'
    } else {
      plan = 'unknown'
      basis = 'No step has finished yet, so there is no basis for a guess.'
    }
  }

  // The background part: the slowest piece decides.
  let bgPart: Part | undefined
  let bgUnknown = 0
  for (const b of pendingBg) {
    const p = bgLeft(b, hist, now)
    if (p === 'unknown') {
      bgUnknown++
      continue
    }
    bgPart =
      bgPart === undefined || bgPart === 'unknown'
        ? p
        : { low: Math.max(bgPart.low, p.low), high: Math.max(bgPart.high, p.high) }
  }
  if (bgUnknown > 0 && bgPart === undefined) bgPart = 'unknown'
  const extraBg = (job.engineBgCount ?? 0) > pendingBg.length
  if (extraBg && bgPart === undefined) bgPart = 'unknown'

  // Combine. While the main turn waits on background work, the steps after it
  // come once it is back; otherwise both run side by side.
  const known = [plan, bgPart].filter((p): p is { low: number; high: number } => p !== undefined && p !== 'unknown')
  const isFloor = plan === 'unknown' || bgPart === 'unknown' || bgUnknown > 0 || extraBg
  let low: number | undefined
  let high: number | undefined
  if (known.length > 0) {
    const waiting = !job.isTurnRunning && pendingBg.length > 0
    if (waiting && plan !== undefined && plan !== 'unknown' && bgPart !== undefined && bgPart !== 'unknown') {
      low = plan.low + bgPart.low
      high = plan.high + bgPart.high
    } else {
      low = Math.max(...known.map(k => k.low))
      high = Math.max(...known.map(k => k.high))
    }
  }
  if (!basis) {
    if (pendingBg.length > 0) {
      basis =
        bgPart === 'unknown'
          ? 'Nothing like this background work has been timed yet, so no guess.'
          : 'From how long similar background work took before.'
    } else if (steps.length === 0) {
      basis = 'There is no task list for this work, so no guess.'
    } else {
      basis = 'All steps are done; finishing up.'
    }
  } else if (bgUnknown > 0 || extraBg) {
    basis += ' Some background work has no timing yet, so it may take longer.'
  }

  // Progress: steps done, with the current one part-way.
  let progress: number | undefined
  if (steps.length > 0) {
    let part = 0
    const typical = median(doneTimes)
    if (current?.startedAt !== undefined && typical) {
      part = Math.min(0.9, (now - current.startedAt) / typical)
    }
    progress = Math.min(1, (done.length + part) / steps.length)
  } else {
    const wf = pendingBg.find(b => b.kind === 'workflow' && (b.agentIds?.length ?? 0) > 0)
    if (wf) progress = (wf.doneAgentIds?.length ?? 0) / Math.max(1, wf.agentIds!.length) * 0.9
  }

  return { low, high, isFloor, progress, basis }
}

const NICE_S = [5, 10, 15, 20, 30, 45]

/** Seconds rounded down to a plain step: 5, 10, 15, 20, 30 or 45. */
function niceSeconds(ms: number): number {
  const s = ms / 1000
  return [...NICE_S].reverse().find(n => n <= s) ?? 5
}

const NICE_MIN = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 45, 50, 60]

function niceMinutes(ms: number, up: boolean): number {
  const m = ms / MIN
  if (up) return NICE_MIN.find(n => n >= m) ?? Math.ceil(m / 30) * 30
  return [...NICE_MIN].reverse().find(n => n <= m) ?? 1
}

/** "about 10–20 min", "under a minute", "about 1–2 h": never false precision. */
export function formatLeft(e: Estimate): string {
  if (e.low === undefined || e.high === undefined) return 'no estimate yet'
  const lead = e.isFloor ? 'at least ' : 'about '
  // A small floor is said in seconds: "at least a minute" read wrong when
  // 20 seconds of known work were left beside untimed background work.
  if (e.isFloor && e.low < 0.9 * MIN) return `at least ${niceSeconds(e.low)} s`
  if (e.high < 1.2 * MIN) return e.isFloor ? 'at least a minute' : 'under a minute'
  if (e.low >= 50 * MIN) {
    const lo = Math.max(1, Math.round(e.low / (60 * MIN)))
    const hi = Math.max(lo, Math.ceil(e.high / (60 * MIN)))
    if (e.isFloor) return `${lead}${lo} h`
    return lo === hi ? `about ${lo} h` : `about ${lo}–${hi} h`
  }
  const lo = niceMinutes(e.low, false)
  const hi = Math.max(lo, niceMinutes(e.high, true))
  if (e.isFloor) return `${lead}${lo} min`
  if (hi >= 90) return `about ${lo} min – ${Math.round(hi / 60)} h`
  return lo === hi ? `about ${lo} min` : `about ${lo}–${hi} min`
}

/** "45 s", "3 min", "1 h 5 min". */
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}
