// Test-only authentication boundary. The actual API handlers and file store run unchanged.
const fs = require('node:fs');
const ts = require('typescript');
const { lib } = require('./invoice-compare.cjs');
class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function loadRoute() {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('app/api/vehicle-performance-v5/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const req = name => {
    if (name === 'next/server') return require(name);
    if (name === '@/lib/admin-user-management-server') return {
      AdminApiError, createServerSupabaseAdmin: () => ({}),
      requireVerifiedUser: async request => {
        const token = request.headers.get('authorization')?.replace('Bearer ', '');
        const roles = { 'vp6-admin': 'super_admin', 'vp6-staff': 'office_staff', 'vp6-reader': 'read_only', 'vp6-suspended': 'admin' };
        if (!roles[token]) throw new AdminApiError(401, 'Authentication required.');
        return { id: token + '-fixture-user', role: roles[token], suspended: token === 'vp6-suspended' };
      },
      resolveAccountAccess: async (_, user) => ({ userId: user.id, role: user.role, status: user.suspended ? 'suspended' : 'active', displayName: 'Isolated fixture', email: 'fixture@example.test' })
    };
    if (name.startsWith('@/lib/')) return lib(name.slice('@/lib/'.length) + '.ts');
    throw Error('Unexpected test import: ' + name);
  };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
}
module.exports = { loadRoute };
