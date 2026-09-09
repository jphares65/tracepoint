import {createHash} from 'node:crypto';
export function reviewedRefreshSchema(value){
 const source=value.replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
 const sha256=createHash('sha256').update(source).digest('hex');
 if(sha256!=='8246140481052917737950b18d9a4d1fd265272adbce937c39f17bd30e8d5bfe')throw Error('Refresh schema differs from reviewed additive migration.');
 return {source,sha256};
}
