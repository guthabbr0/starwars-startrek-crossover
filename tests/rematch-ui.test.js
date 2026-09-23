import test from 'node:test';
import assert from 'node:assert/strict';
import { setResultVisibility } from '../src/result-ui.js';

test('an active round clears a stale result overlay', () => {
  const overlay = { hidden: false };
  setResultVisibility(overlay, '');
  assert.equal(overlay.hidden, true);
});
test('completed rounds show the result, including a draw', () => {
  for (const winner of ['fleet', 'armada', 'draw']) {
    const overlay = { hidden: true };
    setResultVisibility(overlay, winner);
    assert.equal(overlay.hidden, false);
  }
});
test('restart before the fresh snapshot cannot latch the previous result screen', () => {
  const overlay = { hidden: true };
  setResultVisibility(overlay, 'fleet');
  overlay.hidden = true; // Restart notification arrives before snapshot.
  setResultVisibility(overlay, 'fleet'); // One HUD update still sees the old state.
  assert.equal(overlay.hidden, false);
  setResultVisibility(overlay, ''); // New authoritative round arrives.
  assert.equal(overlay.hidden, true);
});
