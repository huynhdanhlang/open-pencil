import { isEmptyObject, isEqual, omitBy, pick } from 'es-toolkit'

import { jsx, type SyntaxNode } from '@open-pencil/emit'
import {
  hasParagraphSpacing,
  MAX_LIST_INDENTATION,
  paragraphStyleAt,
  textParagraphRanges,
  type SceneNode,
  type TextParagraphStyle
} from '@open-pencil/scene-graph'

import { SPAN_STYLE_FIELDS, type SpanStyle } from '../text-content'
import { collectFillProps } from './paint'
import { fontWeightValue } from './props'
import { propAttribute, type JSXProp } from './value'

/** A text's content as JSX children, and whether they print on the element's own line. */
export interface TextChildren {
  children: SyntaxNode[]
  inline: boolean
}

/** Whether a style can be written as `<Span>` props: auto line height and no fills cannot. */
function writable(value: SpanStyle[keyof SpanStyle], key: keyof SpanStyle): boolean {
  if (key === 'lineHeight') return value !== null
  if (key === 'fills') return Array.isArray(value) && value.length > 0
  return value !== undefined
}

/** Each character's style where it differs from the text's own, as a span writes it. */
function characterStyles(node: SceneNode): SpanStyle[] {
  const styles = Array.from({ length: node.text.length }, (): SpanStyle => ({}))
  for (const run of node.styleRuns) {
    const style = pick(run.style, SPAN_STYLE_FIELDS)
    const end = Math.min(run.start + run.length, styles.length)
    for (let index = run.start; index < end; index++) styles[index] = { ...styles[index], ...style }
  }
  return styles.map((style) =>
    omitBy(style, (value, key) => !writable(value, key) || isEqual(value, node[key]))
  )
}

function spanProps(style: SpanStyle, node: SceneNode): JSXProp[] {
  const props: JSXProp[] = []
  if (style.fontSize !== undefined) props.push(['size', style.fontSize])
  if (style.fontFamily !== undefined) props.push(['font', style.fontFamily])
  if (style.fontWeight !== undefined) props.push(['weight', fontWeightValue(style.fontWeight)])
  if (style.italic !== undefined) props.push(['italic', style.italic])
  if (style.fills) collectFillProps({ ...node, fills: style.fills }, props)
  if (style.lineHeight != null) props.push(['lineHeight', style.lineHeight])
  if (style.letterSpacing !== undefined) props.push(['letterSpacing', style.letterSpacing])
  if (style.textDecoration !== undefined)
    props.push(['textDecoration', style.textDecoration.toLowerCase()])
  return props
}

/** `text[start, end)` as text and a `<Span>` for every stretch styled apart from the text. */
function inlineContent(
  node: SceneNode,
  styles: readonly SpanStyle[],
  start: number,
  end: number
): SyntaxNode[] {
  const content: SyntaxNode[] = []
  let from = start
  for (let index = start + 1; index <= end; index++) {
    if (index < end && isEqual(styles[index], styles[from])) continue
    const text = jsx.inlineText(node.text.slice(from, index))
    const style = styles[from]
    content.push(
      isEmptyObject(style)
        ? text
        : jsx.element('Span', spanProps(style, node).map(propAttribute), [text], 0, true)
    )
    from = index
  }
  return content
}

function paragraphProps(style: TextParagraphStyle): JSXProp[] {
  const props: JSXProp[] = []
  if (style.listType !== 'NONE') {
    props.push(['list', style.listType === 'ORDERED' ? 'ordered' : 'unordered'])
    const level = Math.min(style.indentation, MAX_LIST_INDENTATION)
    if (level > 1) props.push(['level', level])
  }
  if (style.paragraphSpacing !== undefined) props.push(['spacing', style.paragraphSpacing])
  if (style.listSpacing !== undefined) props.push(['listSpacing', style.listSpacing])
  if (style.paragraphIndent !== undefined) props.push(['indent', style.paragraphIndent])
  return props
}

/**
 * A text's content as JSX children: its text alone when it is styled as a whole, with
 * `<Span>`s for characters styled apart, and as `<Paragraph>`s when a paragraph is a list item
 * or has spacing of its own.
 */
export function textChildren(node: SceneNode, depth: number): TextChildren {
  const styles = characterStyles(node)
  const ranges = textParagraphRanges(node.text)
  const paragraphs = ranges.map((_, index) => paragraphStyleAt(node.textParagraphs, index))
  const styledParagraphs = paragraphs.some(
    (style) => style.listType !== 'NONE' || hasParagraphSpacing(style)
  )
  if (!styledParagraphs) {
    if (styles.every(isEmptyObject)) {
      return { children: node.text ? [jsx.text(node.text)] : [], inline: true }
    }
    return { children: inlineContent(node, styles, 0, node.text.length), inline: true }
  }
  const children = ranges.map(({ start, end }, index) =>
    jsx.element(
      'Paragraph',
      paragraphProps(paragraphs[index]).map(propAttribute),
      inlineContent(node, styles, start, end),
      depth + 1,
      true
    )
  )
  return { children, inline: false }
}
