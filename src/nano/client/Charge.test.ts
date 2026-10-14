import { Challenge, Credential } from 'mppx'
import { Methods } from 'mppx/nano'
import * as nano from 'mppx/nano/client'
import { describe, expect, test, vi } from 'vp/test'

const recipient = 'nano_36kmuzhss55gmjo9gc4c134gykk16k44jxzqk5kh5r4917gybfh3f7enradc'
const hash = 'AF76DB116540806369252C2FEF3E4368B0180DBB61450DD83041A985AB66802F'

const challenge = Challenge.fromMethod(Methods.charge, {
  expires: new Date(Date.now() + 60_000).toISOString(),
  realm: 'api.example.com',
  request: { amount: '1.5', binding: 'amount', recipient },
  secretKey: 'test-secret-key-test-secret-key-32',
})

describe('nano.charge (client)', () => {
  test('sends the challenged raw amount and returns a hash credential', async () => {
    const send = vi.fn(async () => hash.toLowerCase())
    const method = nano.charge({ send })

    const credential = Credential.deserialize(await method.createCredential({ challenge } as never))

    expect(send).toHaveBeenCalledWith({
      amount: '1500000000000000000000000000000',
      binding: 'amount',
      challenge,
      network: 'nano:mainnet',
      recipient,
    })
    expect(credential.payload).toEqual({ hash, type: 'hash' })
    expect(credential.challenge.id).toBe(challenge.id)
  })

  test('rejects a send function that does not return a block hash', async () => {
    const method = nano.charge({ send: async () => '0xabc' })

    await expect(method.createCredential({ challenge } as never)).rejects.toThrow(
      'Invalid Nano block hash',
    )
  })
})
