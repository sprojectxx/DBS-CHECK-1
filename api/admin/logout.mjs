import { handleApi } from '../../lib/api.mjs';

// POST /api/admin/logout — revoke the Supabase session.
export default {
  fetch: (request) => handleApi(request),
};
