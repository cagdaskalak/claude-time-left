import { expect, mock, test } from 'claude-code/testing'

import type { Job } from '../types'
import { estimate, formatLeft, shellKey, stepKey } from '../hooks/estimate'
import { barSvg, SHAPES, STYLES, THICKNESS } from '../hooks/art'

const MIN = 60_000

function jobWith(over: Partial<Job>): Job {
  return { id: 'j', outcome: 'x', prompt: '', startedAt: 0, steps: [], bg: [], isTurnRunning: true, ...over }
}

test('no finished step and no history: no estimate, said plainly', async () => {
  const j = jobWith({
    steps: [
      { text: 'Read the code', status: 'in_progress', startedAt: 0 },
      { text: 'Write the fix', status: 'pending' },
    ],
  })
  const e = estimate(j, {}, 30_000)
  expect(formatLeft(e)).toBe('no estimate yet')
  expect(e.basis).toContain('no basis')
})

test('finished steps price the rest, as a range', async () => {
  const j = jobWith({
    steps: [
      { text: 'a', status: 'completed', startedAt: 0, endedAt: 4 * MIN },
      { text: 'b', status: 'completed', startedAt: 4 * MIN, endedAt: 10 * MIN },
      { text: 'c', status: 'in_progress', startedAt: 10 * MIN },
      { text: 'd', status: 'pending' },
      { text: 'e', status: 'pending' },
    ],
  })
  const e = estimate(j, {}, 11 * MIN)
  const words = formatLeft(e)
  expect(words).toMatch(/^about \d+–\d+ min$/)
  expect(e.low! < e.high!).toBe(true)
  expect(e.progress! > 0.4 && e.progress! < 0.6).toBe(true)
})

test('background work with no timing makes the guess a floor', async () => {
  const j = jobWith({
    isTurnRunning: false,
    steps: [
      { text: 'a', status: 'completed', startedAt: 0, endedAt: 2 * MIN },
      { text: 'b', status: 'pending' },
    ],
    bg: [{ id: 't', kind: 'shell', label: 'tests', sig: 'shell:pytest', startedAt: 0, aliases: [] }],
  })
  expect(formatLeft(estimate(j, {}, 3 * MIN))).toMatch(/^at least/)
  const known = estimate(j, { 'shell:pytest': [6 * MIN, 7 * MIN] }, 3 * MIN)
  expect(known.isFloor).toBe(false)
  expect(formatLeft(known)).toMatch(/^about/)
})

test('similar work shares a history key', async () => {
  expect(shellKey('cd /x && .venv/bin/python -I -m pytest -q')).toBe(shellKey('.venv/bin/python -m pytest tests'))
  expect(stepKey('Run the fast tests')).toBe(stepKey('Run fast tests!'))
})

