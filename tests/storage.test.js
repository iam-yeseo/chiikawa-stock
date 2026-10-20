import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createVault, atomicWrite, createAtomicWriter } from '../electron/storage.js';

test('vault stores only encrypted bytes and clears disk and cached credentials', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-vault-'));
  const key=randomBytes(32), iv=randomBytes(16);
  const cryptoMock={
    isEncryptionAvailable:()=>true,
    encryptString(plain){const cipher=createCipheriv('aes-256-cbc',key,iv);return Buffer.concat([cipher.update(plain),cipher.final()]);},
    decryptString(encrypted){const cipher=createDecipheriv('aes-256-cbc',key,iv);return Buffer.concat([cipher.update(encrypted),cipher.final()]).toString();}
  };
  try {
    const vault=createVault(directory,cryptoMock);
    await vault.save({clientId:'test-client',clientSecret:'test-secret-not-a-real-key'});
    const bytes=await readFile(path.join(directory,'credentials.enc'));
    assert.equal(bytes.includes('test-secret'),false);
    assert.deepEqual(await createVault(directory,cryptoMock).read(),{clientId:'test-client',clientSecret:'test-secret-not-a-real-key'});
    await vault.clear();assert.equal(await vault.exists(),false);assert.equal(await vault.read(),null);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('vault refuses plaintext fallback and rejects malformed credentials',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-vault-'));
  try{
    const vault=createVault(directory,{isEncryptionAvailable:()=>false});
    await assert.rejects(vault.save({clientId:'abc',clientSecret:'def'}),/보안 저장소/);
    await assert.rejects(vault.save({clientId:'',clientSecret:'def'}),/형식/);
    assert.equal(await vault.exists(),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('concurrent atomic settings writes preserve call order and leave no temporary files',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-writes-'));
  const filename=path.join(directory,'session.json');
  try{
    await Promise.all(Array.from({length:20},(_,sequence)=>atomicWrite(filename,JSON.stringify({sequence,mode:sequence%2?'demo':'live'}))));
    assert.deepEqual(JSON.parse(await readFile(filename,'utf8')),{sequence:19,mode:'demo'});
    assert.deepEqual(await readdir(directory),['session.json']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('atomic writes serialize one target while unrelated files can finish independently',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-write-order-'));
  const target=path.join(directory,'session.json'), other=path.join(directory,'settings.json');
  let releaseFirst, firstEntered;
  const gate=new Promise(resolve=>{releaseFirst=resolve;});
  const entered=new Promise(resolve=>{firstEntered=resolve;});
  const started=[];
  const write=createAtomicWriter({fileSystem:{...fs,async writeFile(filename,data,options){
    started.push(data);
    if(data==='first'){firstEntered();await gate;}
    return fs.writeFile(filename,data,options);
  }}});
  const first=write(target,'first');
  try{
    await entered;
    const second=write(path.join(directory,'.','session.json'),'second');
    await write(other,'independent');
    assert.deepEqual(started,['first','independent']);
    releaseFirst();
    await Promise.all([first,second]);
    assert.equal(await readFile(target,'utf8'),'second');
    assert.deepEqual((await readdir(directory)).sort(),['session.json','settings.json']);
  }finally{releaseFirst();await first.catch(()=>{});await rm(directory,{recursive:true,force:true});}
});

test('Windows rename retries transient locks while preserving the old complete file',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-write-retry-'));
  const filename=path.join(directory,'session.json');
  const delays=[], codes=['EPERM','EACCES','EBUSY'];
  let attempts=0;
  const write=createAtomicWriter({
    platform:'win32',
    wait:async delay=>{delays.push(delay);assert.equal(await readFile(filename,'utf8'),'previous');},
    fileSystem:{...fs,async rename(from,to){
      assert.equal(await readFile(filename,'utf8'),'previous');
      const code=codes[attempts++];
      if(code)throw Object.assign(new Error('temporary lock'),{code});
      return fs.rename(from,to);
    }}
  });
  try{
    await writeFile(filename,'previous');
    await write(filename,'latest');
    assert.equal(attempts,4);
    assert.deepEqual(delays,[25,50,100]);
    assert.equal(await readFile(filename,'utf8'),'latest');
    assert.deepEqual(await readdir(directory),['session.json']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('exhausted Windows rename retries preserve the previous file and unblock the next queued write',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-write-exhausted-'));
  const filename=path.join(directory,'session.json');
  const delays=[];
  let attempts=0;
  const write=createAtomicWriter({
    platform:'win32',
    wait:async delay=>{delays.push(delay);},
    fileSystem:{...fs,async rename(from,to){
      if(await readFile(from,'utf8')==='blocked'){
        attempts++;
        assert.equal(await readFile(to,'utf8'),'previous');
        throw Object.assign(new Error('still locked'),{code:'EPERM'});
      }
      return fs.rename(from,to);
    }}
  });
  try{
    await writeFile(filename,'previous');
    const rejected=assert.rejects(write(filename,'blocked'),{code:'EPERM'});
    const next=write(filename,'recovered');
    await rejected;
    await next;
    assert.equal(attempts,6);
    assert.deepEqual(delays,[25,50,100,200,400]);
    assert.equal(await readFile(filename,'utf8'),'recovered');
    assert.deepEqual(await readdir(directory),['session.json']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('non-Windows permission failures and permanent Windows errors do not retry or delete the old file',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-write-permanent-'));
  const filename=path.join(directory,'session.json');
  try{
    await writeFile(filename,'previous');
    for(const [platform,code] of [['darwin','EPERM'],['win32','ENOSPC']]){
      let attempts=0;
      const write=createAtomicWriter({
        platform,
        wait:()=>assert.fail('permanent error must not be retried'),
        fileSystem:{...fs,async rename(){attempts++;throw Object.assign(new Error('rename failed'),{code});}}
      });
      await assert.rejects(write(filename,'new'),{code});
      assert.equal(attempts,1);
      assert.equal(await readFile(filename,'utf8'),'previous');
      assert.deepEqual(await readdir(directory),['session.json']);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a temporary-file write failure leaves the old destination intact and permits a later save',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-write-failure-'));
  const filename=path.join(directory,'session.json');
  let renames=0;
  const write=createAtomicWriter({fileSystem:{...fs,
    async writeFile(filename,data,options){
      if(data==='broken'){
        await fs.writeFile(filename,'partial',options);
        throw Object.assign(new Error('disk full'),{code:'ENOSPC'});
      }
      return fs.writeFile(filename,data,options);
    },
    async rename(from,to){renames++;return fs.rename(from,to);}
  }});
  try{
    await writeFile(filename,'previous');
    await assert.rejects(write(filename,'broken'),{code:'ENOSPC'});
    assert.equal(renames,0);
    assert.equal(await readFile(filename,'utf8'),'previous');
    assert.deepEqual(await readdir(directory),['session.json']);
    await write(filename,'recovered');
    assert.equal(await readFile(filename,'utf8'),'recovered');
  }finally{await rm(directory,{recursive:true,force:true});}
});
