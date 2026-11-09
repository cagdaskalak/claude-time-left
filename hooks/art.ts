// The band's pictures: the progress bar in eleven original styles, and a
// status dot. Motion is CSS only, so prefers-reduced-motion stops all of it.
import type { Accent, BarStyle, Prefs, Shape } from '../types'

export const ACCENTS: Record<Accent, { label: string; from: string; to: string }> = {
  calm: { label: 'Violet', from: '#7C6CF2', to: '#4F8CF7' },
  ocean: { label: 'Ocean', from: '#06B6D4', to: '#2563EB' },
  sunset: { label: 'Sunset', from: '#F59E0B', to: '#E11D48' },
  forest: { label: 'Forest', from: '#22C55E', to: '#0D9488' },
  candy: { label: 'Candy', from: '#F472B6', to: '#A855F7' },
  mono: { label: 'Graphite', from: '#94A3B8', to: '#64748B' },
  rgb: { label: 'Rainbow', from: '#FF3B6B', to: '#3B82F6' },
}

export const STYLES: Record<BarStyle, { label: string; hint: string }> = {
  aurora: { label: 'Aurora', hint: 'soft glow and shine' },
  minimal: { label: 'Minimal', hint: 'a calm line, no motion' },
  neon: { label: 'Neon', hint: 'a glowing tube' },
  comet: { label: 'Comet', hint: 'a bright head with a trail' },
  liquid: { label: 'Liquid', hint: 'water that fills up' },
  candy: { label: 'Candy', hint: 'glossy, striped, playful' },
  arcade: { label: 'Arcade', hint: '8-bit pixel blocks' },
  terminal: { label: 'Terminal', hint: 'green screen, old school' },
  blocky: { label: 'Blocky', hint: 'chunky 3D cubes' },
  jester: { label: 'Jester', hint: 'harlequin diamonds, gold trim' },
  night: { label: 'Night watch', hint: 'dark steel and gold' },
}

export const SHAPES: Record<Shape, string> = {
  rounded: 'Rounded',
  pill: 'Pill',
  square: 'Square',
  slanted: 'Slanted',
  chevron: 'Arrows',
  hexagon: 'Hexagons',
  beads: 'Beads',
  wedge: 'Wedge (grows)',
  stairs: 'Stairs (rising)',
}

/** The shapes a style really draws: the rest would look the same as one of these. */
export function shapesFor(style: BarStyle): Shape[] {
  if (style === 'minimal' || style === 'comet') return []
  if (style === 'arcade' || style === 'blocky' || style === 'terminal') return ['square', 'stairs']
  const all = Object.keys(SHAPES) as Shape[]
  if (style === 'night') return all.filter(s => s !== 'rounded' && s !== 'pill' && s !== 'square' && s !== 'beads')
  return all
}

export const THICKNESS: Record<Prefs['thickness'], { label: string; px: number }> = {
  thin: { label: 'Thin', px: 5 },
  medium: { label: 'Medium', px: 9 },
  thick: { label: 'Thick', px: 14 },
  chunky: { label: 'Chunky', px: 22 },
}

/** Styles that need room to read. */
const MIN_H: Partial<Record<BarStyle, number>> = { arcade: 10, terminal: 10, blocky: 12, liquid: 12, jester: 10, candy: 9, comet: 8 }
/** Styles whose look spills past the bar (glows, heads): they get headroom. */
const HALO: Partial<Record<BarStyle, number>> = { aurora: 0.55, neon: 0.9, comet: 0.9, terminal: 0.5, night: 0.4, minimal: 0.5 }

const RAINBOW = ['#FF3B6B', '#FF9F1C', '#F7E733', '#2EC4B6', '#3B82F6', '#8B5CF6', '#FF3B6B']

export type BarInput = {
  progress: number | undefined
  isDone: boolean
  isMoving: boolean
  /** Steps in the task list, for blocks: 'auto'. */
  steps: number
  /** The width the bar is drawn at, in CSS pixels, so shapes keep their proportions. */
  width?: number
  prefs: Pick<Prefs, 'accent' | 'style' | 'blocks' | 'shape' | 'thickness'>
}

export type Bar = { source: string; height: number }

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

