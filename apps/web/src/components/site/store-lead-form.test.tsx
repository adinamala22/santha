import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LaunchSignup } from './launch-signup';
import { StoreLeadForm } from './store-lead-form';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

const postJson = vi.fn();
vi.mock('@/lib/api', () => ({ postJson: (...a: unknown[]) => postJson(...a) }));

describe('StoreLeadForm (ADR-023)', () => {
  beforeEach(() => {
    postJson.mockReset();
    postJson.mockResolvedValue({ ok: true, data: { ok: true } });
  });

  it('previews the shop card as the owner types: name, type and area', async () => {
    render(<StoreLeadForm lang="en" />);
    const preview = screen.getByTestId('shop-preview');
    expect(within(preview).getByText('How customers will see your shop')).toBeInTheDocument();
    expect(screen.getByTestId('preview-name')).toHaveTextContent('Your shop');
    expect(screen.getByTestId('preview-meta')).toHaveTextContent('Kirana / general store · Nellore');

    await userEvent.type(screen.getByLabelText('Shop name'), 'Sri Sai Kirana');
    await userEvent.click(screen.getByLabelText('Pharmacy'));
    await userEvent.type(screen.getByLabelText('Area (e.g. Magunta Layout)'), 'Dargamitta');
    expect(screen.getByTestId('preview-name')).toHaveTextContent('Sri Sai Kirana');
    expect(screen.getByTestId('preview-meta')).toHaveTextContent('Pharmacy · Dargamitta');
    expect(within(preview).getByText('New on Santha')).toBeInTheDocument();
  });

  it('asks for the shop name first, then sends a store lead with shop name and type', async () => {
    render(<StoreLeadForm lang="en" />);
    await userEvent.click(screen.getByRole('button', { name: 'Get my shop ready for launch' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your shop name.');
    expect(postJson).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Shop name'), 'Sri Sai Kirana');
    await userEvent.click(screen.getByLabelText('Bakery & sweets'));
    await userEvent.type(screen.getByLabelText('Your name'), 'Ravi Kumar');
    await userEvent.type(screen.getByLabelText('Mobile number'), '98765 02001');
    await userEvent.click(screen.getByRole('button', { name: 'Get my shop ready for launch' }));
    expect(postJson).toHaveBeenCalledWith('/v1/leads', expect.objectContaining({ kind: 'store', name: 'Ravi Kumar', phone: '9876502001', business: 'Sri Sai Kirana', category: 'bakery', locale: 'en' }));
    expect(await screen.findByTestId('lead-thanks')).toHaveTextContent('You are on the launch list!');
    expect(screen.getByTestId('preview-name')).toHaveTextContent('Sri Sai Kirana'); // their card stays on screen
  });

  it('after launch the same form uses the normal wording; Telugu works', async () => {
    const { unmount } = render(<StoreLeadForm lang="en" prelaunch={false} />);
    expect(screen.getByRole('button', { name: 'Request a call' })).toBeInTheDocument();
    unmount();
    render(<StoreLeadForm lang="te" />);
    expect(screen.getByText('కస్టమర్లకు మీ షాప్ ఇలా కనిపిస్తుంది')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ప్రారంభానికి నా షాప్‌ను సిద్ధం చేయండి' })).toBeInTheDocument();
  });
});

describe('LaunchSignup (ADR-023)', () => {
  beforeEach(() => {
    postJson.mockReset();
    postJson.mockResolvedValue({ ok: true, data: { ok: true } });
  });

  it('validates, then saves a customer launch-list lead and thanks them', async () => {
    render(<LaunchSignup lang="en" />);
    await userEvent.type(screen.getByLabelText('Your name'), 'Lakshmi');
    await userEvent.type(screen.getByLabelText('Mobile number'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Notify me' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a 10-digit mobile number.');
    await userEvent.clear(screen.getByLabelText('Mobile number'));
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876502003');
    await userEvent.click(screen.getByRole('button', { name: 'Notify me' }));
    expect(postJson).toHaveBeenCalledWith('/v1/leads', expect.objectContaining({ kind: 'customer', name: 'Lakshmi', phone: '9876502003', locale: 'en' }));
    expect(await screen.findByTestId('launch-thanks')).toHaveTextContent('You are on the list!');
  });

  it('shows a friendly message when rate-limited', async () => {
    postJson.mockResolvedValue({ ok: false, status: 429, code: 'RATE_LIMITED' });
    render(<LaunchSignup lang="te" />);
    await userEvent.type(screen.getByLabelText('మీ పేరు'), 'లక్ష్మి');
    await userEvent.type(screen.getByLabelText('మొబైల్ నంబర్'), '9876502003');
    await userEvent.click(screen.getByRole('button', { name: 'నాకు తెలియజేయండి' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('చాలా అభ్యర్థనలు');
  });
});
