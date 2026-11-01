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

  it('moves to the OTP step on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ challengeId: 'c1' }), { status: 200 })));
    render(<LoginForm copy={copy} />);
    await userEvent.type(screen.getByLabelText(copy.email), 'priya@santha.in');
    await userEvent.type(screen.getByLabelText(copy.password), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: copy.continue }));
    expect(await screen.findByRole('heading', { name: copy.otpTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(copy.otpLabel)).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('shows a human message when the backend endpoint is not there yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    render(<LoginForm copy={copy} />);
    await userEvent.type(screen.getByLabelText(copy.email), 'priya@santha.in');
    await userEvent.type(screen.getByLabelText(copy.password), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: copy.continue }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.unavailable);
  });
});

describe('messages', () => {
  it('has a Telugu string for every English string', () => {
    const keys = (o: unknown, p = ''): string[] =>
      typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
    expect(keys(messages.te).sort()).toEqual(keys(messages.en).sort());
  });
});