export function barSvg(p: BarInput): Bar {
  const style = p.prefs.style
  const W = Math.max(80, Math.round(p.width ?? 600))
  const H = Math.max(THICKNESS[p.prefs.thickness].px, MIN_H[style] ?? 0)
  const pad = Math.ceil(H * (HALO[style] ?? 0))
  const HT = H + 2 * pad
  const prog = p.isDone ? 1 : p.progress
  const anim = p.isMoving && !p.isDone
  const acc = ACCENTS[p.prefs.accent]
  const isRgb = p.prefs.accent === 'rgb'

  // The pixel styles stay on their grid; Night watch keeps an edge.
  const asked = p.prefs.shape
  const shape: Shape =
    style === 'arcade' || style === 'blocky' || style === 'terminal'
      ? asked === 'stairs'
        ? 'stairs'
        : 'square'
      : style === 'night' && (asked === 'rounded' || asked === 'pill' || asked === 'square' || asked === 'beads')
        ? 'slanted'
        : style === 'comet' || style === 'minimal'
          ? 'rounded'
          : asked
  const rx = shape === 'pill' ? H / 2 : shape === 'rounded' ? Math.min(7, H * 0.38) : shape === 'stairs' ? Math.min(3, H * 0.2) : 0
  const skew = 0
  const lean = shape === 'slanted' ? Math.ceil(H * 0.5) : 0
  const tip = shape === 'chevron' || shape === 'hexagon' ? Math.ceil(H * 0.45) : 0

  // Cells: one per step, a fixed count, or the style's or shape's own grain.
  const grain = () => {
    const per = shape === 'beads' ? H * 1.45 : style === 'terminal' ? H * 0.75 : style === 'arcade' ? H * 1.15 : H * 1.6
    return Math.max(shape === 'stairs' ? 6 : 8, Math.min(90, Math.floor(W / per)))
  }
  const cellsFor = (): number => {
    const b = p.prefs.blocks
    if (style === 'comet' || style === 'liquid') return shape === 'beads' && style === 'liquid' ? grain() : 0
    const grained = style === 'arcade' || style === 'terminal' || style === 'blocky' || shape === 'beads'
    if (b === 'none') return grained ? grain() : shape === 'stairs' ? 8 : 0
    if (b === 'auto') {
      if (grained) return grain()
      if (p.steps >= 2 && p.steps <= 40) return p.steps
      return shape === 'stairs' ? 8 : 0
    }
    return Number(b)
  }
  const n = cellsFor()
  const gap =
    n > 0
      ? shape === 'beads'
        ? 0 // set by the bead size below
        : shape === 'chevron'
          ? Math.max(2, H * 0.22)
          : style === 'terminal'
            ? Math.max(2, H * 0.28)
            : style === 'arcade'
              ? Math.max(2, H * 0.18)
              : Math.max(2, Math.min(7, H * 0.4))
      : 0
  const x0 = 0
  const usable = W
  const slots =
    n > 0
      ? shape === 'beads'
        ? Array.from({ length: n }, (_, i) => {
            const d = Math.min(H, usable / n)
            const g = n > 1 ? (usable - d * n) / (n - 1) : 0
            return { x: i * (d + g), w: d }
          })
        : Array.from({ length: n }, (_, i) => {
            const w = (usable - gap * (n - 1)) / n
            return { x: x0 + i * (w + gap), w }
          })
      : [{ x: x0, w: usable }]
  const whole = style === 'arcade' || style === 'terminal' || style === 'blocky' || shape === 'beads'
  const fills = slots.map((_, i) => {
    if (prog === undefined) return 0
    const v = Math.max(0, Math.min(1, prog * slots.length - i))
    return whole ? (v >= 0.5 ? 1 : 0) : v
  })
  let head = x0
  slots.forEach((s, i) => {
    if (fills[i]! > 0) head = s.x + s.w * fills[i]!
  })
  const nextEmpty = fills.findIndex(v => v === 0)

  /** The height of the wedge at x: it grows from a fifth to full. */
  const wedgeH = (x: number) => H * (0.22 + 0.78 * Math.max(0, Math.min(1, x / W)))

  /** The outline of slot i, as a path: the shape every style is cut to. */
  const outline = (i: number): string => {
    const s = slots[i]!
    const x = s.x
    const w = s.w
    const r = f1
    const first = i === 0
    const last = i === slots.length - 1
    switch (shape) {
      case 'slanted':
        return `M${r(x + lean)} 0H${r(x + w)}L${r(x + w - lean)} ${H}H${r(x)}Z`
      case 'chevron': {
        const back = first ? 0 : tip
        return `M${r(x)} 0H${r(x + w - tip)}L${r(x + w)} ${H / 2}L${r(x + w - tip)} ${H}H${r(x)}L${r(x + back)} ${H / 2}Z`
      }
      case 'hexagon':
        return `M${r(x + tip)} 0H${r(x + w - tip)}L${r(x + w)} ${H / 2}L${r(x + w - tip)} ${H}H${r(x + tip)}L${r(x)} ${H / 2}Z`
      case 'beads': {
        const rad = w / 2
        const cx = x + rad
        return `M${r(cx - rad)} ${H / 2}a${r(rad)} ${r(rad)} 0 1 0 ${r(rad * 2)} 0a${r(rad)} ${r(rad)} 0 1 0 ${r(-rad * 2)} 0Z`
      }
      case 'wedge': {
        const h1 = wedgeH(x)
        const h2 = wedgeH(x + w)
        const c = Math.min(3, h1 * 0.3)
        return `M${r(x + c)} ${r((H - h1) / 2)}L${r(x + w - c)} ${r((H - h2) / 2)}Q${r(x + w)} ${r((H - h2) / 2)} ${r(x + w)} ${r((H - h2) / 2 + c)}V${r((H + h2) / 2 - c)}Q${r(x + w)} ${r((H + h2) / 2)} ${r(x + w - c)} ${r((H + h2) / 2)}L${r(x + c)} ${r((H + h1) / 2)}Q${r(x)} ${r((H + h1) / 2)} ${r(x)} ${r((H + h1) / 2 - c)}V${r((H - h1) / 2 + c)}Q${r(x)} ${r((H - h1) / 2)} ${r(x + c)} ${r((H - h1) / 2)}Z`
      }
      case 'stairs': {
        const h = H * (0.3 + (0.7 * (i + 1)) / slots.length)
        return roundRect(x, H - h, w, h, rx)
      }
      default:
        void last
        return roundRect(x, 0, w, H, rx)
    }
  }
  const P = (i: number, extra = '') => `<path d="${outline(i)}" ${extra}/>`

  const R = (x: number, w: number, extra = '', r = 0) =>
    `<rect x="${f1(x)}" y="0" width="${f1(Math.max(0, w))}" height="${H}" rx="${f1(r)}" ${extra}/>`

  const grad = (id: string, a: string, b: string, x2: number) =>
    isRgb
      ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" x2="${W * 2}" y1="0" y2="0">${RAINBOW.map((c, i) => `<stop offset="${(i / 6).toFixed(3)}" stop-color="${c}"/>`).join('')}</linearGradient>`
      : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" x2="${f1(Math.max(x2, 1))}" y1="0" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
  const flowW = isRgb ? W * 2 : W
  const flowCls = isRgb && anim ? 'flow' : ''

  let defs = ''
  let css = ''
  let track = ''
  let paint = ''
  let over = '' // above the clipped fill, unclipped
  let under = '' // below everything (glows, frames)
  const trackAll = (fill: string, extra = '') => slots.map((_, i) => P(i, `fill="${fill}" ${extra}`)).join('')
  const softTrack = 'rgba(128,128,128,.2)'

  switch (style) {
    case 'aurora': {
      defs += grad('g', acc.from, acc.to, head)
      defs += `<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
      defs += `<filter id="blur" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="${f1(H * 0.45)}"/></filter>`
      track = trackAll(softTrack)
      paint = `<rect class="${flowCls}" x="0" y="0" width="${flowW}" height="${H}" fill="url(#g)"/><rect x="0" y="0" width="${W}" height="${f1(H * 0.55)}" fill="url(#sheen)"/>`
      if (anim) paint += `<rect class="sweep" x="0" y="0" width="${f1(W * 0.18)}" height="${H}" fill="url(#shine)"/>`
      under = `<g filter="url(#blur)" opacity=".55"><g clip-path="url(#c)"><g clip-path="url(#lim)"><rect class="${flowCls}" x="0" y="0" width="${flowW}" height="${H}" fill="url(#g)"/></g></g></g>`
      break
    }
    case 'minimal': {
      const line = Math.max(2, Math.round(H * 0.34))
      const y = (H - line) / 2
      defs += grad('g', acc.from, acc.from, head)
      track = slots.map(s => `<rect x="${f1(s.x)}" y="${f1(y)}" width="${f1(s.w)}" height="${line}" rx="${line / 2}" fill="${softTrack}"/>`).join('')
      paint = `<rect x="0" y="${f1(y)}" width="${W}" height="${line}" fill="url(#g)"/>`
      if (prog !== undefined && prog > 0 && prog < 1)
        over = `<circle cx="${f1(head)}" cy="${H / 2}" r="${f1(H * 0.5)}" fill="${isRgb ? '#8B5CF6' : acc.from}"/><circle cx="${f1(head)}" cy="${H / 2}" r="${f1(H * 0.22)}" fill="#fff"/>`
      break
    }
    case 'neon': {
      defs += grad('g', acc.from, acc.to, head)
      defs += `<filter id="glow" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="${f1(H * 0.55)}" result="b1"/><feGaussianBlur in="SourceGraphic" stdDeviation="${f1(H * 0.2)}" result="b2"/><feMerge><feMergeNode in="b1"/><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      track = trackAll('rgba(10,10,20,.55)', `stroke="rgba(160,160,200,.28)" stroke-width="1"`)
      const core = Math.max(1.5, H * 0.3)
      paint = `<rect class="${flowCls}" x="0" y="0" width="${flowW}" height="${H}" fill="url(#g)"/><rect x="0" y="${f1((H - core) / 2)}" width="${W}" height="${f1(core)}" fill="#fff" fill-opacity=".85"/>`
      under = `<g class="${anim ? 'buzz' : ''}" filter="url(#glow)"><g clip-path="url(#c)"><g clip-path="url(#lim)"><rect class="${flowCls}" x="0" y="0" width="${flowW}" height="${H}" fill="url(#g)"/></g></g></g>`
      break
    }
    case 'comet': {
      const c = isRgb ? '#8B5CF6' : acc.to
      defs += `<linearGradient id="trail" gradientUnits="userSpaceOnUse" x1="${f1(x0)}" x2="${f1(Math.max(head, x0 + 1))}" y1="0" y2="0"><stop offset="0" stop-color="${acc.from}" stop-opacity="0"/><stop offset=".55" stop-color="${acc.from}" stop-opacity=".45"/><stop offset="1" stop-color="${c}" stop-opacity="1"/></linearGradient>`
      defs += `<radialGradient id="halo"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="${c}" stop-opacity=".85"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
      track = `<rect x="${x0}" y="${f1(H * 0.4)}" width="${usable}" height="${f1(H * 0.2)}" rx="${f1(H * 0.1)}" fill="${softTrack}"/>`
      paint = `<path d="M${f1(x0)} ${f1(H * 0.45)} L${f1(head)} 0 L${f1(head)} ${H} L${f1(x0)} ${f1(H * 0.55)}Z" fill="url(#trail)"/>`
      if (prog !== undefined && prog > 0) {
        over = `<circle class="${anim ? 'throb' : ''}" cx="${f1(head)}" cy="${H / 2}" r="${f1(H * 1.3)}" fill="url(#halo)"/><circle cx="${f1(head)}" cy="${H / 2}" r="${f1(H * 0.38)}" fill="#fff"/>`
        if (anim)
          over += [0.7, 1.6, 2.6]
            .map(
              (k, i) =>
                `<circle class="twinkle t${i}" cx="${f1(head - k * H * 1.6)}" cy="${f1(H / 2 + (i % 2 ? -1 : 1) * H * 0.55)}" r="${f1(H * 0.12)}" fill="#fff"/>`,
            )
            .join('')
      }
      break
    }
    case 'liquid': {
      defs += grad('g', acc.from, acc.to, head)
      defs += `<linearGradient id="depth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>`
      const amp = H * 0.14
      const wl = Math.max(18, H * 2.4)
      let wave = `M0 ${f1(amp * 2)}`
      for (let x = 0; x <= W + wl * 2; x += wl) wave += ` q${f1(wl / 4)} ${f1(-amp * 2)} ${f1(wl / 2)} 0 t${f1(wl / 2)} 0`
      wave += ` V${H} H0Z`
      track = trackAll(softTrack)
      paint = `<g class="${anim ? 'wave' : ''}"><path d="${wave}" fill="url(#g)" transform="translate(${f1(-wl)} 0)"/></g><rect x="0" y="0" width="${W}" height="${H}" fill="url(#depth)"/>`
      if (anim && prog !== undefined && prog > 0.04)
        paint += [0.2, 0.45, 0.7, 0.9]
          .map(
            (k, i) =>
              `<circle class="bubble b${i}" cx="${f1(x0 + (head - x0) * k)}" cy="${f1(H * 0.8)}" r="${f1(Math.max(1, H * 0.09))}" fill="#fff" fill-opacity=".7"/>`,
          )
          .join('')
      css += `.wave{animation:wave 2.6s linear infinite}@keyframes wave{to{transform:translateX(${f1(wl)}px)}}`
      break
    }
    case 'candy': {
      defs += grad('g', acc.from, acc.to, head)
      const sw = Math.max(7, H * 0.9)
      defs += `<pattern id="st" width="${f1(sw * 2)}" height="${H}" patternUnits="userSpaceOnUse" patternTransform="skewX(-40)"><rect width="${f1(sw)}" height="${H}" fill="#fff" fill-opacity=".32"/></pattern>`
      track = trackAll(softTrack)
      paint = `<rect class="${flowCls}" x="0" y="0" width="${flowW}" height="${H}" fill="url(#g)"/><rect class="${anim ? 'march' : ''}" x="${f1(-sw * 2)}" y="0" width="${f1(W + sw * 4)}" height="${H}" fill="url(#st)"/><rect x="${f1(H * 0.3)}" y="${f1(H * 0.14)}" width="${f1(W)}" height="${f1(H * 0.22)}" rx="${f1(H * 0.11)}" fill="#fff" fill-opacity=".45"/><rect x="0" y="${f1(H * 0.78)}" width="${W}" height="${f1(H * 0.22)}" fill="#000" fill-opacity=".12"/>`
      css += `.march{animation:march .8s linear infinite}@keyframes march{to{transform:translateX(${f1(sw * 2)}px)}}`
      break
    }
    case 'arcade': {
      // Square pixels on a checkered track; each lit cell has a highlight
      // pixel and a shadow row; the colours step through a small ramp.
      const px = Math.max(1, Math.round(H / 5))
      defs += `<pattern id="chk" width="${px * 2}" height="${px * 2}" patternUnits="userSpaceOnUse"><rect width="${px * 2}" height="${px * 2}" fill="rgba(128,128,128,.16)"/><rect width="${px}" height="${px}" fill="rgba(128,128,128,.28)"/><rect x="${px}" y="${px}" width="${px}" height="${px}" fill="rgba(128,128,128,.28)"/></pattern>`
      track = trackAll('url(#chk)')
      const ramp = isRgb ? RAINBOW.slice(0, 6) : [acc.from, mix(acc.from, acc.to, 0.5), acc.to]
      paint = slots
        .map((s, i) => {
          const col = ramp[Math.min(ramp.length - 1, Math.floor((i / slots.length) * ramp.length))]!
          return `${R(s.x, s.w, `fill="${col}"`)}<rect x="${f1(s.x)}" y="0" width="${f1(s.w)}" height="${px}" fill="#fff" fill-opacity=".45"/><rect x="${f1(s.x)}" y="0" width="${px}" height="${H}" fill="#fff" fill-opacity=".25"/><rect x="${f1(s.x)}" y="${H - px}" width="${f1(s.w)}" height="${px}" fill="#000" fill-opacity=".35"/><rect x="${f1(s.x + s.w - px)}" y="0" width="${px}" height="${H}" fill="#000" fill-opacity=".2"/>`
        })
        .join('')
      if (anim && nextEmpty >= 0) {
        over = P(nextEmpty, `class="blink" fill="${ramp[ramp.length - 1]}" fill-opacity=".6"`)
      }
      break
    }
    case 'terminal': {
      const g = '#3BFF6E'
      defs += `<filter id="glow" x="-5%" y="-150%" width="110%" height="400%"><feGaussianBlur stdDeviation="${f1(H * 0.28)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      under = `<rect x="${f1(x0 - 4)}" y="-3" width="${f1(usable + 8)}" height="${H + 6}" rx="3" fill="#06140A" stroke="#1B5E2C" stroke-width="1"/>`
      track = trackAll('#0E2A16')
      paint = `<rect x="0" y="0" width="${W}" height="${H}" fill="${g}"/>`
      for (let y = 1; y < H; y += 3) paint += `<rect x="0" y="${y}" width="${W}" height="1" fill="#000" fill-opacity=".28"/>`
      if (anim && nextEmpty >= 0) {
        over = P(nextEmpty, `class="blink" fill="${g}" fill-opacity=".65"`)
      }
      break
    }
    case 'blocky': {
      // Cubes: a lit top face, a shaded right face and a grain of pixels.
      const px = Math.max(2, Math.round(H / 6))
      const base = isRgb ? '#3B82F6' : acc.from
      const topC = mix(base, '#FFFFFF', 0.35)
      const side = mix(base, '#000000', 0.3)
      track = trackAll('rgba(128,128,128,.18)')
      paint = slots
        .map((s, i) => {
          let t = `${R(s.x, s.w, `fill="${base}"`)}<rect x="${f1(s.x)}" y="0" width="${f1(s.w)}" height="${f1(H * 0.28)}" fill="${topC}"/><rect x="${f1(s.x + s.w - px * 1.5)}" y="0" width="${f1(px * 1.5)}" height="${H}" fill="${side}"/><rect x="${f1(s.x)}" y="${H - px}" width="${f1(s.w)}" height="${px}" fill="#000" fill-opacity=".3"/>`
          // A fixed grain per cube, the same on every draw.
          for (let k = 0; k < 4; k++) {
            const gx = s.x + (((i * 37 + k * 53) % 100) / 100) * Math.max(1, s.w - px * 2.5)
            const gy = H * 0.32 + (((i * 17 + k * 29) % 100) / 100) * (H * 0.5)
            t += `<rect x="${f1(gx)}" y="${f1(gy)}" width="${px}" height="${px}" fill="${k % 2 ? topC : side}" fill-opacity=".7"/>`
          }
          return t
        })
        .join('')
      break
    }
    case 'jester': {
      const a = isRgb ? '#8B5CF6' : '#7C3AED'
      const b = '#16A34A'
      const gold = '#EAB308'
      const d = Math.max(12, H * 1.5)
      defs += `<pattern id="dia" width="${f1(d)}" height="${H}" patternUnits="userSpaceOnUse"><rect width="${f1(d)}" height="${H}" fill="${a}"/><path d="M0 ${H / 2} L${f1(d / 2)} 0 L${f1(d)} ${H / 2} L${f1(d / 2)} ${H}Z" fill="${b}" stroke="${gold}" stroke-width="1"/></pattern>`
      track = trackAll(softTrack)
      paint = `<rect class="${anim ? 'jig' : ''}" x="${f1(-d)}" y="0" width="${f1(W + d * 2)}" height="${H}" fill="url(#dia)"/><rect x="0" y="0" width="${W}" height="1.5" fill="${gold}"/><rect x="0" y="${H - 1.5}" width="${W}" height="1.5" fill="${gold}"/>`
      css += `.jig{animation:jig 1.6s ease-in-out infinite alternate}@keyframes jig{to{transform:translateX(${f1(d)}px)}}`
      break
    }
    case 'night': {
      defs += `<linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#374151"/><stop offset="1" stop-color="#111827"/></linearGradient>`
      defs += `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDE68A"/><stop offset=".45" stop-color="#FACC15"/><stop offset="1" stop-color="#B45309"/></linearGradient>`
      defs += `<filter id="glow" x="-5%" y="-150%" width="110%" height="400%"><feGaussianBlur stdDeviation="${f1(H * 0.35)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      track = trackAll('url(#steel)', 'stroke="#4B5563" stroke-width="1"')
      paint = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#gold)"/>`
      if (anim) paint += `<rect class="sweep" x="0" y="0" width="${f1(W * 0.12)}" height="${H}" fill="url(#shine)"/>`
      break
    }
  }

  const fillClip = slots.map((_, i) => (fills[i]! > 0 ? `<path d="${outline(i)}"/>` : '')).join('')
  const allClip = slots.map((_, i) => `<path d="${outline(i)}"/>`).join('')
  const glowFill = style === 'terminal' || style === 'night' ? ' filter="url(#glow)"' : ''

  // Working, amount unknown: a glint that glides along the track.
  let body: string
  if (prog === undefined) {
    const segW = usable * 0.22
    defs += grad('gi', acc.from, acc.to, segW)
    const frame = style === 'terminal' ? under : ''
    const glint = style === 'terminal' ? '#3BFF6E' : style === 'night' ? 'url(#gold)' : 'url(#gi)'
    body = `${frame}${track}<g clip-path="url(#all)"><g class="${anim ? 'slide' : ''}"><rect x="${x0}" y="0" width="${f1(segW)}" height="${H}" fill="${glint}"/></g></g>`
    css += `.slide{animation:slide 1.9s ease-in-out infinite alternate}@keyframes slide{to{transform:translateX(${f1(usable - segW)}px)}}`
  } else {
    body = `${under}${track}<g clip-path="url(#c)"${glowFill}><g clip-path="url(#lim)">${paint}</g></g>${over}`
  }

  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-pad} ${W} ${HT}" width="${W}" height="${HT}" preserveAspectRatio="none">
