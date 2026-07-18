import { describe, expect, it } from 'vitest'

import { parsePingRequest, SYSTEM_PING_CHANNEL } from '@shared/system-contract'

describe('system ping contract', () => {
  it('accepts a bounded nonce', () => {
    expect(parsePingRequest({ nonce: 'renderer-startup' })).toEqual({
      nonce: 'renderer-startup'
    })
    expect(SYSTEM_PING_CHANNEL).toBe('system:ping')
  })

  it.each([{}, { nonce: '' }, { nonce: 'x'.repeat(65) }, { nonce: 42 }, null])(
    'rejects invalid input: %j',
    (input) => {
      expect(() => parsePingRequest(input)).toThrow('INVALID_IPC_REQUEST')
    }
  )
})
