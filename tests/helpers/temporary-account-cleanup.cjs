// Only accounts returned by this execution's signUp may enter the cleanup list.
// This helper never logs in, derives credentials, or deletes users by email/prefix.
function createTemporaryAccountCleanup(emit) {
  const created = new Map();
  return {
    track(user, authUser) {
      if (!authUser?.id) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUser.id)) {
        throw new Error('Invalid temporary account ID');
      }
      user.userId = authUser.id;
      created.set(user.userId, user);
      // Emit before bootstrap: even a failed setup can be deleted by an authorized
      // Auth admin using these exact IDs, without recovering any password.
      emit({ event: 'AUTH_ADMIN_DELETE_REQUIRED', runId: user.runId,
        label: user.label, userId: user.userId, cleanupRequired: true });
    },
    async finish() {
      let failed = false;
      for (const user of created.values()) {
        let ok = false;
        try {
          const result = await user.client.auth.signOut({ scope: 'global' });
          ok = Boolean(result && !result.error);
        } catch (_error) {
          // Continue other exact-ID cleanup; report failure without raw Auth text.
        } finally {
          user.password = null;
        }
        failed ||= !ok;
        emit({ event: 'TEMP_GLOBAL_SIGNOUT', runId: user.runId, label: user.label,
          userId: user.userId, ok, cleanupRequired: true });
      }
      created.clear();
      if (failed) throw new Error('Temporary global sign-out incomplete; exact-ID admin cleanup required');
    }
  };
}
module.exports = { createTemporaryAccountCleanup };
