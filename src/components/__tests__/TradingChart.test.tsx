/**
 * Test perspective table — TradingChart (Skia mocked, see jest/mocks)
 *
 * | Case | Input / Precondition           | Perspective      | Expected                              |
 * |------|--------------------------------|------------------|---------------------------------------|
 * | TC1  | no props                       | Boundary (empty) | dark theme background fill            |
 * | TC2  | light theme                    | Equivalence      | light background                      |
 * | TC3  | themeOverride.background       | Equivalence      | override wins over theme              |
 * | TC4  | style + testID                 | Equivalence      | forwarded to the canvas, flex kept    |
 */
import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { defaultDarkTheme } from '../../theme/defaultDarkTheme';
import { defaultLightTheme } from '../../theme/defaultLightTheme';
import { TradingChart } from '../TradingChart';

const fillColor = (root: ReturnType<typeof render>) =>
  root.UNSAFE_root.findByType('SkiaFill' as never).props.color;

describe('TradingChart', () => {
  it('TC1: renders the dark background by default', async () => {
    // Given / When
    const view = await render(<TradingChart />);
    // Then
    expect(fillColor(view)).toBe(defaultDarkTheme.background);
  });

  it('TC2: renders the given theme background', async () => {
    // Given / When
    const view = await render(<TradingChart theme={defaultLightTheme} />);
    // Then
    expect(fillColor(view)).toBe(defaultLightTheme.background);
  });

  it('TC3: applies themeOverride on top of theme', async () => {
    // Given / When
    const view = await render(
      <TradingChart
        theme={defaultLightTheme}
        themeOverride={{ background: '#123456' }}
      />
    );
    // Then
    expect(fillColor(view)).toBe('#123456');
  });

  it('TC4: forwards style and testID to the canvas', async () => {
    // Given / When
    const view = await render(
      <TradingChart testID="chart" style={{ height: 300 }} />
    );
    // Then
    expect(view.getByTestId('chart')).toHaveStyle({ flex: 1, height: 300 });
  });
});
