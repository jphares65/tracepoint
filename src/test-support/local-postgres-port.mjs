import {createServer} from 'node:net';
// Ask the OS for an available IPv4 loopback port instead of guessing inside
// Windows/Hyper-V reserved ranges. Only disposable local tests use this helper.
/** @returns {Promise<number>} */
export function localPostgresPort(){return new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen({host:'127.0.0.1',port:0},()=>{const address=server.address();if(!address||typeof address==='string'){server.close();reject(Error('No local test port'));return;}server.close(error=>error?reject(error):resolve(address.port));});});}
