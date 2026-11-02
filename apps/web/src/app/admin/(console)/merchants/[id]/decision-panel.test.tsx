import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { consoleCopy } from '@/i18n/console';
import { DecisionPanel } from './decision-panel';

vi.mock('./actions', () => ({ decide: vi.fn(async () => ({ ok: true })) }));

const copy = consoleCopy('en');
const props = { id: 'm1', name: 'Ramesh Stores', market: 'Dargamitta', copy };

describe('DecisionPanel', () => {
  it('offers approve and send back for a submitted merchant, behind a confirm step', async () => {
    render(<DecisionPanel {...props} status="submitted" canDecide />);
    expect(screen.queryByRole('button', { name: copy.merchant.goLive })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: copy.merchant.approve }));
    expect(screen.getByText(/Approve Ramesh Stores\?/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.common.confirm })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: copy.common.cancel }));
    expect(screen.getByRole('button', { name: copy.merchant.approve })).toBeInTheDocument();
  });

  it('offers go live once approved, naming the micro-market', async () => {
    render(<DecisionPanel {...props} status="approved" canDecide />);
    await userEvent.click(screen.getByRole('button', { name: copy.merchant.goLive }));
    expect(screen.getByText('Ramesh Stores will be visible to customers in Dargamitta. Continue?')).toBeInTheDocument();
  });

  it('send back asks for a reason from the list (and approve does not)', async () => {
    render(<DecisionPanel {...props} status="submitted" canDecide />);
    expect(screen.queryByLabelText(copy.merchant.reason)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: copy.merchant.reject }));
    const select = screen.getByLabelText(copy.merchant.reason);
    expect(select).toHaveValue('documents_unclear');
    expect(screen.getAllByRole('option')).toHaveLength(7);
  });

  it('is read-only for roles that cannot decide, and empty for live merchants', () => {
    const { rerender } = render(<DecisionPanel {...props} status="submitted" canDecide={false} />);
    expect(screen.getByText(copy.common.readOnly)).toBeInTheDocument();
    rerender(<DecisionPanel {...props} status="live" canDecide />);
    expect(screen.getByText(copy.merchant.noActions)).toBeInTheDocument();
  });
});
