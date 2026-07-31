import assert from "node:assert/strict";
import test from "node:test";

import {
  filterDemoFiles,
  focusLoopTarget,
  nextPickerRowIndex,
  shouldHandleFileArrow,
  swipeDirection,
  wrapDemoIndex,
} from "../site/demo-controller.js";
import { todoDemoFiles } from "../site/todo-demo.js";

test("wraps file navigation in both directions", () => {
  assert.equal(wrapDemoIndex(10, 10), 0);
  assert.equal(wrapDemoIndex(-1, 10), 9);
});

test("filters the ten demo files without losing their source indexes", () => {
  const matches = filterDemoFiles(todoDemoFiles, "todoStore");
  assert.deepEqual(
    matches.map(({ file, index }) => [index, file.path]),
    [
      [4, "src/lib/todoStore.ts"],
      [8, "src/lib/todoStore.test.ts"],
    ],
  );
});

test("wraps picker rows and modal focus", () => {
  assert.equal(nextPickerRowIndex(9, 10, 1), 0);
  assert.equal(nextPickerRowIndex(0, 10, -1), 9);
  assert.equal(focusLoopTarget(0, 5, true), 5);
  assert.equal(focusLoopTarget(5, 5, false), 0);
  assert.equal(focusLoopTarget(2, 5, false), null);
});

test("scopes arrow keys to the focused demo", () => {
  assert.equal(
    shouldHandleFileArrow({
      pickerIsOpen: false,
      targetAcceptsText: false,
      targetHandlesArrow: false,
      demoHasFocus: true,
    }),
    true,
  );
  assert.equal(
    shouldHandleFileArrow({
      pickerIsOpen: false,
      targetAcceptsText: false,
      targetHandlesArrow: false,
      demoHasFocus: false,
    }),
    false,
  );
  assert.equal(
    shouldHandleFileArrow({
      pickerIsOpen: true,
      targetAcceptsText: false,
      targetHandlesArrow: false,
      demoHasFocus: true,
    }),
    false,
  );
  assert.equal(
    shouldHandleFileArrow({
      pickerIsOpen: false,
      targetAcceptsText: false,
      targetHandlesArrow: true,
      demoHasFocus: true,
    }),
    false,
  );
});

test("requires a clear horizontal swipe before changing files", () => {
  assert.equal(swipeDirection(-80), "next");
  assert.equal(swipeDirection(80), "prev");
  assert.equal(swipeDirection(20), null);
});
