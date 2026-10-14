import {
  InvalidChallengeError,
  PaymentInsufficientError,
  VerificationFailedError,
} from '../../Errors.js'
import * as Expires from '../../Expires.js'
import type { ConfiguredDefaults, LooseOmit } from '../../internal/types.js'
import * as Method from '../../Method.js'
import * as Receipt from '../../Receipt.js'
import * as Store from '../../Store.js'
import type * as z from '../../zod.js'
import * as Address from '../Address.js'
import * as Methods from '../Methods.js'

/**
 * Creates a Nano charge method intent for usage on the server.
 *
 * Verifies the send block named by the credential with a single `block_info`
 * call to a Nano node: the block must be a confirmed `send` to the challenged
 * recipient for at least the challenged amount (exactly the amount with
 * `binding: 'amount'`). Each block hash is accepted once.
 *
 * A Nano block has no memo, so a payment is tied to a challenge only by what
 * the challenge asks for. Use a fresh `recipient` per challenge (the default
 * `binding: 'address'`), or a unique `amount` per challenge with
 * `binding: 'amount'`. The node is trusted to report confirmation, so prefer
 * a node you operate.
 *
 * @example
 * ```ts
 * import { Mppx } from 'mppx/server'
 * import * as nano from 'mppx/nano/server'
 *
 * const mppx = Mppx.create({
 *   methods: [nano.charge({ rpcUrl: 'http://localhost:7076', store })],
 * })
 *
 * const result = await mppx.nano.charge({ amount: '0.001', recipient: freshAddress })(request)
 * ```
 */
export function charge<const parameters extends charge.Parameters>(parameters: parameters) {
  const {
    amount,
    binding,
    canOffer,
    description,
    externalId,
    fetch = globalThis.fetch,
    network,
    onPaymentSuccess,
    recipient,
    rpcUrl,
  } = parameters
  const store = Store.from(
    (parameters.store ?? Store.memory()) as Store.AtomicStore<charge.StoreItemMap>,
    { keyPrefix: parameters.storeKeyPrefix ?? '' },
  )

  type Defaults = charge.DeriveDefaults<parameters>
  return Method.toServer<typeof Methods.charge, Defaults>(Methods.charge, {
    defaults: {
      amount,
      binding,
      description,
      externalId,
      network,
      recipient,
    } as unknown as Defaults,

    canOffer,
    onPaymentSuccess,
    stableBinding: chargeBinding,

    async validate({ credential }) {
      const { challenge } = credential
      const request = challenge.request
      Expires.assert(challenge.expires, challenge.id)

      const hash = credential.payload.hash.toUpperCase()
      if ((await store.get(getHashStoreKey(hash))) !== null)
        throw new InvalidChallengeError({
          id: challenge.id,
          reason: 'Block hash has already been used',
        })

      const block = await getBlock({ fetch, hash, rpcUrl })

      if (block.contents?.type !== 'state' || block.subtype !== 'send')
        throw new VerificationFailedError({ reason: 'Nano block is not a send block' })

      if (!Address.isEqual(String(block.contents.link_as_account), request.recipient))
        throw new VerificationFailedError({ reason: 'Nano send recipient mismatch' })

      if (typeof block.amount !== 'string' || !/^\d+$/.test(block.amount))
        throw new VerificationFailedError({ reason: 'Nano node returned a malformed amount' })
      const sent = BigInt(block.amount)
      const required = BigInt(request.amount)
      if (request.methodDetails.binding === 'amount' && sent !== required)
        throw new VerificationFailedError({ reason: 'Nano send amount mismatch' })
      if (sent < required)
        throw new PaymentInsufficientError({ reason: 'Nano send amount is below the charge' })

      if (block.confirmed !== 'true')
        throw new VerificationFailedError({ reason: 'Nano block is not confirmed yet' })

      const account = String(block.block_account)
      if (credential.source) {
        const prefix = `did:pkh:${request.methodDetails.network}:`
        if (
          !credential.source.startsWith(prefix) ||
          !Address.isEqual(credential.source.slice(prefix.length), account)
        )
          throw new VerificationFailedError({ reason: 'Nano send source mismatch' })
      }

      return {
        challenge,
        credential,
        details: { account, amount: block.amount, hash },
        intent: Methods.charge.intent,
        method: Methods.charge.name,
        request,
        source: credential.source,
      }
    },

    async broadcast({ credential }) {
      const { challenge } = credential
      const hash = credential.payload.hash.toUpperCase()
      // A confirmed send stays valid forever, so its hash is never released.
      if (!(await Store.tryClaim(store, getHashStoreKey(hash), Number.MAX_SAFE_INTEGER)))
        throw new InvalidChallengeError({
          id: challenge.id,
          reason: 'Block hash has already been used',
        })

      return Receipt.from({
        method: Methods.charge.name,
        reference: hash,
        status: 'success',
        timestamp: new Date().toISOString(),
        ...(challenge.request.externalId !== undefined
          ? { externalId: challenge.request.externalId }
          : {}),
      })
    },
  })
}

