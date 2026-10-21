import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
export async function buildControls(){
 await build({entryPoints:[path.join(root,'src/reader-controls.jsx')],outfile:path.join(root,'js/reader-controls.js'),bundle:true,format:'esm',platform:'browser',target:['es2020','safari15'],minify:true,legalComments:'inline',define:{'process.env.NODE_ENV':'"production"'}});
 const names=['liquid-gooey','react','react-dom','scheduler'];
 const licenses=await Promise.all(names.map(async name=>`${name}\n${await readFile(path.join(root,'node_modules',name,'LICENSE'),'utf8')}`));
 await writeFile(path.join(root,'js/reader-controls.LICENSE.txt'),licenses.join('\n\n'));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await buildControls();
