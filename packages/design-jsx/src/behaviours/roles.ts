import type { BehaviourKind } from '@open-pencil/scene-graph'

/** What a Reka UI element is to the component it builds. */
export type RekaRole =
  | { role: 'root'; kind: BehaviourKind }
  /** A Reka subcomponent drawn by a slot of the component, such as a switch's thumb. */
  | { role: 'part'; part: string }
  /** One of a slot's repeated parts, such as a tab trigger in the tab list. */
  | { role: 'repeat'; container: string }
  /** The text layer a text value shows, which becomes the field's text property. */
  | { role: 'input'; valueId: string }
  /** A Reka wrapper with no state of its own, drawn as a plain frame. */
  | { role: 'frame' }

const root = (kind: BehaviourKind): RekaRole => ({ role: 'root', kind })
const part = (id: string): RekaRole => ({ role: 'part', part: id })
const repeat = (container: string): RekaRole => ({ role: 'repeat', container })
const input = (valueId: string): RekaRole => ({ role: 'input', valueId })

/**
 * Design JSX's Reka UI elements, by namespace and part, after Reka's own anatomy: `Switch.Root`
 * is a main component that behaves as a switch and `Switch.Thumb` its thumb slot. A group's
 * `Item` is the component of its items when written on its own, and an item when it names one
 * with `of`, as an `Instance` does.
 */
const REKA_PARTS = {
  Button: { Root: root('button') },
  Toggle: { Root: root('toggle') },
  Switch: { Root: root('switch'), Thumb: part('thumb') },
  Checkbox: { Root: root('checkbox'), Indicator: part('indicator') },
  RadioGroup: { Root: root('radioGroup'), Item: root('radio'), Indicator: part('indicator') },
  ToggleGroup: { Root: root('toggleGroup'), Item: root('toggle') },
  Slider: {
    Root: root('slider'),
    Track: part('track'),
    Range: part('range'),
    Thumb: part('thumb')
  },
  Progress: { Root: root('progress'), Indicator: part('indicator') },
  Tabs: {
    Root: root('tabs'),
    List: part('list'),
    Trigger: repeat('list'),
    Content: repeat('panels')
  },
  Collapsible: { Root: root('collapsible'), Trigger: part('trigger'), Content: part('content') },
  Accordion: {
    Root: root('accordion'),
    Item: root('collapsible'),
    Header: { role: 'frame' },
    Trigger: part('trigger'),
    Content: part('content')
  },
  NumberField: {
    Root: root('numberField'),
    Input: input('text'),
    Increment: part('increment'),
    Decrement: part('decrement')
  },
  TextField: { Root: root('textField'), Input: input('value') },
  Textarea: { Root: root('textarea'), Input: input('value') }
} as const satisfies Readonly<Record<string, Readonly<Record<string, RekaRole>>>>

/** Each Reka namespace and its parts, as typed elements are built from them. */
export type RekaNamespaces = typeof REKA_PARTS

/** The same elements, looked up by any element name, as parsing and export do. */
export const REKA_ELEMENTS: Readonly<Record<string, Readonly<Record<string, RekaRole>>>> =
  REKA_PARTS

/** The role of a Reka element type such as `Switch.Thumb`, or undefined for other elements. */
export function rekaRole(type: string): RekaRole | undefined {
  const dot = type.indexOf('.')
  if (dot === -1) return undefined
  const namespace = REKA_ELEMENTS[type.slice(0, dot)] as Record<string, RekaRole> | undefined
  return namespace?.[type.slice(dot + 1)]
}
