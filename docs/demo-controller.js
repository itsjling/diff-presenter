export function wrapDemoIndex(index, length) {
  return (index + length) % length;
}

export function filterDemoFiles(files, query) {
  const cleanQuery = query.trim().toLowerCase();
  return files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => file.path.toLowerCase().includes(cleanQuery));
}

export function nextPickerRowIndex(activeIndex, length, step) {
  if (activeIndex === -1) return step > 0 ? 0 : length - 1;
  return (activeIndex + step + length) % length;
}

export function focusLoopTarget(activeIndex, lastIndex, shiftKey) {
  if (shiftKey && activeIndex === 0) return lastIndex;
  if (!shiftKey && activeIndex === lastIndex) return 0;
  return null;
}

export function shouldHandleFileArrow({
  pickerIsOpen,
  targetAcceptsText,
  demoHasFocus,
}) {
  return !pickerIsOpen && !targetAcceptsText && demoHasFocus;
}

export function swipeDirection(distance, threshold = 48) {
  if (Math.abs(distance) < threshold) return null;
  return distance < 0 ? "next" : "prev";
}
