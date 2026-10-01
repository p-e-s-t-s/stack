import { createHash, randomBytes } from 'node:crypto'

/** A random URL-safe token. */
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url')

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
