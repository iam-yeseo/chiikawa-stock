import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createVault, atomicWrite } from '../electron/storage.js';

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

test('concurrent atomic settings writes leave one complete document and no temp collision',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'chii-writes-'));
  const filename=path.join(directory,'session.json');
  try{
    await Promise.all(Array.from({length:20},(_,sequence)=>atomicWrite(filename,JSON.stringify({sequence,mode:sequence%2?'demo':'live'}))));
    const result=JSON.parse(await readFile(filename,'utf8'));
    assert.ok(Number.isInteger(result.sequence));assert.ok(['demo','live'].includes(result.mode));
  }finally{await rm(directory,{recursive:true,force:true});}
});