const BAND = {
  plugin: 'time-left',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

test('a prompt and a task list draw the band, on desktop and terminal', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'time-left' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Login bug fixed', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('tool.call', () => ({ result: {} }))
  // Stands for the engine and for other mods' bands beneath this one.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Please fix the login bug and run the tests.', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Find the cause', status: 'in_progress' },
      { content: 'Fix it', status: 'pending' },
      { content: 'Run the tests', status: 'pending' },
    ],
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /step\s1\sof\s3/i })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /no estimate yet/i })).toBeDefined()
    await ui.press({ key: 'more' })
    expect(await ui.find({ type: 'Text', text: /no basis/ })).toBeDefined()
    await ui.press({ key: 'more' })
    expect(await ui.find({ type: 'Text', text: /no basis/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('every bar style, shape, size and block count draws clean SVG', async () => {
  for (const style of Object.keys(STYLES) as (keyof typeof STYLES)[])
    for (const shape of Object.keys(SHAPES) as (keyof typeof SHAPES)[])
      for (const thickness of Object.keys(THICKNESS) as (keyof typeof THICKNESS)[])
        for (const blocks of ['auto', 'none', '5', '30'] as const)
          for (const progress of [undefined, 0, 0.42, 1]) {
            const svg = barSvg({
              progress,
              isDone: progress === 1,
              isMoving: true,
              steps: 7,
              prefs: { accent: 'rgb', style, shape, thickness, blocks },
            }).source
            expect(svg.startsWith('<svg')).toBe(true)
            expect(svg.endsWith('</svg>')).toBe(true)
            expect(/NaN|undefined|Infinity/.test(svg)).toBe(false)
            expect(svg).toContain('prefers-reduced-motion')
          }
})

const PANE = {
  plugin: 'time-left',
  component: 'Pane',
  requestId: 'time-left',
  props: { title: 'Time left', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the side panel draws the same job', async ($, on) => {
  mock.clock(on, { now: 2_000_000 })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  mock.store(on)
  on('command.register', () => ({ value: { command: 'time-left' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Render the video', wait: false, origin: { kind: 'composer' } })
  const main = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await main.find({ type: 'Text', text: /Render the video/ })).toBeDefined()
  // Settings open in a side panel of their own.
  await main.press({ key: 'gear' })
  await main.unmount()
  const ui = await $.ui.mount({ ...PANE, requestId: 'time-left-settings', props: { ...PANE.props, title: 'Time left · settings' }, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Recommended: Clear/ })).toBeDefined()
  // The recommended card can be hidden, and brought back.
  await ui.press({ key: 'rec-hide' })
  expect(await ui.find({ type: 'Text', text: /Recommended: Clear/ })).toBeUndefined()
  await ui.press({ key: 'rec-show' })
  expect(await ui.find({ type: 'Text', text: /Recommended: Clear/ })).toBeDefined()
  // A name, a save, and the profile is listed and in use.
  await ui.input({ key: 'profile-name', text: 'Late night' })
  expect((await ui.find({ key: 'use-Late night' }))?.props?.label).toBe('✓ Late night')
  await ui.press({ key: 'del-Late night' })
  expect(await ui.find({ type: 'Text', text: /Deleted/ })).toBeDefined()
  await ui.press({ key: 'undo-delete' })
  expect(await ui.find({ key: 'use-Late night' })).toBeDefined()
  await ui.press({ key: 'use-Late night' })
  await ui.press({ key: 'tab-look' })
  // The look tab saves too, and a changed own profile offers to save its changes.
  expect(await ui.find({ key: 'profile-name-look' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Pick a bar style/ })).toBeDefined()
  // Picking a style by its card, then the other tabs.
  await ui.press({ key: 'style-neon' })
  // Neon draws every shape, so all nine are offered.
  expect(await ui.find({ key: 'shape-hexagon' })).toBeDefined()
  expect((await ui.find({ key: 'style-neon' }))?.props?.label).toBe('✓ Neon')
  expect((await ui.find({ key: 'save-changes' }))?.props?.label).toBe('Save changes to “Late night”')
  await ui.press({ key: 'tab-behaviour' })
  expect(await ui.find({ type: 'Text', text: /Where should it sit/ })).toBeDefined()
  await ui.press({ key: 'tab-power' })
  await ui.press({ key: 'power-off' })
  expect((await ui.find({ key: 'power-off' }))?.props?.label).toBe('✓ Off')
  // A custom timer: always on for 2 hours, with its countdown and a cancel.
  await ui.press({ key: 'd-always' })
  await ui.press({ key: 'd-len-120' })
  expect((await ui.find({ key: 'd-len-120' }))?.props?.label).toBe('✓ 2 hours')
  await ui.press({ key: 'd-start' })
  expect(await ui.find({ type: 'Text', text: /2 h left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Always on until/ })).toBeDefined()
  await ui.press({ key: 't-cancel' })
  expect(await ui.find({ type: 'Text', text: /2 h left/ })).toBeUndefined()
  await ui.press({ key: 'power-auto' })
  await ui.press({ key: 'settings-done' })
  await ui.unmount()
  const back = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await back.find({ type: 'Text', text: /Render the video/ })).toBeDefined()
  await back.unmount()
})

test('off hides the band, and on brings back the job as it stands', async ($, on) => {
  mock.clock(on, { now: 3_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'time-left' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'time-left', args: 'off' } as never)
  await $.prompt.submit({ text: 'Fix the login bug', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Find it', status: 'in_progress' }, { content: 'Fix it', status: 'pending' }] })
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Fix the login bug/ })).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'time-left', args: 'on' } as never)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Fix the login bug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /step\s1\sof\s2/i })).toBeDefined()
  await ui.unmount()
})

test('every step ticked reads "Almost done", not "No estimate yet"', async ($, on) => {
  mock.clock(on, { now: 4_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'time-left' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Tidy the docs', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'completed' }] })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Almost done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /No estimate yet/i })).toBeUndefined()
    await ui.unmount()
  }
})
