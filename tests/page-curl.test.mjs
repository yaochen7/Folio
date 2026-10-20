import test from 'node:test';
import assert from 'node:assert/strict';
import { curlPoint, dragProgress, completesTurn, settleProgress } from '../js/page-curl.js';

test('the sheet begins and ends flat, with a fixed spine throughout the turn', () => {
  for (const width of [300, 370, 560, 680]) {
    for (let i = 0; i <= 20; i++) {
      const x = width * i / 20;
      assert.deepEqual(curlPoint(x, width, 0), { x, z: 0 });
      assert.deepEqual(curlPoint(x, width, 1), { x: -x, z: 0 });
      const spine = curlPoint(0, width, i / 20);
      assert.ok(spine.x === 0 && spine.z === 0);
    }
  }
});

test('a drag moves the free paper edge by the same distance as the finger', () => {
  for (const width of [300, 370, 560]) {
    for (const distance of [20, 45, 100, width, width * 1.5]) {
      const tip = curlPoint(width, width, dragProgress(distance, width));
      assert.ok(Math.abs(tip.x - (width - distance)) < .00001);
    }
  }
});

test('the curl bends a sheet without stretching or discontinuities', () => {
  const width = 370, segment = width / 2000;
  for (const progress of [.01, .1, .25, .5, .75, .9, .99]) {
    let previous = curlPoint(0, width, progress), length = 0;
    for (let i = 1; i <= 2000; i++) {
      const current = curlPoint(segment * i, width, progress);
      const distance = Math.hypot(current.x - previous.x, current.z - previous.z);
      assert.ok(distance <= segment + 1e-8);
      assert.ok(current.z >= 0 && Number.isFinite(current.x));
      length += distance;
      previous = current;
    }
    assert.ok(Math.abs(length - width) < .1);
  }
});

test('short held pulls return, deliberate pulls and quick flicks turn, pullbacks can cancel', () => {
  assert.equal(completesTurn(.08, 0), false);
  assert.equal(completesTurn(.23, 0), true);
  assert.equal(completesTurn(.05, .7), true);
  assert.equal(completesTurn(.23, -.6), false);
  assert.equal(completesTurn(.01, 2), false);
});

test('settling is continuous at release and converges without a long bounce', () => {
  for (const [start, velocity, target] of [[.08, 0, 0], [.3, 1, 1], [.6, -.5, 0], [.9, 2, 1]]) {
    const initial = settleProgress(start, velocity, target, 0);
    assert.ok(Math.abs(initial.position - start) < 1e-10);
    assert.ok(Math.abs(initial.velocity - velocity) < 1e-10);
    for (let frame = 1; frame <= 90; frame++) {
      const state = settleProgress(start, velocity, target, frame / 120);
      assert.ok(state.position >= 0 && state.position <= 1);
    }
    const settled = settleProgress(start, velocity, target, .6);
    assert.ok(Math.abs(settled.position - target) < .0001);
    assert.ok(Math.abs(settled.velocity) < .002);
  }
});
