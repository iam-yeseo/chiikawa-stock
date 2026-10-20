import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const root=process.cwd();
const manifest=JSON.parse(await fs.readFile('package.json','utf8'));
const output=manifest.build?.directories?.output || 'release';
async function files(directory){
  const result=[];
  for(const item of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,item.name);
    if(item.isDirectory())result.push(...await files(file));else result.push(path.relative(root,file));
  }
  return result;
}
const packaged=[
  `${output}/mac-arm64/${manifest.build.executableName || manifest.productName}.app/Contents/Resources/app.asar`,
  `${output}/mac/${manifest.build.executableName || manifest.productName}.app/Contents/Resources/app.asar`,
  `${output}/win-unpacked/resources/app.asar`
];
const sourceFiles=(await Promise.all(['electron','lib','dist'].map(files))).flat().concat('assets/fonts/NOTICE.md');
const report=[];
for(const archive of packaged){
  const packageManifest=JSON.parse(asar.extractFile(archive,'package.json').toString('utf8'));
  if(packageManifest.version!==manifest.version)throw new Error(`${archive}: version mismatch`);
  const mismatches=[];
  for(const file of sourceFiles){
    const expected=await fs.readFile(file);
    const actual=asar.extractFile(archive,file);
    if(!expected.equals(actual))mismatches.push(file);
  }
  if(mismatches.length)throw new Error(`${archive}: source mismatch ${mismatches.join(',')}`);
  report.push({archive,version:packageManifest.version,verifiedFiles:sourceFiles.length,sourceMatch:true});
}
const artifacts=[];
for(const file of (await fs.readdir(output)).filter(name=>/\.(zip|exe)$/.test(name))){
  const bytes=await fs.readFile(path.join(output,file));
  artifacts.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await fs.mkdir('qa',{recursive:true});
await fs.writeFile('qa/package-integrity.json',JSON.stringify({at:new Date().toISOString(),packages:report,artifacts},null,2));
await fs.writeFile(path.join(output,'SHA256SUMS.txt'),artifacts.map(item=>`${item.sha256}  ${item.file}`).join('\n')+'\n');
console.log(JSON.stringify({packages:report,artifacts},null,2));
