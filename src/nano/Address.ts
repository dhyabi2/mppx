import { blake2b } from '@noble/hashes/blake2b'
import { Bytes, Hex } from 'ox'

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
export function toPublicKey(address: string): string {
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
export function fromPublicKey(publicKey: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) throw new Error(`Invalid Nano public key: ${publicKey}`)
  const bytes = Bytes.fromHex(`0x${publicKey}`)
  return `nano_${encode(BigInt(`0x${publicKey}`), 52)}${encode(checksumOf(bytes), 8)}`
}

/** Returns `true` when `address` is a well-formed Nano address with a valid checksum. */
export function validate(address: string): boolean {
  try {
    toPublicKey(address)
    return true
  } catch {
    return false
  }
}

/** Returns `true` when both addresses name the same account, regardless of prefix. */
export function isEqual(a: string, b: string): boolean {
  try {
    return toPublicKey(a) === toPublicKey(b)
  } catch {
    return false
  }
}

/** Returns the canonical `nano_` form of a `nano_` or `xrb_` address. */
export function normalize(address: string): string {
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
