import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { CognitoIdentityProviderClient, DescribeUserPoolCommand, DescribeUserPoolClientCommand, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminGetUserCommand, AdminDeleteUserCommand, RevokeTokenCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoUserPool, CognitoUser, AuthenticationDetails, type IAuthenticationCallback } from 'amazon-cognito-identity-js';
import { createCognitoPkce, createCognitoPkceTokenVerifier, type AuthorizationTransaction, type CognitoTokens } from '../../src/lib/authentication/cognito-pkce.ts';
import { createCognitoAuthenticationProvider } from '../../src/lib/authentication/cognito-verifier.ts';
async function main() {
    assert.ok(process.argv.includes('--execute'), 'Explicit disposable staging rehearsal required');
    function aws(args: string[]) { try {
        return JSON.parse(execFileSync('aws.exe', [...args, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    }
    catch {
        throw Error('Staging metadata unavailable');
    } }
    function gate() { const id = aws(['sts', 'get-caller-identity']); assert.equal(id.Account, '559054714699'); assert.ok(id.Arn.includes('TracePointMigrationStaging')); }
    gate();
    const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', 'tracepoint-staging-cognito']).Stacks[0];
    assert.ok(['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus));
    assert.equal(stack.EnableTerminationProtection, true);
    const outputs = Object.fromEntries(stack.Outputs.map((x: {
        OutputKey: string;
        OutputValue: string;
    }) => [x.OutputKey, x.OutputValue]));
    const poolId = outputs.UserPoolId, clientId = outputs.ClientId, domain = 'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com';
    assert.equal(outputs.ManagedDomain, domain);
    const client = new CognitoIdentityProviderClient({ region: 'us-east-1', maxAttempts: 1 });
    const pool = (await client.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))).UserPool!;
    assert.equal(pool.Arn, 'arn:aws:cognito-idp:us-east-1:559054714699:userpool/' + poolId);
    assert.equal(pool.MfaConfiguration, 'ON');
    assert.equal(pool.UserPoolTier, 'ESSENTIALS');
    const configured = (await client.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: clientId }))).UserPoolClient!;
    assert.ok(!configured.ClientSecret);
    assert.deepEqual(configured.ExplicitAuthFlows, ['ALLOW_USER_SRP_AUTH']);
    assert.deepEqual(configured.CallbackURLs, ['https://staging.tracepointhq.com/api/auth/cognito/callback']);
    const cleanupIndex = process.argv.indexOf('--cleanup-run'), cleanupOnly = cleanupIndex >= 0;
    const run = cleanupOnly ? process.argv[cleanupIndex + 1] : randomUUID();
    assert.match(run, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const username = 'cognito-rehearsal-' + run + '@example.invalid', password = randomBytes(36).toString('base64url') + 'Aa1!', stableUserId = randomUUID();
    let created = cleanupOnly, browser, step = 'fixture creation';
    const results: Record<string, unknown> = { run, account: '559054714699', region: 'us-east-1', poolId, clientId, applicationProviderSwitched: false, productionIdentityMapping: false };
    function otp(secret: string) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const char of secret.replace(/=+$/, '')) {
        const v = alphabet.indexOf(char);
        assert.ok(v >= 0);
        bits += v.toString(2).padStart(5, '0');
    } const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(x => parseInt(x, 2))); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = createHmac('sha1', key).update(counter).digest(), offset = h[19] & 15; return ((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0'); }
    try {
        if (!cleanupOnly) {
            gate();
            await client.send(new AdminCreateUserCommand({ UserPoolId: poolId, Username: username, TemporaryPassword: password, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: username }, { Name: 'email_verified', Value: 'true' }] }));
            created = true;
            gate();
            await client.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: username, Password: password, Permanent: true }));
            const fixture = await client.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
            const subject = fixture.UserAttributes?.find(x => x.Name === 'sub')?.Value;
            assert.ok(subject);
            const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId;
            step = 'SRP and TOTP enrollment';
            let totpSecret = '', srpAccessToken = '';
            const memory = new Map<string, string>(), storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); }, clear: () => { memory.clear(); } };
            const userPool = new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId, Storage: storage, AdvancedSecurityDataCollectionFlag: false }), user = new CognitoUser({ Username: username, Pool: userPool, Storage: storage });
            await new Promise<void>((resolve, reject) => { const callbacks: IAuthenticationCallback = { onSuccess: session => { srpAccessToken = session.getAccessToken().getJwtToken(); resolve(); }, onFailure: reject, mfaSetup: () => user.associateSoftwareToken({ onFailure: reject, associateSecretCode: secret => { void (async () => { totpSecret = secret; const remaining = 30000 - Date.now() % 30000; if (remaining < 5000)
                        await new Promise(r => setTimeout(r, remaining + 500)); user.verifySoftwareToken(otp(secret), 'TracePoint staging rehearsal', callbacks); })().catch(reject); } }) }; user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), callbacks); });
            results.initialSrpTokenReceived = !!srpAccessToken;
            results.setupChallengeUsed = !!totpSecret;
            if (!totpSecret) {
                await new Promise<void>((resolve, reject) => user.associateSoftwareToken({ onFailure: reject, associateSecretCode: secret => { void (async () => { totpSecret = secret; const remaining = 30000 - Date.now() % 30000; if (remaining < 5000)
                        await new Promise(r => setTimeout(r, remaining + 500)); user.verifySoftwareToken(otp(secret), 'TracePoint staging rehearsal', { onSuccess: () => resolve(), onFailure: reject }); })().catch(reject); } }));
            }
            await new Promise<void>((resolve, reject) => user.setUserMfaPreference(null, { Enabled: true, PreferredMfa: true }, error => error ? reject(error) : resolve()));
            assert.ok(totpSecret);
            const enrolled = await client.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
            assert.ok(enrolled.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA'));
            results.sdkSrpMfaEnrollment = true;
            memory.clear();
            // Rehearsal-only transaction/mapping state. This is never an application fallback.
            const transactions = new Map<string, AuthorizationTransaction>(), config = { environment: 'staging' as const, account: '559054714699', region: 'us-east-1', userPoolId: poolId, clientId };
            const pkce = createCognitoPkce(config, { async put(h, t) { transactions.set(h, t); }, async take(h) { const t = transactions.get(h); transactions.delete(h); return t ?? null; } });
            let active = true;
            const mapping = { async findActive(i: string, s: string) { return i === issuer && s === subject ? { userId: stableUserId } : null; } };
            const provider = createCognitoAuthenticationProvider(config, mapping, async () => active);
            const verify = createCognitoPkceTokenVerifier(config, provider);
            assert.equal((await provider.verifySession(srpAccessToken))?.userId, stableUserId);
            results.srpSignedTokenVerified = true;
            srpAccessToken = '';
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext();
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            const protocolHistory: unknown[] = [];
            results.protocolHistory = protocolHistory;
            page.on('response', response => { void (async () => { const u = new URL(response.url()); if (u.origin !== domain || !/^\/(login|mfa|oauth2\/authorize)/.test(u.pathname))
                return; const h = await response.allHeaders(); const location = h.location ? new URL(h.location, u) : null; protocolHistory.push({ method: response.request().method(), path: u.pathname, status: response.status(), redirect: location ? { host: location.hostname, path: location.pathname, queryKeys: [...location.searchParams.keys()] } : null }); if (protocolHistory.length > 20)
                protocolHistory.shift(); })().catch(() => { }); });
            let callbackCookie = '';
            let callbackResolve: (url: URL) => void = () => { };
            const callbackPromise = new Promise<URL>(r => { callbackResolve = r; });
            context.on('request', request => { const url = new URL(request.url()); if (url.origin === 'https://staging.tracepointhq.com' && url.pathname === '/api/auth/cognito/callback') {
                void request.allHeaders().then(headers => { callbackCookie = headers.cookie ?? ''; callbackResolve(url); });
            } });
            await context.route('**/*', async (route) => { const url = new URL(route.request().url()); if (url.origin !== 'https://staging.tracepointhq.com') {
                await route.continue();
                return;
            } if (url.pathname === '/api/auth/cognito/callback') {
                callbackCookie = (await route.request().headerValue('cookie')) ?? '';
                callbackResolve(url);
            } await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Isolated staging identity rehearsal' }); });
            let begin = await pkce.begin();
            await context.addCookies([{ name: begin.cookie.name, value: begin.cookie.value, domain: 'staging.tracepointhq.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 300 }]);
            step = 'hosted login';
            await page.goto(begin.url, { waitUntil: 'domcontentloaded' });
            await page.locator('input[name="username"]:visible').fill(username);
            await page.locator('input[name="password"]:visible').fill(password);
            await page.locator('input[name="password"]:visible').press('Enter');
            await page.waitForTimeout(1500);
            step = 'hosted TOTP challenge';
            const code = page.locator('input:visible[name*="code" i]');
            await code.waitFor();
            await page.waitForTimeout(30000 - Date.now() % 30000 + 500);
            await code.fill(otp(totpSecret));
            await page.getByRole('button', { name: 'Sign in', exact: true }).click();
            step = 'waiting for PKCE callback';
            const callback = await Promise.race([callbackPromise, new Promise<never>((_, reject) => setTimeout(() => reject(Error('Callback timeout')), 25000))]);
            let tokens: CognitoTokens | undefined;
            step = 'browser transaction cookie';
            assert.ok(callbackCookie.split(';').map(x => x.trim()).includes(begin.cookie.name + '=' + begin.cookie.value));
            step = 'PKCE token exchange and verification';
            const identity = await pkce.complete({ handle: begin.cookie.value, state: callback.searchParams.get('state')!, code: callback.searchParams.get('code')! }, async (t, n) => { tokens = t; const claims = JSON.parse(Buffer.from(t.idToken.split('.')[1], 'base64url').toString()); results.tokenDiagnostics = { nonceMatches: claims.nonce === n, subjectMatches: claims.sub === subject, clientMatches: claims.aud === clientId, accessVerified: !!await provider.verifySession(t.accessToken) }; return verify(t, n); });
            assert.equal(identity.userId, stableUserId);
            assert.ok(tokens);
            delete results.tokenDiagnostics;
            results.mfaEnrollment = true;
            results.pkceAndSignedTokens = true;
            assert.equal(await createCognitoAuthenticationProvider({ ...config, clientId: 'wrongclient' }, mapping, async () => true).verifySession(tokens.accessToken), null);
            results.wrongClientDenied = true;
            active = false;
            assert.equal(await provider.verifySession(tokens.accessToken), null);
            results.applicationRevocationPortDenied = true;
            step = 'refresh rotation';
            active = true;
            const rotatedResponse = await fetch(domain + '/oauth2/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refreshToken }) });
            assert.equal(rotatedResponse.status, 200);
            const rotated = await rotatedResponse.json();
            assert.equal(rotated.token_type, 'Bearer');
            assert.ok(typeof rotated.refresh_token === 'string' && rotated.refresh_token !== tokens.refreshToken);
            assert.equal((await provider.verifySession(rotated.access_token))?.userId, stableUserId);
            results.refreshRotation = true;
            await new Promise(r => setTimeout(r, 12000));
            const oldRefresh = await fetch(domain + '/oauth2/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refreshToken }) });
            assert.equal(oldRefresh.status, 400);
            assert.equal((await oldRefresh.json()).error, 'invalid_grant');
            results.oldRefreshDeniedAfterGrace = true;
            tokens.refreshToken = rotated.refresh_token;
            step = 'refresh revocation';
            gate();
            await client.send(new RevokeTokenCommand({ Token: tokens.refreshToken, ClientId: clientId }));
            const refresh = await fetch(domain + '/oauth2/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refreshToken }) });
            assert.equal(refresh.status, 400);
            const denial = await refresh.json();
            assert.equal(denial.error, 'invalid_grant');
            results.refreshRevocation = true;
            step = 'hosted logout';
            await page.goto(domain + '/logout?' + new URLSearchParams({ client_id: clientId, logout_uri: 'https://staging.tracepointhq.com/login' }), { waitUntil: 'domcontentloaded' });
            const next = await pkce.begin();
            await page.goto(next.url, { waitUntil: 'domcontentloaded' });
            assert.equal(await page.locator('input[name="password"]:visible').count(), 1);
            results.hostedLogout = true;
            transactions.clear();
        }
    }
    catch (error) {
        results.failedStep = step;
        results.errorCode = (error as Error).name;
        process.exitCode = 1;
    }
    finally {
        await browser?.close().catch(() => { });
        if (created) {
            try {
                gate();
                const found = await client.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username })).catch(error => {
                    if (cleanupOnly && error.name === 'UserNotFoundException') return null;
                    throw error;
                });
                if (found) {
                    assert.equal(found.UserAttributes?.find(x => x.Name === 'email')?.Value, username);
                    gate();
                    await client.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: username }));
                }
                try {
                    await client.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
                    throw Error('Fixture still exists');
                }
                catch (error) {
                    assert.equal((error as Error).name, 'UserNotFoundException');
                }
                results.cleanupVerified = true;
            }
            catch {
                results.cleanupVerified = false;
                process.exitCode = 1;
            }
        }
        client.destroy();
        console.log(JSON.stringify(results, null, 2));
    }
}
await main().catch((error: Error) => { console.error(JSON.stringify({ errorCode: error.name, stage: 'preflight' })); process.exitCode = 1; });
