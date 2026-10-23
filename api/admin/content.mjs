import { handleApi } from '../../lib/api.mjs';

// GET/PUT /api/admin/content — editable page copy and FAQs.
export default {
  fetch: (request) => handleApi(request),
};
