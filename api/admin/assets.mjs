import { handleApi } from '../../lib/api.mjs';

// POST /api/admin/assets — authenticated image upload to Supabase Storage.
export default {
  fetch: (request) => handleApi(request),
};
