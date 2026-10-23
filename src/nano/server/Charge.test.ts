import { Challenge, Credential, Receipt, Store } from 'mppx'
import { Mppx as ClientMppx } from 'mppx/client'
import * as nano_client from 'mppx/nano/client'
import * as nano from 'mppx/nano/server'
import { Mppx } from 'mppx/server'
import { describe, expect, test, vi } from 'vp/test'

const realm = 'api.example.com'
const secretKey = 'test-secret-key-test-secret-key-32'
const rpcUrl = 'http://nano.test/rpc'

const recipient = 'nano_36kmuzhss55gmjo9gc4c134gykk16k44jxzqk5kh5r4917gybfh3f7enradc'
const payer = 'nano_3c8gam3sqzueg78i6qpmrcbxhpkrazgrdspib3634b8ekcqde44xn8n36wdw'
const other = 'nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3'
const hash = 'AF76DB116540806369252C2FEF3E4368B0180DBB61450DD83041A985AB66802F'
// 0.001 XNO
const raw = '1000000000000000000000000000'

function blockInfo(overrides: Record<string, unknown> = {}) {
  const { contents, ...rest } = overrides
  return {
    amount: raw,
    block_account: payer,
    confirmed: 'true',
    contents: {
      type: 'state',
      account: payer,
      link: '9253DFDF9C8C6E9C6A77284A0044EF4A40248428F7F790E4F1E047015DE4B5E1',
      link_as_account: recipient,
      ...(contents as Record<string, unknown> | undefined),
    },
    subtype: 'send',
    ...rest,
  }
}

function createRpc(response: () => unknown | Promise<unknown>) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const body = await response()
    return body instanceof Response ? body : Response.json(body)
  })
}

function createServer(
  fetch: typeof globalThis.fetch,
  options: Partial<nano.charge.Parameters> = {},
) {
  return Mppx.create({
    methods: [nano.charge({ fetch, rpcUrl, ...options })],
    realm,
    secretKey,
  })
}

async function pay(
  route: (request: Request) => Promise<any>,
  blockHash: string = hash,
  source?: string,
) {
  const first = await route(new Request('https://example.com/resource'))
  expect(first.status).toBe(402)
  const challenge = Challenge.fromResponse(first.challenge)
  const credential = Credential.from({
    challenge,
    payload: { hash: blockHash, type: 'hash' },
    ...(source ? { source } : {}),
  })
  return route(
    new Request('https://example.com/resource', {
      headers: { Authorization: Credential.serialize(credential) },
    }),
  )
}

