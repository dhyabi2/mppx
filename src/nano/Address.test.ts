import { Address } from 'mppx/nano'
import { describe, expect, test } from 'vp/test'

// Nano genesis account.
const genesis = 'nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3'
const genesisKey = 'E89208DD038FBB269987689621D52292AE9C35941A7484756ECCED92A65093BA'

describe('Address', () => {
  test('decodes an address to its public key', () => {
    expect(Address.toPublicKey(genesis)).toBe(genesisKey)
  })

  test('encodes a public key in either casing', () => {
    expect(Address.fromPublicKey(genesisKey)).toBe(genesis)
    expect(Address.fromPublicKey(genesisKey.toLowerCase())).toBe(genesis)
  })

  test('treats the legacy xrb_ prefix as the same account', () => {
    const legacy = genesis.replace('nano_', 'xrb_')
    expect(Address.validate(legacy)).toBe(true)
    expect(Address.isEqual(legacy, genesis)).toBe(true)
    expect(Address.normalize(legacy)).toBe(genesis)
  })

  test('rejects a bad checksum', () => {
    const tampered = `${genesis.slice(0, -1)}1`
    expect(Address.validate(tampered)).toBe(false)
    expect(() => Address.toPublicKey(tampered)).toThrow('Invalid Nano address checksum')
    expect(Address.isEqual(tampered, genesis)).toBe(false)
  })

  test('rejects malformed addresses', () => {
    expect(Address.validate(genesis.replace('nano_', 'ban_'))).toBe(false)
    expect(Address.validate(genesis.slice(0, -1))).toBe(false)
    expect(Address.validate(genesis.replace('3t6k', '3t6l'))).toBe(false)
    expect(Address.validate(genesis.replace('nano_3', 'nano_4'))).toBe(false)
    expect(() => Address.fromPublicKey('00')).toThrow('Invalid Nano public key')
  })
})
