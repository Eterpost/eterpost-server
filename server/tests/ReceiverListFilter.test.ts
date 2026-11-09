import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReceiverListFilter } from '../src/ReceiverListFilter';
import { Receiver } from '../src/Receiver';
import { AddressStats } from '../src/AddressStats';


describe('ReceiverListFilter', () => {
  const stats = new Map([
    ['unknown@example.com', { email: 'unknown@example.com', lastStatus: '5.1.1' }],
    ['spam@example.com', { email: 'spam@example.com', lastStatus: '5.7.1', spam: true }],
    ['busy@example.com', { email: 'busy@example.com', lastStatus: '4.2.2' }]
  ]);
  const filter = new ReceiverListFilter({
    getBatchStats: async (emails: string[]) => emails.map(email => stats.get(email) as AddressStats)
  } as any);

  it('should drop invalid addresses and permanent errors but keep rejections as spam', async () => {
    const receivers = [
      'ok@example.com', 'unknown@example.com', 'spam@example.com', 'busy@example.com',
      'not-an-email'
    ].map(email => new Receiver(email));
    const valid = await filter.getValidReceivers(receivers);
    assert.deepEqual(valid.map(r => r.email), [
      'ok@example.com', 'spam@example.com', 'busy@example.com'
    ]);
  });
});