describe('nano.charge', () => {
  test('issues a challenge in raw with the method details', async () => {
    const fetch = createRpc(() => blockInfo())
    const mppx = createServer(fetch)

    const result = await mppx.nano.charge({ amount: '0.001', recipient })(
      new Request('https://example.com/resource'),
    )

    expect(result.status).toBe(402)
    if (result.status !== 402) throw new Error()
    const challenge = Challenge.fromResponse(result.challenge)
    expect(challenge.method).toBe('nano')
    expect(challenge.intent).toBe('charge')
    expect(challenge.request).toEqual({
      amount: raw,
      currency: 'XNO',
      methodDetails: { binding: 'address', network: 'nano:mainnet' },
      recipient,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('accepts a confirmed send and returns the block hash as the receipt reference', async () => {
    const fetch = createRpc(() => blockInfo())
    const mppx = createServer(fetch)

    const result = await pay(mppx.nano.charge({ amount: '0.001', recipient }))

    expect(result.status).toBe(200)
    if (result.status !== 200) throw new Error()
    const receipt = Receipt.fromResponse(result.withReceipt(new Response('OK')))
    expect(receipt).toMatchObject({ method: 'nano', reference: hash, status: 'success' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(rpcUrl)
    expect(JSON.parse(init!.body as string)).toEqual({
      action: 'block_info',
      hash,
      json_block: 'true',
    })
  })

  test('accepts an overpayment and a legacy xrb_ recipient in address binding', async () => {
    const fetch = createRpc(() =>
      blockInfo({
        amount: `${raw}0`,
        contents: { link_as_account: recipient.replace('nano_', 'xrb_') },
      }),
    )
    const mppx = createServer(fetch)

    const result = await pay(mppx.nano.charge({ amount: '0.001', recipient }))

    expect(result.status).toBe(200)
  })

  test('rejects an unconfirmed block without consuming its hash', async () => {
    let confirmed = 'false'
    const fetch = createRpc(() => blockInfo({ confirmed }))
    const mppx = createServer(fetch)
    const route = mppx.nano.charge({ amount: '0.001', recipient })

    const rejected = await pay(route)
    expect(rejected.status).toBe(402)
    await expect(rejected.challenge.json()).resolves.toMatchObject({
      detail: expect.stringContaining('not confirmed'),
      type: 'https://paymentauth.org/problems/verification-failed',
    })

    confirmed = 'true'
    const accepted = await pay(route)
    expect(accepted.status).toBe(200)
  })

  test('rejects a block that is not a send', async () => {
    const fetch = createRpc(() => blockInfo({ subtype: 'receive' }))
    const mppx = createServer(fetch)

    const result = await pay(mppx.nano.charge({ amount: '0.001', recipient }))

    expect(result.status).toBe(402)
    await expect(result.challenge.json()).resolves.toMatchObject({
      detail: expect.stringContaining('not a send block'),
      type: 'https://paymentauth.org/problems/verification-failed',
    })
  })

  test('rejects a send to another account', async () => {
    const fetch = createRpc(() => blockInfo({ contents: { link_as_account: other } }))
    const mppx = createServer(fetch)

    const result = await pay(mppx.nano.charge({ amount: '0.001', recipient }))

    expect(result.status).toBe(402)
    await expect(result.challenge.json()).resolves.toMatchObject({
      detail: expect.stringContaining('recipient mismatch'),
      type: 'https://paymentauth.org/problems/verification-failed',
    })
  })

  test('rejects an underpayment', async () => {
    const fetch = createRpc(() => blockInfo({ amount: (BigInt(raw) - 1n).toString() }))
    const mppx = createServer(fetch)

    const result = await pay(mppx.nano.charge({ amount: '0.001', recipient }))

    expect(result.status).toBe(402)
    await expect(result.challenge.json()).resolves.toMatchObject({
      type: 'https://paymentauth.org/problems/payment-insufficient',
    })
  })

  test('requires the exact amount in amount binding', async () => {
    const amount = '0.001000000000000000000000000123'
    const exact = '1000000000000000000000000123'
    let sent = `${exact}0`
    const fetch = createRpc(() => blockInfo({ amount: sent }))
    const mppx = createServer(fetch, { binding: 'amount' })
    const route = mppx.nano.charge({ amount, recipient })

    const overpaid = await pay(route)
    expect(overpaid.status).toBe(402)
    await expect(overpaid.challenge.json()).resolves.toMatchObject({
      detail: expect.stringContaining('amount mismatch'),
    })

    sent = exact
    const accepted = await pay(route)
    expect(accepted.status).toBe(200)
  })

  test('accepts each block hash once, in any casing', async () => {
    const fetch = createRpc(() => blockInfo())
    const mppx = createServer(fetch)
    const route = mppx.nano.charge({ amount: '0.001', recipient })

    expect((await pay(route)).status).toBe(200)

    const replayed = await pay(route, hash.toLowerCase())
    expect(replayed.status).toBe(402)
    // A spent hash is answered with a final 403 and no new challenge.
    expect(replayed.challenge.status).toBe(403)
    expect(replayed.challenge.headers.has('WWW-Authenticate')).toBe(false)
    await expect(replayed.challenge.json()).resolves.toMatchObject({
      detail: expect.stringContaining('Block hash has already been used'),
      type: 'https://paymentauth.org/problems/verification-failed',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('exposes the debited account as the payer on payment success', async () => {
    const payers: (string | undefined)[] = []
    const fetch = createRpc(() => blockInfo({ block_account: payer.replace('nano_', 'xrb_') }))
    const mppx = createServer(fetch, { onPaymentSuccess: ({ payer }) => void payers.push(payer) })

    expect((await pay(mppx.nano.charge({ amount: '0.001', recipient }))).status).toBe(200)
    expect(payers).toEqual([payer])
  })

  test('shares consumed hashes through the store', async () => {
    const store = Store.memory()
    const fetch = createRpc(() => blockInfo())
    const first = createServer(fetch, { store })
    const second = createServer(fetch, { store })

    expect((await pay(first.nano.charge({ amount: '0.001', recipient }))).status).toBe(200)
    const replayed = await pay(second.nano.charge({ amount: '0.001', recipient }))
    expect(replayed.status).toBe(402)
    if (replayed.status !== 402) throw new Error()
    expect(replayed.challenge.status).toBe(403)
  })

  test.each([
    { name: 'HTTP error', response: () => new Response('down', { status: 503 }) },
    { name: 'network error', response: () => Promise.reject(new Error('ECONNREFUSED')) },
    { name: 'node error', response: () => ({ error: 'Block not found' }) },
    { name: 'malformed body', response: () => new Response('null') },
  ])('rejects on RPC failure ($name)', async ({ response }) => {
    const fetch = createRpc(response)
    const mppx = createServer(fetch)

    const result = await pay(mppx.nano.charge({ amount: '0.001', recipient }))

    expect(result.status).toBe(402)
    await expect(result.challenge.json()).resolves.toMatchObject({
      type: 'https://paymentauth.org/problems/verification-failed',
    })
  })

  test('checks the payer named by the credential source', async () => {
    const fetch = createRpc(() => blockInfo())
    const mppx = createServer(fetch)
    const route = mppx.nano.charge({ amount: '0.001', recipient })

    const mismatched = await pay(route, hash, `did:pkh:nano:mainnet:${other}`)
    expect(mismatched.status).toBe(402)

    const matched = await pay(route, hash, `did:pkh:nano:mainnet:${payer}`)
    expect(matched.status).toBe(200)
  })

  test('rejects a malformed block hash before calling the node', async () => {
    const fetch = createRpc(() => blockInfo())
    const mppx = createServer(fetch)

    const result = await pay(mppx.nano.charge({ amount: '0.001', recipient }), 'abc')

    expect(result.status).toBe(402)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('refuses to issue a challenge for a recipient with a bad checksum', () => {
    const fetch = createRpc(() => blockInfo())
    const mppx = createServer(fetch)
    const badRecipient = `${recipient.slice(0, -1)}d`

    expect(() => mppx.nano.charge({ amount: '0.001', recipient: badRecipient })).toThrow(
      'Invalid Nano address',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  test('pays end to end with the client method', async () => {
    const fetch = createRpc(() => blockInfo())
    const mppx = createServer(fetch)
    const route = mppx.nano.charge({ amount: '0.001', recipient })
    const send = vi.fn(async () => hash.toLowerCase())
    const client = ClientMppx.create({
      methods: [nano_client.charge({ send })],
      polyfill: false,
    })

    const first = await route(new Request('https://example.com/resource'))
    if (first.status !== 402) throw new Error()
    const authorization = await client.createCredential(first.challenge)

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: raw,
        binding: 'address',
        network: 'nano:mainnet',
        recipient,
      }),
    )
    expect(Credential.deserialize(authorization).payload).toEqual({ hash, type: 'hash' })

    const result = await route(
      new Request('https://example.com/resource', { headers: { Authorization: authorization } }),
    )
    expect(result.status).toBe(200)
  })
})