<style>
.flow{animation:flow 7s linear infinite}@keyframes flow{from{transform:translateX(-${W}px)}to{transform:translateX(0)}}
.sweep{animation:sweep 2.8s ease-in-out infinite}@keyframes sweep{from{transform:translateX(-${f1(W * 0.2)}px)}to{transform:translateX(${f1(W * 1.05)}px)}}
.buzz{animation:buzz 2.2s ease-in-out infinite}@keyframes buzz{0%,100%{opacity:1}50%{opacity:.7}}
.throb{transform-box:fill-box;transform-origin:center;animation:throb 1.4s ease-in-out infinite}@keyframes throb{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
.twinkle{animation:tw 1.2s ease-in-out infinite}.t1{animation-delay:.4s}.t2{animation-delay:.8s}@keyframes tw{0%,100%{opacity:0}50%{opacity:.9}}
.bubble{animation:rise 2.4s ease-in infinite}.b1{animation-delay:.6s}.b2{animation-delay:1.2s}.b3{animation-delay:1.8s}@keyframes rise{0%{opacity:0;transform:translateY(0)}20%{opacity:.8}100%{opacity:0;transform:translateY(-${f1(H * 0.6)}px)}}
.blink{animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}
${css}
@media (prefers-reduced-motion: reduce){*{animation:none !important}}
</style>
<defs><linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>${defs}<clipPath id="c">${fillClip || '<rect width="0" height="0"/>'}</clipPath><clipPath id="all">${allClip}</clipPath><clipPath id="lim"><rect x="-2" y="${-pad}" width="${f1(Math.max(0, head + 2))}" height="${HT}"/></clipPath></defs>
<g transform="skewX(${skew})">${body}</g>
</svg>`
  return { source, height: HT }
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const q = Math.max(0, Math.min(r, w / 2, h / 2))
  const f = f1
  if (q === 0) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`
  return `M${f(x + q)} ${f(y)}H${f(x + w - q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w)} ${f(y + q)}V${f(y + h - q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w - q)} ${f(y + h)}H${f(x + q)}A${f(q)} ${f(q)} 0 0 1 ${f(x)} ${f(y + h - q)}V${f(y + q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + q)} ${f(y)}Z`
}

