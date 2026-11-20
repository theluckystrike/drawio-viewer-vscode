'use strict';
// NEWBFIX: batch export output names never clash (VER26 BLOCK, 20 Nov 09:46).
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceStems, NameAlloc } = require('../src/core/names');

test('sourceStems: same stem in the same folder keeps the input extension; other folders keep the plain stem', () => {
  assert.deepEqual(sourceStems(['plan.drawio', 'plan.dio', 'a/plan.drawio', 'b/Plan.DIO', 'b/plan.drawio', 'solo.dio']),
    ['plan.drawio', 'plan.dio', 'plan', 'Plan.DIO', 'plan.drawio', 'solo']);
});

test('NameAlloc: a taken name (any letter case) gets -2, -3 before .svg; folders are separate', () => {
  const a = new NameAlloc();
  assert.equal(a.take('.', 'shop-01-Architecture.svg'), 'shop-01-Architecture.svg');
  assert.equal(a.take('.', 'SHOP-01-architecture.svg'), 'SHOP-01-architecture-2.svg');
  assert.equal(a.take('.', 'shop-01-Architecture.svg'), 'shop-01-Architecture-3.svg');
  assert.equal(a.take('sub', 'shop-01-Architecture.svg'), 'shop-01-Architecture.svg');
  assert.equal(a.take('.', 'export-errors.md'), 'export-errors-2.md');
});
