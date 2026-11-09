export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type Step = {
  text: string
  status: StepStatus
  startedAt?: number
  endedAt?: number
}

export type BgKind = 'shell' | 'agent' | 'workflow'

export type Bg = {
  /** The tool_use_id of the call that started it. */
  id: string
  kind: BgKind
  label: string
  /** The history key: similar work shares it. */
  sig: string
  startedAt: number
  endedAt?: number
  /** Ids the work is known by: a task id, an agent id. */
  aliases: string[]
  /** For a workflow: its agents started and finished. */
  agentIds?: string[]
  doneAgentIds?: string[]
  phases?: string[]
}

export type Job = {
  id: string
  /** What the person is waiting for, in a few plain words. */
  outcome: string
  prompt: string
  startedAt: number
  endedAt?: number
  steps: Step[]
  bg: Bg[]
  /** What the main loop is doing right now. */
  now?: string
  nowSince?: number
  isTurnRunning: boolean
  /** Background work the engine says is still in flight, by its own count. */
  engineBgCount?: number
  isDismissed?: boolean
}

export type Accent = 'calm' | 'ocean' | 'sunset' | 'forest' | 'candy' | 'mono' | 'rgb'

export type BarStyle =
  | 'aurora'
  | 'minimal'
  | 'neon'
  | 'comet'
  | 'liquid'
  | 'candy'
  | 'arcade'
  | 'terminal'
  | 'blocky'
  | 'jester'
  | 'night'

export type Shape = 'rounded' | 'pill' | 'square' | 'slanted' | 'chevron' | 'hexagon' | 'beads' | 'wedge' | 'stairs'

export type Prefs = {
  view: 'compact' | 'detailed'
  accent: Accent
  showSteps: boolean
  notify: boolean
  /** Seconds a task must run before the band shows (0 = at once). */
  showAfter: number
  /** Above the prompt, or a side panel the person can resize. */
  place: 'band' | 'panel'
  /** Text size of the headline. */
  size: 'small' | 'medium' | 'large'
  style: BarStyle
  /** 'auto' is one block per step; 'none' a single bar; else a count. */
  blocks: 'auto' | 'none' | '5' | '10' | '20' | '30'
  shape: Shape
  thickness: 'thin' | 'medium' | 'thick' | 'chunky'
  /** auto: shows while Claude works; always: stays up, idle too; off: hidden (tracking goes on). */
  power: 'auto' | 'always' | 'off'
  /** When set, power goes back to 'auto' at this time (a snooze, or a timed "always"). */
  powerUntil?: number
  /** When the running timer started, to draw how much of it is gone. */
  powerSince?: number
  /** Turn off once the current job is done. */
  offAfterJob?: boolean
  /** The recommended profile's card is hidden from the Profiles tab. */
  hideRecommended?: boolean
}

export type History = Record<string, number[]>

/** The parts of the settings a profile keeps: everything but on/off and its timers. */
export type Look = Omit<Prefs, 'power' | 'powerUntil' | 'powerSince' | 'offAfterJob' | 'hideRecommended'>

export type Profile = { name: string; look: Look }

/** The "make your own timer" form, as the person fills it in. */
export type TimerDraft = {
  action: 'off' | 'always'
  mode: 'for' | 'until'
  /** For "for": how long, in minutes. */
  minutes: number
  /** For "until": days from today (0 today, 1 tomorrow, ...) and the time, HH:MM. */
  day: number
  time: string
}

declare module 'claude-code' {
  interface PluginState {
    'time-left': {
      job: Shaped<Job | null>
      prefs: Shaped<Prefs>
      tick: number
      isExpanded: boolean
      settingsTab: 'closed' | 'profiles' | 'look' | 'behaviour' | 'power'
      profiles: Shaped<Profile[]>
      activeProfile: string
      notice: string
      lastDeleted: Shaped<Profile | null>
      timerDraft: Shaped<TimerDraft>
    }
  }
}
