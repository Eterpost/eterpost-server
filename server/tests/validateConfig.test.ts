import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/validateConfig';


describe('validateConfig', () => {
  it('should accept administrators as a list of logins', () => {
    validateConfig({ server: { auth: { admins: ['lav'] } } });
    validateConfig({ server: { auth: { required: true } } });
    validateConfig({ server: {} });
  });

  it('should reject administrators that are not a list of logins', () => {
    for (const admins of ['lav', [1], [''], null]) {
      assert.throws(
        () => validateConfig({ server: { auth: { admins } } }),
        /server\.auth\.admins/
      );
    }
  });
});
