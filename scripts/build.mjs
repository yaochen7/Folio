import {cp,mkdir,rm,access,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildControls} from './build-controls.mjs';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'dist');
await buildControls();
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const item of ['index.html','favicon.svg','css','js','fonts'])await cp(path.join(root,item),path.join(output,item),{recursive:true});
try{await access(path.join(root,'firebase-config.json'));await cp(path.join(root,'firebase-config.json'),path.join(output,'firebase-config.json'));}catch{await writeFile(path.join(output,'firebase-config.json'),'{}\n');}
console.log('Built Folio static site in dist/.');
