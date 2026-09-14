import { requestEmailCode } from '../../../server/email-verification.js';

export async function onRequest(context) {
  return requestEmailCode(context);
}
