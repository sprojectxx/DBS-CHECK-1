import { handleApi } from '../../lib/api.mjs';

// POST /api/admin/login — Supabase Auth sign-in plus admin membership check.
export default {
  fetch: (request) => handleApi(request),
};
