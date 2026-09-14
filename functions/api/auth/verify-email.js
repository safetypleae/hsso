import { verifyEmailCode } from '../../../server/email-verification.js';

export async function onRequest(context) {
  return verifyEmailCode(context);
}
