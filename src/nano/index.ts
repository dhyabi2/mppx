import { blake2b } from '@noble/hashes/blake2b'
import { Bytes, Hex, Value } from 'ox'

import * as Method from '../Method.js'
import * as z from '../zod.js'

// The address codec and method definition share this module (beside `client/`
// and `server/`) to keep the number of published files small.

/** Nano's base32 alphabet. */
const alphabet = '13456789abcdefghijkmnopqrstuwxyz'

/** Matches a `nano_` or legacy `xrb_` account address. */
const pattern = /^(?:nano|xrb)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/

/**
 * Decodes a Nano account address to its 32-byte public key as 64 uppercase
 * hexadecimal characters.
 *
 * Accepts the `nano_` and legacy `xrb_` prefixes and verifies the 40-bit
 * BLAKE2b checksum.
 *
 * @example
 * ```ts
 * import { Address } from 'mppx/nano'
 *
 * Address.toPublicKey('nano_36kmuzhss55gmjo9gc4c134gykk16k44jxzqk5kh5r4917gybfh3f7enradc')
 * // '9253DFDF9C8C6E9C6A77284A0044EF4A40248428F7F790E4F1E047015DE4B5E1'
 * ```
 */
function toPublicKey(address: string): string {
  if (!pattern.test(address)) throw new Error(`Invalid Nano address: ${address}`)
  const encoded = address.slice(address.indexOf('_') + 1)
  const publicKey = decode(encoded.slice(0, 52))
  const checksum = decode(encoded.slice(52))
  const bytes = Bytes.fromHex(`0x${publicKey.toString(16).padStart(64, '0')}`)
  if (checksum !== checksumOf(bytes)) throw new Error(`Invalid Nano address checksum: ${address}`)
  return Hex.fromBytes(bytes).slice(2).toUpperCase()
}

/**
 * Encodes a 32-byte public key (64 hexadecimal characters) as a `nano_` account address.
 *
 * @example
 * ```ts
 * import { Address } from 'mppx/nano'
 *
 * Address.fromPublicKey('9253DFDF9C8C6E9C6A77284A0044EF4A40248428F7F790E4F1E047015DE4B5E1')
 * // 'nano_36kmuzhss55gmjo9gc4c134gykk16k44jxzqk5kh5r4917gybfh3f7enradc'
 * ```
 */
function fromPublicKey(publicKey: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) throw new Error(`Invalid Nano public key: ${publicKey}`)
  const bytes = Bytes.fromHex(`0x${publicKey}`)
  return `nano_${encode(BigInt(`0x${publicKey}`), 52)}${encode(checksumOf(bytes), 8)}`
}

/** Returns `true` when `address` is a well-formed Nano address with a valid checksum. */
function validate(address: string): boolean {
  try {
    toPublicKey(address)
    return true
  } catch {
    return false
  }
}

/** Returns `true` when both addresses name the same account, regardless of prefix. */
function isEqual(a: string, b: string): boolean {
  try {
    return toPublicKey(a) === toPublicKey(b)
  } catch {
    return false
  }
}

/** Returns the canonical `nano_` form of a `nano_` or `xrb_` address. */
function normalize(address: string): string {
  return fromPublicKey(toPublicKey(address))
}

/** BLAKE2b-40 digest of the public key, read with its byte order reversed. */
function checksumOf(publicKey: Uint8Array): bigint {
  const digest = blake2b(publicKey, { dkLen: 5 }).reverse()
  return BigInt(Hex.fromBytes(digest))
}

function decode(value: string): bigint {
  let result = 0n
  for (const char of value) result = (result << 5n) | BigInt(alphabet.indexOf(char))
  return result
}

function encode(value: bigint, length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result = alphabet[Number(value & 31n)] + result
    value >>= 5n
  }
  return result
}

/** Number of decimals in one XNO (1 XNO = 10^30 raw). */
const decimals = 30

/**
 * Nano charge intent for one-time payments settled by a confirmed send block.
 *
 * The request `amount` is given in XNO (e.g. `"0.001"`) and is serialized in
 * raw. The credential is the hash of a send block the client already published.
 *
 * @see https://github.com/tempoxyz/mpp-specs/pull/377
 */
const charge = Method.from({
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
        recipient: z.string().check(z.refine(validate, 'Invalid Nano address')),
      }),
      z.transform(
        ({ amount, binding = 'address', network = 'nano:mainnet', recipient, ...rest }) => ({
          ...rest,
          amount: Value.from(amount, decimals).toString(),
          currency: 'XNO' as const,
          methodDetails: { binding, network },
          recipient: normalize(recipient),
        }),
      ),
    ),
  },
})

/** Checksummed `nano_` / `xrb_` account address helpers. */
export const Address = { fromPublicKey, isEqual, normalize, toPublicKey, validate }

/** Nano method definitions. */
export const Methods = { charge, decimals }