/** Two hex colours mixed: t=0 the first, t=1 the second. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')
}

/** A dot that breathes while work runs; a check when done; a ring when waiting. */
export function dotSvg(state: 'working' | 'waiting' | 'done', accent: Accent, isMoving: boolean, size = 16): string {
  if (state === 'done') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}"><circle cx="8" cy="8" r="8" fill="#16A34A"/><path d="M4.5 8.3l2.2 2.2 4.8-4.9" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  }
  const c = ACCENTS[accent]
  const isRgb = accent === 'rgb'
  const moving = isMoving && state === 'working'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}"><style>
.p{transform-origin:8px 8px;animation:pulse 1.6s ease-in-out infinite}
.h{animation:hue 5s linear infinite}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.7)}50%{opacity:0;transform:scale(1.25)}}
@keyframes hue{to{filter:hue-rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.p,.h{animation:none}.p{opacity:0}}</style>
<defs><linearGradient id="d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.from}"/><stop offset="1" stop-color="${c.to}"/></linearGradient></defs>
<g class="${isRgb && moving ? 'h' : ''}">${moving ? '<circle class="p" cx="8" cy="8" r="7.5" fill="url(#d)"/>' : ''}
<circle cx="8" cy="8" r="${state === 'waiting' ? 4 : 4.5}" fill="${state === 'waiting' ? 'none' : 'url(#d)'}" stroke="url(#d)" stroke-width="${state === 'waiting' ? 2 : 0}"/></g></svg>`
}

/** A colour swatch for the settings: a round chip in the theme's gradient, a check when picked. */
export function swatchSvg(accent: Accent, isPicked: boolean): string {
  const c = ACCENTS[accent]
  const stops =
    accent === 'rgb'
      ? RAINBOW.map((col, i) => `<stop offset="${(i / 6).toFixed(3)}" stop-color="${col}"/>`).join('')
      : `<stop offset="0" stop-color="${c.from}"/><stop offset="1" stop-color="${c.to}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>${
    isPicked ? '<circle cx="14" cy="14" r="13" fill="none" stroke="#9CA3AF" stroke-width="2"/>' : ''
  }<circle cx="14" cy="14" r="${isPicked ? 9.5 : 11}" fill="url(#s)"/>${
    isPicked ? '<path d="M9.8 14.3l2.8 2.8 5.6-5.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : ''
  }</svg>`
}

/** The terminal has no SVG: a bar of blocks. */
export function barText(progress: number | undefined, width: number): string {
  const n = Math.max(6, Math.min(30, width))
  if (progress === undefined) return '▱'.repeat(n)
  const full = Math.round(progress * n)
  return '▰'.repeat(full) + '▱'.repeat(n - full)
}

// ---------------------------------------------------------------- settings pictures
// Small diagrams for the settings' answers. Neutral greys read on light and
// dark alike; the accent marks the part the answer is about.

const LINE = 'rgba(128,128,128,.55)'
const FAINT = 'rgba(128,128,128,.22)'
const pic = (w: number, h: number, body: string, css = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${
    css ? `<style>${css}@media (prefers-reduced-motion: reduce){*{animation:none !important}}</style>` : ''
  }${body}</svg>`

