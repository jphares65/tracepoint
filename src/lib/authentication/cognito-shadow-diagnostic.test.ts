import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shadowCognitoDiagnostic} from './cognito-shadow-diagnostic';

test('callback diagnostics are emitted only in exact shadow mode with fixed sanitized fields', () => {
  const mode=process.env.TRACEPOINT_NOTIFICATION_MODE,site=process.env.NEXT_PUBLIC_SITE_URL;
  const original=console.warn,lines:string[]=[];
  console.warn=(line:string)=>{lines.push(line);};
  try{
    process.env.TRACEPOINT_NOTIFICATION_MODE='normal';
    process.env.NEXT_PUBLIC_SITE_URL='https://tracepointhq.com';
    shadowCognitoDiagnostic('identity_link_lookup',{mappingPresent:false});
    process.env.TRACEPOINT_NOTIFICATION_MODE='shadow';
    shadowCognitoDiagnostic('identity_link_lookup',{mappingPresent:false});
    assert.equal(lines.length,0);
    process.env.NEXT_PUBLIC_SITE_URL='https://shadow.tracepointhq.com';
    shadowCognitoDiagnostic('identity_link_lookup',{mappingPresent:false});
    assert.deepEqual(JSON.parse(lines[0]),{event:'shadow-cognito-callback-diagnostic',branch:'identity_link_lookup',mappingPresent:false});
    assert.equal(lines.length,1);
  }finally{
    console.warn=original;
    if(mode===undefined)delete process.env.TRACEPOINT_NOTIFICATION_MODE;else process.env.TRACEPOINT_NOTIFICATION_MODE=mode;
    if(site===undefined)delete process.env.NEXT_PUBLIC_SITE_URL;else process.env.NEXT_PUBLIC_SITE_URL=site;
  }
});
