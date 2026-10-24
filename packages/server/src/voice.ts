import { AccessToken } from 'livekit-server-sdk';

// Voice is optional: without LIVEKIT_* env vars the game runs without voice and clients show a warning.
const url = process.env.LIVEKIT_URL ?? '';
const key = process.env.LIVEKIT_API_KEY ?? '';
const secret = process.env.LIVEKIT_API_SECRET ?? '';

export const voiceConfigured = () => !!(url && key && secret);

export async function createVoiceToken(room: string, identity: string, name: string): Promise<{ url: string; token: string } | null> {
  if (!voiceConfigured()) return null;
  const at = new AccessToken(key, secret, { identity, name, ttl: '4h' });
  // Audio only: no data channel, no renaming (names come from the game lobby).
  at.addGrant({ room: `psst-${room}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
  return { url, token: await at.toJwt() };
}
