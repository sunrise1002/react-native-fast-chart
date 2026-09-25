/**
 * Price-axis width sizing (Phase 5.2). The axis grows to fit its widest
 * label but never shrinks while the user pans (grow-only), so the plot
 * width — and every bar position — does not jitter as label widths change.
 * Shrinking is only allowed at explicit points (dataset reset). Pure,
 * worklet-compatible.
 */

/** Width steps, dp: small label changes don't resize the axis. */
export const AXIS_WIDTH_QUANTUM = 4;

/** Width needed for a label of `labelWidth` with `padding` on both sides. */
export function requiredAxisWidth(
  labelWidth: number,
  padding: number,
  quantum = AXIS_WIDTH_QUANTUM
): number {
  'worklet';
  const pad = padding > 0 && padding < Infinity ? padding : 0;
  const raw =
    (labelWidth > 0 && labelWidth < Infinity ? labelWidth : 0) + 2 * pad;
  const q = quantum > 0 && quantum < Infinity ? quantum : 1;
  return Math.ceil(raw / q - 1e-9) * q;
}

/**
 * Next axis width: at least `minWidth`, at most `maxWidth`, never below
 * `current` unless `allowShrink`. Invalid inputs keep the valid bounds.
 */
export function nextAxisWidth(
  current: number,
  required: number,
  minWidth: number,
  maxWidth: number,
  allowShrink: boolean
): number {
  'worklet';
  const min = minWidth > 0 && minWidth < Infinity ? minWidth : 0;
  let width = required > 0 && required < Infinity ? required : 0;
  if (!allowShrink && current > width && current < Infinity) {
    width = current;
  }
  if (maxWidth >= min && maxWidth < width) {
    width = maxWidth;
  }
  return width < min ? min : width;
}
