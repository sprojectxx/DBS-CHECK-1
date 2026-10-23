import { handleApi } from '../lib/api.mjs';

// GET /api/content — published page copy and FAQs.
export default {
  fetch: (request) => handleApi(request),
};
