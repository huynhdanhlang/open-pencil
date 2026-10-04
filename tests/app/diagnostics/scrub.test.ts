import { describe, expect, test } from 'bun:test'

import { scrubDiagnosticText } from '@/app/diagnostics/scrub'

// Fake credentials are assembled from parts so that no complete key appears in the source,
// which secret scanners would flag.
const fake = {
  aws: ['AKIA', 'QYLPMN5HHHFPZAM2'].join(''),
  github: ['ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join(''),
  slack: ['xoxb', '1234567890', '0987654321', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-'),
  openai: ['sk', 'proj', 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1HgFeDcBa0'].join('-'),
  anthropic: ['sk', 'ant', 'api03', 'A'.repeat(93)].join('-'),
  stripe: ['sk', 'live', '51H8xYzAbCdEfGhIjKlMn'].join('_'),
  jwt: [
    'eyJhbGciOiJIUzI1NiJ9',
    'eyJzdWIiOiJqYW5lQGV4YW1wbGUuY29tIn0',
    'dozjgNryP4J3jVmNHl0w5N'
  ].join('.'),
  privateKey: [pemMarker('BEGIN'), 'MIIEpAIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM', pemMarker('END')].join(
    '\n'
  )
}

function pemMarker(edge: 'BEGIN' | 'END'): string {
  return ['-----', edge, ' RSA PRIVATE', ' KEY-----'].join('')
}

describe('scrubDiagnosticText', () => {
  test.each(Object.entries(fake))('redacts a %s credential', (_kind, secret) => {
    const scrubbed = scrubDiagnosticText(`Request failed with ${secret} attached`)
    expect(scrubbed).not.toContain(secret)
    expect(scrubbed).toStartWith('Request failed with ')
    expect(scrubbed).toEndWith(' attached')
  })

  test.each([
    [
      'a URL query and fragment',
      'fetch https://api.example.com/v1/chat?key=abc123&doc=Secret%20Plan#part failed',
      'fetch https://api.example.com/v1/chat failed'
    ],
    [
      'a query on a bare path, keeping ordinary question marks',
      'Failed to load /Designs/app.fig?token=abc123. Retry? Maybe',
      'Failed to load /Designs/app.fig Retry? Maybe'
    ],
    [
      'credentials in a URL',
      'GET https://admin:hunter2@example.com/x',
      'GET https://[redacted]@example.com/x'
    ],
    ['a bearer token', 'Authorization: Bearer abc.def', 'Authorization: Bearer [redacted]'],
    ['an email address', 'No account for jane.doe@example.com.', 'No account for [redacted].'],
    [
      'the user name in home folders',
      'at file:///Users/jane/app/x.ts:1:1 and C:\\Users\\jane\\app\\y.ts:2:2 and /home/jane/z.ts',
      'at file:///Users/~/app/x.ts:1:1 and C:\\Users\\~\\app\\y.ts:2:2 and /home/~/z.ts'
    ]
  ])('removes %s', (_case, text, scrubbed) => {
    expect(scrubDiagnosticText(text)).toBe(scrubbed)
  })

  test('keeps code locations, package versions, and Safari stack frames', () => {
    const stack = [
      'TypeError: stops.map is not a function',
      '    at gradient (http://localhost:1420/packages/design-jsx/src/paints.ts:69:20)',
      '    at node_modules/.bun/vue@3.5.41/node_modules/vue/dist/vue.js:12:3',
      'merge@http://localhost:1420/src/app/ai/chat/stream.ts:12:4'
    ].join('\n')
    expect(scrubDiagnosticText(stack)).toBe(stack)
  })
})
