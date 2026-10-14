import { Value } from 'ox'

import * as Method from '../Method.js'
import * as z from '../zod.js'
import * as Address from './Address.js'

/** Number of decimals in one XNO (1 XNO = 10^30 raw). */
export const decimals = 30

/**
 * Nano charge intent for one-time payments settled by a confirmed send block.
 *
 * The request `amount` is given in XNO (e.g. `"0.001"`) and is serialized in
 * raw. The credential is the hash of a send block the client already published.
 *
 * @see https://github.com/tempoxyz/mpp-specs/pull/377
 */
export const charge = Method.from({
  name: 'nano',
  intent: 'charge',
  schema: {
    credential: {
      payload: z.object({
        hash: z.string().check(z.regex(/^[0-9a-fA-F]{64}$/, 'Invalid block hash')),
        type: z.literal('hash'),
      }),
    },
    request: z.pipe(
      z.object({
        amount: z.string().check(
          z.regex(/^\d+(\.\d{1,30})?$/, 'Invalid amount'),
          z.refine((amount) => Value.from(amount, decimals) > 0n, 'Amount must be positive'),
        ),
        binding: z.optional(z.enum(['address', 'amount'])),
        description: z.optional(z.string()),
        externalId: z.optional(z.string()),
        network: z.optional(z.string()),
        recipient: z.string().check(z.refine(Address.validate, 'Invalid Nano address')),
      }),
      z.transform(
        ({ amount, binding = 'address', network = 'nano:mainnet', recipient, ...rest }) => ({
          ...rest,
          amount: Value.from(amount, decimals).toString(),
          currency: 'XNO' as const,
          methodDetails: { binding, network },
          recipient: Address.normalize(recipient),
        }),
      ),
    ),
  },
})
