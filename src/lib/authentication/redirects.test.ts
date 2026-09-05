import assert from 'node:assert/strict';
import {test} from 'node:test';
import {internalAuthRedirect,configuredSiteOrigin} from './redirects';
test('authentication redirects reject browser-normalized external targets',()=>{
 for(const value of ['//outside.invalid','/\\outside.invalid','/%5coutside.invalid','/%2foutside.invalid','/%09/outside.invalid','https://outside.invalid','/%zz','/%00outside'])assert.equal(internalAuthRedirect(value,'/auth/setup'),'/auth/setup');
 assert.equal(internalAuthRedirect('/equipment?tab=assigned#current'),'/equipment?tab=assigned#current');
 assert.equal(internalAuthRedirect('/auth/setup?next=/equipment'),'/auth/setup?next=/equipment');
});
test('authentication email origin comes from trusted HTTPS configuration',()=>{
 assert.equal(configuredSiteOrigin('https://staging.tracepointhq.com/'),'https://staging.tracepointhq.com');
 assert.equal(configuredSiteOrigin('https://tracepoint-amber.vercel.app'),'https://tracepoint-amber.vercel.app');
 for(const value of [undefined,'http://outside.invalid','https://user:password@outside.invalid','https://outside.invalid/path','https://outside.invalid?next=bad','https://outside.invalid:8443'])assert.throws(()=>configuredSiteOrigin(value),/trusted HTTPS/);
});