/** A chat window, with the time-left box where the answer puts it. */
export function wireSvg(
  kind: 'band' | 'panel' | 'compact' | 'detailed' | 'steps-on' | 'steps-off',
  accent: Accent,
): string {
  const a = ACCENTS[accent].from
  const frame = `<rect x="1" y="1" width="110" height="66" rx="7" fill="${FAINT}" stroke="${LINE}"/>`
  const msgs = `<rect x="10" y="10" width="46" height="5" rx="2.5" fill="${LINE}"/><rect x="30" y="20" width="44" height="5" rx="2.5" fill="${LINE}"/><rect x="10" y="30" width="38" height="5" rx="2.5" fill="${LINE}"/>`
  const prompt = `<rect x="8" y="56" width="${kind === 'panel' ? 64 : 96}" height="7" rx="3.5" fill="none" stroke="${LINE}"/>`
  switch (kind) {
    case 'band':
      return pic(112, 68, `${frame}${msgs}<rect x="8" y="42" width="96" height="10" rx="3" fill="${a}" fill-opacity=".85"/>${prompt}`)
    case 'panel':
      return pic(112, 68, `${frame}${msgs.replace(/width="4[46]"/g, 'width="34"')}<rect x="78" y="6" width="28" height="56" rx="4" fill="${a}" fill-opacity=".85"/><rect x="82" y="12" width="20" height="3" rx="1.5" fill="#fff" fill-opacity=".8"/><rect x="82" y="19" width="16" height="3" rx="1.5" fill="#fff" fill-opacity=".6"/>${prompt}`)
    case 'compact':
      return pic(112, 68, `<rect x="1" y="14" width="110" height="40" rx="7" fill="${FAINT}" stroke="${LINE}"/><rect x="10" y="22" width="52" height="7" rx="3" fill="${LINE}"/><rect x="10" y="33" width="34" height="4" rx="2" fill="${LINE}" fill-opacity=".6"/><rect x="10" y="43" width="92" height="4" rx="2" fill="${a}"/>`)
    case 'detailed':
      return pic(112, 68, `<rect x="1" y="1" width="110" height="66" rx="7" fill="${FAINT}" stroke="${LINE}"/><rect x="10" y="8" width="52" height="7" rx="3" fill="${LINE}"/><rect x="10" y="19" width="34" height="4" rx="2" fill="${LINE}" fill-opacity=".6"/><rect x="10" y="28" width="92" height="4" rx="2" fill="${a}"/>${[37, 45, 53]
        .map((y, i) => `<circle cx="13" cy="${y + 2}" r="2" fill="${i === 0 ? a : LINE}"/><rect x="19" y="${y}" width="${[56, 44, 50][i]}" height="4" rx="2" fill="${LINE}" fill-opacity=".7"/>`)
        .join('')}`)
    case 'steps-on':
      return pic(112, 68, [12, 24, 36, 48]
        .map((y, i) => {
          const c = y + 2.5
          const mark =
            i < 2
              ? `<path d="M7 ${c} l2.5 2.5 l5 -5" fill="none" stroke="${a}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
              : i === 2
                ? `<path d="M8 ${c - 3.5} l6 3.5 l-6 3.5 z" fill="${a}"/>`
                : `<circle cx="11" cy="${c}" r="3" fill="none" stroke="${LINE}" stroke-width="1.5"/>`
          return `${mark}<rect x="20" y="${y}" width="${[70, 54, 62, 48][i]}" height="5" rx="2.5" fill="${LINE}" fill-opacity="${i < 2 ? 0.45 : 0.85}"/>`
        })
        .join(''))
    case 'steps-off':
      return pic(112, 68, `<rect x="8" y="22" width="60" height="5" rx="2.5" fill="${LINE}"/><rect x="8" y="34" width="40" height="5" rx="2.5" fill="${LINE}" fill-opacity=".5"/><rect x="8" y="46" width="96" height="4" rx="2" fill="${a}"/>`)
  }
}

/** A clock face whose arc shows the wait: 0 s, 15 s or a minute. */
export function clockSvg(seconds: number, accent: Accent): string {
  const a = ACCENTS[accent].from
  if (seconds === 0)
    return pic(56, 56, `<circle cx="28" cy="28" r="22" fill="${FAINT}" stroke="${LINE}" stroke-width="2"/><path d="M30 12 L20 31 H28 L25 44 L37 24 H29 Z" fill="${a}"/>`)
  const frac = Math.min(1, seconds / 60)
  const ang = frac * 2 * Math.PI - 1e-4
  const x = 28 + 20 * Math.sin(ang)
  const y = 28 - 20 * Math.cos(ang)
  const arc = frac >= 1 ? `<circle cx="28" cy="28" r="20" fill="${a}" fill-opacity=".35"/>` : `<path d="M28 28 L28 8 A20 20 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)} Z" fill="${a}" fill-opacity=".55"/>`
  return pic(56, 56, `<circle cx="28" cy="28" r="22" fill="${FAINT}" stroke="${LINE}" stroke-width="2"/>${arc}<line x1="28" y1="28" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${a}" stroke-width="2.5" stroke-linecap="round"/><circle cx="28" cy="28" r="2.5" fill="${a}"/>`)
}

/** A bell, ringing or crossed out. */
export function bellSvg(isOn: boolean, accent: Accent): string {
  const a = ACCENTS[accent].from
  const bell = `<path d="M28 10c-7 0-12 5.5-12 12.5V31l-4 6h32l-4-6v-8.5C40 15.5 35 10 28 10z" fill="${isOn ? a : FAINT}" stroke="${LINE}" stroke-width="1.5"/><circle cx="28" cy="42" r="3.5" fill="${isOn ? a : LINE}"/>`
  return isOn
    ? pic(56, 56, `<g class="ring">${bell}</g><path d="M9 16q-4 6 0 12M47 16q4 6 0 12" fill="none" stroke="${a}" stroke-width="2" stroke-linecap="round"/>`, `.ring{transform-origin:28px 10px;animation:ring 2.4s ease-in-out infinite}@keyframes ring{0%,70%,100%{transform:rotate(0)}75%{transform:rotate(12deg)}85%{transform:rotate(-10deg)}92%{transform:rotate(5deg)}}`)
    : pic(56, 56, `${bell}<line x1="12" y1="46" x2="44" y2="12" stroke="${LINE}" stroke-width="2.5" stroke-linecap="round"/>`)
}

/** On/off: auto shows only while work runs; always stays; off is dark. */
export function powerSvg(kind: 'auto' | 'always' | 'off', accent: Accent): string {
  const a = ACCENTS[accent].from
  const sym = (c: string) => `<path d="M28 12v14" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/><path d="M19 17a14 14 0 1 0 18 0" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`
  if (kind === 'off') return pic(56, 56, `<circle cx="28" cy="28" r="25" fill="${FAINT}"/>${sym(LINE)}`)
  if (kind === 'always') return pic(56, 56, `<circle cx="28" cy="28" r="25" fill="${a}" fill-opacity=".25" stroke="${a}" stroke-width="2"/>${sym(a)}`)
  return pic(
    56,
    56,
    `<circle class="breathe" cx="28" cy="28" r="25" fill="${a}" fill-opacity=".18" stroke="${a}" stroke-width="2" stroke-dasharray="5 4"/>${sym(a)}<text x="44" y="51" font-size="11" font-weight="700" font-family="system-ui" fill="${a}">A</text>`,
    `.breathe{transform-origin:28px 28px;animation:br 2s ease-in-out infinite}@keyframes br{50%{transform:scale(.92);opacity:.6}}`,
  )
}

/** Timer pictures, painted in the chosen colour so they belong to the look. */
export function timerSvg(kind: 'hour' | 'morning' | 'task' | 'sun' | 'custom', accent: Accent): string {
  const c = ACCENTS[accent]
  const g = `<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent === 'rgb' ? '#FF3B6B' : c.from}"/><stop offset="1" stop-color="${accent === 'rgb' ? '#3B82F6' : c.to}"/></linearGradient></defs>`
  const disc = `<circle cx="28" cy="28" r="25" fill="${FAINT}"/>`
  switch (kind) {
    case 'hour':
      return pic(56, 56, `${g}${disc}<path d="M34 12a17 17 0 1 0 10 27a14 14 0 1 1-10-27z" fill="url(#t)"/><text x="20" y="33" font-size="11" font-weight="700" font-family="system-ui" fill="#fff">1h</text>`)
    case 'morning':
      return pic(56, 56, `${g}${disc}<path d="M10 36h36" stroke="${LINE}" stroke-width="2.5" stroke-linecap="round"/><path d="M17 36a11 11 0 0 1 22 0z" fill="url(#t)"/>${[0, 1, 2, 3, 4]
        .map(i => {
          const ang = Math.PI * (1 + i / 4)
          return `<line x1="${(28 + 14 * Math.cos(ang)).toFixed(1)}" y1="${(36 + 14 * Math.sin(ang)).toFixed(1)}" x2="${(28 + 18 * Math.cos(ang)).toFixed(1)}" y2="${(36 + 18 * Math.sin(ang)).toFixed(1)}" stroke="url(#t)" stroke-width="2.5" stroke-linecap="round"/>`
        })
        .join('')}<text x="18" y="48" font-size="8" font-weight="700" font-family="system-ui" fill="${LINE}">08:00</text>`)
    case 'task':
      return pic(56, 56, `${g}${disc}<line x1="19" y1="12" x2="19" y2="45" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/><path d="M20 13h20l-5 7 5 7H20z" fill="url(#t)"/><rect x="24" y="13" width="5" height="4.6" fill="#fff" fill-opacity=".85"/><rect x="34" y="13" width="5" height="4.6" fill="#fff" fill-opacity=".85"/><rect x="29" y="17.6" width="5" height="4.6" fill="#fff" fill-opacity=".85"/><rect x="24" y="22.2" width="5" height="4.6" fill="#fff" fill-opacity=".85"/>`)
    case 'sun':
      return pic(56, 56, `${g}${disc}<circle cx="28" cy="28" r="9" fill="url(#t)"/>${Array.from({ length: 8 }, (_, i) => {
        const ang = (i / 8) * 2 * Math.PI
        return `<line x1="${(28 + 13 * Math.cos(ang)).toFixed(1)}" y1="${(28 + 13 * Math.sin(ang)).toFixed(1)}" x2="${(28 + 18 * Math.cos(ang)).toFixed(1)}" y2="${(28 + 18 * Math.sin(ang)).toFixed(1)}" stroke="url(#t)" stroke-width="2.5" stroke-linecap="round"/>`
      }).join('')}`)
    case 'custom':
      return pic(56, 56, `${g}${disc}<circle cx="28" cy="28" r="15" fill="none" stroke="url(#t)" stroke-width="3"/><path d="M28 19v9l6 4" fill="none" stroke="url(#t)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="42" cy="40" r="7" fill="url(#t)"/><path d="M39 40h6M42 37v6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`)
  }
}
