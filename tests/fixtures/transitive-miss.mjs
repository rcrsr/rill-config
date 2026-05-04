// Fixture for the EC-7 transitive-miss loader test.
// Importing this module triggers a real Node ERR_MODULE_NOT_FOUND for the
// bare specifier below, which the loader should classify as a transitive
// dependency miss (not as the entrypoint itself being unavailable).
import 'fake-transitive-dep-rcrsr-test';

export const extensionManifest = {};
