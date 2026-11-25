import { expect, test } from 'vitest';
import { name } from './index.ts';

test('the package loads', () => {
  expect(name).toBe('done-gate');
});
