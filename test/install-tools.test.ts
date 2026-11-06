import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudgetRefusal } from './install-tools.ts';

test('package budget admission rejects native errors while host budget transport permits them', () => {
  for (const flag of ['--budget', '--output-budget']) assertBudgetRefusal(flag, { refusal: { code: 'output_budget' } });
  for (const result of [{ code: 'native_error' }, { code: 'output_budget', refusal: { code: 'invalid_input' } }]) {
    assert.throws(() => assertBudgetRefusal('--budget', result), /proof:package_budget/, 'proof:budget_specificity');
    assertBudgetRefusal('--output-budget', result);
  }
  for (const flag of ['--budget', '--output-budget']) for (const result of [{}, { code: 2 }, { refusal: { code: 'invalid_input' } }]) assert.throws(() => assertBudgetRefusal(flag, result));
});
