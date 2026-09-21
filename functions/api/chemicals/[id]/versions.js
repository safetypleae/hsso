import { versions } from '../../../../server/chemicals.js';

export function onRequest(context) {
  return versions(context);
}
