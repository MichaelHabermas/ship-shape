// OAuth client-secret helpers hash and verify shown-once app secrets.
import argon2 from 'argon2';

const DUMMY_CLIENT_SECRET_HASH = '$argon2id$v=19$m=65536,t=3,p=4$5ZMmBwgrigRa45u5D7QfsA$qofkqvyQA06xnWerY2JWhy+c/5vAKbgaK/eBIc/owpA';

export async function hashOAuthClientSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id });
}

export async function verifyOAuthClientSecret(hash: string, secret: string): Promise<boolean> {
  return verifyOAuthClientSecretWithVerifier(hash, secret, (candidateHash, candidateSecret) =>
    argon2.verify(candidateHash, candidateSecret)
  );
}

export async function verifyOAuthClientSecretWithVerifier(
  hash: string,
  secret: string,
  verify: (hash: string, secret: string) => Promise<boolean>
): Promise<boolean> {
  try {
    return await verify(hash, secret);
  } catch {
    await verify(DUMMY_CLIENT_SECRET_HASH, secret).catch(() => false);
    return false;
  }
}
