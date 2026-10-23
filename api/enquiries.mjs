import { handleApi } from '../lib/api.mjs';

// POST /api/enquiries — validated enquiry submission.
export default {
  fetch: (request) => handleApi(request),
};
