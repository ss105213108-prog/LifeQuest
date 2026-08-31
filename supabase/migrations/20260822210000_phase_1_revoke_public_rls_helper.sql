-- Phase 1 security hardening: this database event-trigger helper is not an
-- application RPC and must not be callable through PostgREST by browser roles.

revoke execute on function public.rls_auto_enable()
  from public, anon, authenticated;

