import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
test('patched SheetJS preserves representative report/import data in an XLSX round trip',()=>{
 const rows=[{Officer:'Synthetic A',Badge:'0012',Date:'2026-09-04',Score:98,Qualified:true,Notes:'Quoted "text", newline\nnext'}];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'Qualifications');
 const restored=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 assert.deepEqual(XLSX.utils.sheet_to_json(restored.Sheets.Qualifications),rows);
});
