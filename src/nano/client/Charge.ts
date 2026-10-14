import type * as Challenge from '../../Challenge.js'
import * as Credential from '../../Credential.js'
import * as Method from '../../Method.js'
import type * as z from '../../zod.js'
import * as Methods from '../Methods.js'

/**
 * Creates a Nano charge method intent for usage on the client.
 *
 * mppx does not hold Nano keys. The `send` callback publishes a send block for
 * the challenged amount (in raw) to the challenged recipient, with whatever
 * wallet the caller uses, and returns its block hash. Resolve it once the
 * block is confirmed, since the server refuses unconfirmed blocks.
 *
 * @example
 * ```ts
 * import * as nano from 'mppx/nano/client'
 *
 * const charge = nano.charge({
 *   async send({ amount, recipient }) {
 *     const hash = await wallet.send({ amountRaw: amount, to: recipient })
 *     await wallet.waitForConfirmation(hash)
 *     return hash
 *   },
 * })
 * ```
 */
export function charge(parameters: charge.Parameters) {
  const { send } = parameters

  return Method.toClient(Methods.charge, {
    async createCredential({ challenge }) {
      const { amount, methodDetails, recipient } = challenge.request
      const hash = await send({
        amount,
        binding: methodDetails.binding,
        challenge,
        network: methodDetails.network,
        recipient,
      })
      if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`Invalid Nano block hash: ${hash}`)

      return Credential.serialize({
        challenge,
        payload: { hash: hash.toUpperCase(), type: 'hash' },
      })
    },
  })
}

export declare namespace charge {
  type Parameters = {
    /** Publishes a send block for the challenge and returns its block hash. */
    send: (parameters: SendParameters) => Promise<string>
  }

  type SendParameters = {
    /** Amount to send, in raw (1 XNO = 10^30 raw). Send exactly this amount. */
    amount: string
    /** How the server binds the payment to the challenge (`address` or `amount`). */
    binding: string
    challenge: Challenge.Challenge<
      z.output<typeof Methods.charge.schema.request>,
      typeof Methods.charge.intent,
      typeof Methods.charge.name
    >
    /** CAIP-2 network identifier, e.g. `nano:mainnet`. */
    network: string
    /** Recipient `nano_` account address. */
    recipient: string
  }
}
