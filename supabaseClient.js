(function(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.LifeQuestSupabase = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  let singleton = null;

  function validateConfig(config = {}) {
    const url = String(config.url || '').trim();
    const publishableKey = String(config.publishableKey || '').trim();
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) {
      throw new Error('LifeQuest Supabase URL is missing or invalid');
    }
    if (!publishableKey.startsWith('sb_publishable_')) {
      throw new Error('LifeQuest Supabase publishable key is missing or invalid');
    }
    return { url, publishableKey };
  }

  function createSupabaseClient({ config, library } = {}) {
    const resolved = validateConfig(config);
    if (!library || typeof library.createClient !== 'function') {
      throw new Error('Supabase JavaScript client is unavailable');
    }
    return library.createClient(resolved.url, resolved.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'lifequest_member_auth_session'
      }
    });
  }

  function getSupabaseClient({ config, library } = {}) {
    if (!singleton) singleton = createSupabaseClient({ config, library });
    return singleton;
  }

  function resetForTests() {
    singleton = null;
  }

  return {
    validateConfig,
    createSupabaseClient,
    getSupabaseClient,
    resetForTests
  };
});
