import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { consoleCopy } from '@/i18n/console';
import { HoursForm, type WeeklyHours } from './hours-form';

vi.mock('./actions', () => ({ setHours: vi.fn(async () => ({ ok: true })) }));

const nineToNine = { open: '07:00', close: '22:00' }; // the store's usual hours
const hours: WeeklyHours = { mon: [nineToNine], tue: [nineToNine], wed: [nineToNine], thu: [nineToNine], fri: [nineToNine], sat: [nineToNine], sun: [] };

describe('HoursForm (ADR-021)', () => {
  it('shows each day with its times; a closed day has its times switched off', async () => {
    const copy = consoleCopy('en');
    render(<HoursForm id="m1" hours={hours} openNow={false} canEdit copy={copy} />);
    expect(screen.getByLabelText('Mon Opens')).toHaveValue('07:00');
    expect(screen.getByLabelText('Mon Closes')).toHaveValue('22:00');
    expect(screen.getByLabelText('Sun Closed')).toBeChecked();
    expect(screen.getByLabelText('Sun Opens')).toBeDisabled();
    expect(screen.getByTestId('hours-open-now')).toHaveTextContent('Customers see it: Closed');

    await userEvent.click(screen.getByLabelText('Sun Closed'));
    expect(screen.getByLabelText('Sun Opens')).toBeEnabled();
    expect(screen.getByLabelText('Sun Opens')).toHaveValue('07:00'); // a reopened day starts from the usual hours
    expect(screen.getByLabelText('Sun Closes')).toHaveValue('22:00');
    await userEvent.click(screen.getByLabelText('Mon Closed'));
    expect(screen.getByLabelText('Mon Closes')).toBeDisabled();
    expect(screen.getByLabelText(copy.merchant.hoursEdit.reason)).toBeRequired();
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeEnabled();
  });

  it('is read-only for roles that cannot edit, and in Telugu', () => {
    const copy = consoleCopy('te');
    render(<HoursForm id="m1" hours={hours} openNow canEdit={false} copy={copy} />);
    expect(screen.queryByRole('button', { name: copy.merchant.hoursEdit.save })).toBeNull();
    expect(screen.getByLabelText(`సోమ ${copy.merchant.hoursEdit.opens}`)).toBeDisabled();
    expect(screen.getByTestId('hours-open-now')).toHaveTextContent('కస్టమర్లకు: తెరిచి ఉంది');
  });
});
