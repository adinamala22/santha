/** Unsigned JWT for tests (the web app only reads claims; the backend verifies signatures). */
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
export const fakeJwt = (claims: object) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
