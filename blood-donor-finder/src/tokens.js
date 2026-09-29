import { createHash, randomBytes } from 'node:crypto';

/** Creates a random secret for an email link. Only its hash is stored. */
export function newToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

export const newPublicId = () => randomBytes(8).toString('hex');
