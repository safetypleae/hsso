import { cleanupPhotos } from '../server/risk-photos.js';
export default { async scheduled(_event, env) { await cleanupPhotos(env); } };
