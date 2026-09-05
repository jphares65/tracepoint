import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManagedSesProvider } from './ses-managed-provider';
import type { SesFeedbackStore } from './ses-feedback';
const message={to:[{email:'synthetic@example.invalid'}],subject:'Synthetic',htmlContent:'<p>Test</p>',textContent:'Test'};
const department='11111111-1111-4111-8111-111111111111';
test('accepted send is correlated with resolved department and suppression is checked first',async()=>{
 const actions:string[]=[];
 const store:SesFeedbackStore={async isSuppressed(){actions.push('suppression');return false},async apply(){return 'applied'},async recordAcceptance(id,tenant,recipients){actions.push('persist');assert.equal(id,'accepted-1');assert.equal(tenant,department);assert.deepEqual(recipients,['synthetic@example.invalid']);}};
 const provider=new ManagedSesProvider({fromEmail:'sender@example.invalid',configurationSet:'synthetic',transport:{async send(){actions.push('send');return {MessageId:'accepted-1'}}}},store,department);
 assert.equal((await provider.send(message)).messageId,'accepted-1');assert.deepEqual(actions,['suppression','send','persist']);
});
test('acceptance persistence outage never retries an accepted message',async()=>{
 let sends=0;
 const store:SesFeedbackStore={async isSuppressed(){return false},async apply(){return 'applied'},async recordAcceptance(){throw Error('private diagnostic')}};
 const provider=new ManagedSesProvider({fromEmail:'sender@example.invalid',configurationSet:'synthetic',transport:{async send(){sends++;return {MessageId:'accepted-1'}}}},store,department);
 await assert.rejects(provider.send(message),/^Error: SES accepted the message but persistence is unconfirmed; reconcile before retry\.$/);assert.equal(sends,1);
});
