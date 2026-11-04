import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { consoleCopy } from '@/i18n/console';
import { CoverageForm } from './coverage-form';
import { CircleTool } from './version-editor';

vi.mock('./actions', () => ({ saveCoverage: vi.fn(async () => ({ ok: true })), createMarket: vi.fn(), publishVersion: vi.fn() }));

const copy = consoleCopy('en');

describe('CoverageForm (ADR-019)', () => {
  it('shows the current setting and lets ops edit it', () => {
    render(<CoverageForm cityId="c1" cityName="Nellore" coverage={{ nearestFallback: true, maxDistanceM: 5000 }} canEdit copy={copy} />);
    expect(screen.getByText('On · up to 5 km')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: copy.markets.coverage.on })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: copy.markets.coverage.km })).toHaveValue(5);
    expect(screen.getByRole('button', { name: copy.markets.coverage.save })).toBeEnabled();
  });

  it('is read-only for roles that cannot decide', () => {
    render(<CoverageForm cityId="c1" cityName="Nellore" coverage={{ nearestFallback: false, maxDistanceM: 5000 }} canEdit={false} copy={copy} />);
    expect(screen.getByText(copy.markets.coverage.statusOff)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.markets.coverage.save })).toBeNull();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});

describe('CircleTool (ADR-019)', () => {
  it('turns centre + radius into area points; rejects a bad radius', async () => {
    const onApply = vi.fn();
    render(<CircleTool copy={copy.markets.circle} start={[]} onApply={onApply} />);
    const km = screen.getByRole('textbox', { name: copy.markets.circle.km });
    await userEvent.clear(km);
    await userEvent.type(km, '40');
    await userEvent.click(screen.getByRole('button', { name: copy.markets.circle.apply }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.markets.circle.invalid);
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.clear(km);
    await userEvent.type(km, '2.5');
    await userEvent.click(screen.getByRole('button', { name: copy.markets.circle.apply }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toHaveLength(48);
  });
});
