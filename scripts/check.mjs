import {readdir,readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {buildControls} from './build-controls.mjs';
const root=path.resolve(import.meta.dirname,'..');
await buildControls();
for(const file of await readdir(path.join(root,'js'))){if(!file.endsWith('.js'))continue;const result=spawnSync(process.execPath,['--check',path.join(root,'js',file)],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
for(const file of ['firebase.json','firestore.indexes.json','firebase-config.example.json','firebase-config.json','.firebaserc'])JSON.parse(await readFile(path.join(root,file),'utf8'));
for(const file of ['index.html','css/site.css','css/reader.css','js/app.js','js/books.js','js/firebase-service.js','js/reader.js'])await stat(path.join(root,file));
const checks=spawnSync(process.execPath,['--test',path.join(root,'tests/firebase-service.test.mjs'),path.join(root,'tests/page-curl.test.mjs')],{stdio:'inherit'});if(checks.status!==0)process.exit(checks.status||1);
console.log('Folio source, Firebase adapter, and page motion checks passed.');