export declare namespace charge {
  type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.charge>, 'amount'> & {
    amount?: string | undefined
  }

  type Parameters = {
    /** Fetch implementation used for node RPC calls. Defaults to `globalThis.fetch`. */
    fetch?: typeof globalThis.fetch | undefined
    /** URL of the Nano node RPC endpoint used to look up send blocks. */
    rpcUrl: string
    /**
     * Atomic store recording consumed block hashes.
     *
     * Defaults to an in-memory store. Use a shared store in multi-instance
     * deployments so a block hash cannot be accepted by two processes.
     */
    store?: Store.AtomicStore | undefined
    /** Prefix prepended to replay-protection store keys. */
    storeKeyPrefix?: string | undefined
  } & Method.ComposableHooks<typeof Methods.charge> &
    Defaults

  /** Captures only configuration values that are known to exist at runtime. */
  type DeriveDefaults<parameters extends Parameters> = ConfiguredDefaults<parameters, Defaults>

  type StoreItemMap = {
    [key: `mppx:nano:charge:${string}`]: Store.ReplayMarker
  }
}

type ChargeRequest = z.output<typeof Methods.charge.schema.request>

/** The subset of a `block_info` response used for verification. */
type BlockInfo = {
  amount?: unknown
  block_account?: unknown
  confirmed?: unknown
  contents?: { link_as_account?: unknown; type?: unknown } | undefined
  subtype?: unknown
}

function chargeBinding(request: ChargeRequest) {
  // Exhaustively destructure so new charge request fields require an explicit binding decision.
  const { amount, currency, description, externalId, methodDetails, recipient, ...requestRest } =
    request
  requestRest satisfies Record<string, never>
  const { binding, network, ...methodDetailsRest } = methodDetails
  methodDetailsRest satisfies Record<string, never>

  return { amount, binding, currency, description, externalId, network, recipient }
}

function getHashStoreKey(hash: string): `mppx:nano:charge:${string}` {
  return `mppx:nano:charge:${hash}`
}

/** Looks up a block with the node's `block_info` RPC action. */
async function getBlock(parameters: {
  fetch: typeof globalThis.fetch
  hash: string
  rpcUrl: string
}): Promise<BlockInfo> {
  const { fetch, hash, rpcUrl } = parameters
  const body = await fetch(rpcUrl, {
    body: JSON.stringify({ action: 'block_info', hash, json_block: 'true' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as unknown
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      throw new VerificationFailedError({ reason: `Nano RPC request failed: ${detail}` })
    })
  if (typeof body !== 'object' || body === null)
    throw new VerificationFailedError({ reason: 'Nano RPC returned a malformed response' })
  if ('error' in body)
    throw new VerificationFailedError({ reason: `Nano block lookup failed: ${String(body.error)}` })
  return body as BlockInfo
}
