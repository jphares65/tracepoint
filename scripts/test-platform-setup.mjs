// Some restricted Windows environments deny the OS user lookup used by tsx.
// This affects only the local test runner's temporary directory, never app auth.
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
try {os.userInfo();} catch {
  os.userInfo=()=>({uid:-1,gid:-1,username:'local-test',homedir:os.tmpdir(),shell:null});
  syncBuiltinESMExports();
}
