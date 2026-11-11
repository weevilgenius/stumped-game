import { extractSeedCode } from './state/appController';

describe('extractSeedCode', () => {
  it('extracts a bare seed code and normalizes case', () => {
    expect(extractSeedCode('  165m-0000001-0  ')).toBe('165M-0000001-0');
  });

  it('extracts a seed code from a full share URL', () => {
    expect(extractSeedCode('https://example.com/?code=165M-0000001-0')).toBe('165M-0000001-0');
  });
});
