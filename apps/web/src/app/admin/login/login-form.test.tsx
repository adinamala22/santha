import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages, t } from '@/i18n/messages';
import { LoginForm } from './login-form';

const copy = t('en').admin;

afterEach(() => vi.unstubAllGlobals());

describe('LoginForm', () => {
  it('validates email and password before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm copy={copy} />);
    await userEvent.click(screen.getByRole('button', { name: copy.continue }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.emailInvalid);
    await userEvent.type(screen.getByLabelText(copy.email), 'priya@santha.in');
    await userEvent.click(screen.getByRole('button', { name: copy.continue }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.passwordRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves to the OTP step on success and says where the code went', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ challengeId: 'c1', phoneMasked: '+9190******00' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm copy={copy} />);
    await userEvent.type(screen.getByLabelText(copy.email), 'priya@santha.in');
    await userEvent.type(screen.getByLabelText(copy.password), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: copy.continue }));
    expect(await screen.findByRole('heading', { name: copy.otpTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(copy.otpLabel)).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByText('Code sent to +9190******00.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/ops/login', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the same message for a wrong password and an unknown email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS' } }), { status: 401 })),
    );
    render(<LoginForm copy={copy} />);
    await userEvent.type(screen.getByLabelText(copy.email), 'priya@santha.in');
    await userEvent.type(screen.getByLabelText(copy.password), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: copy.continue }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.credentials);
  });

  it('reports a wrong code and stays on the OTP step', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'c1' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'OTP_INVALID' } }), { status: 400 })),
    );
    render(<LoginForm copy={copy} />);
    await userEvent.type(screen.getByLabelText(copy.email), 'priya@santha.in');
    await userEvent.type(screen.getByLabelText(copy.password), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: copy.continue }));
    await userEvent.type(await screen.findByLabelText(copy.otpLabel), '000000');
    await userEvent.click(screen.getByRole('button', { name: copy.verify }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.otpWrong);
  });
});

describe('messages', () => {
  it('has a Telugu string for every English string', () => {
    const keys = (o: unknown, p = ''): string[] =>
      typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
    expect(keys(messages.te).sort()).toEqual(keys(messages.en).sort());
  });
});
