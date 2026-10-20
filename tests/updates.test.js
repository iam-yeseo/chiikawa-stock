import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { UpdateController, manualRelease, RELEASE_REPOSITORY } from '../electron/updates.js';

function release(version='0.5.1', arch='arm64') {
  const name=`Meonjakju-${version}-mac-${arch}.zip`;
  return {tag_name:`v${version}`,draft:false,prerelease:false,assets:[{name,size:100,browser_download_url:`https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}/${name}`}]};
}
function controller(options={}) {
  return new UpdateController({version:'0.5.0',platform:'darwin',arch:'arm64',enabled:true,openExternal:async()=>{},...options});
}
test('Mac releases require newer stable versions and exact architecture plus repository asset',()=>{
  assert.equal(manualRelease(release(), '0.5.0','arm64').available,true);
  assert.equal(manualRelease(release('0.5.0'), '0.5.0','arm64').available,false);
  assert.equal(manualRelease(release('0.4.9'), '0.5.0','arm64').available,false);
  assert.throws(()=>manualRelease(release(), '0.5.0','x64'));
  for(const altered of [
    {...release(),draft:true},{...release(),prerelease:true},{...release(),tag_name:'v0.6.0-beta'},
    {...release(),assets:[{...release().assets[0],browser_download_url:'https://example.com/malware.zip'}]},
    {...release(),assets:[{...release().assets[0],size:0}]},
  ]) assert.throws(()=>manualRelease(altered,'0.5.0','arm64'));
});
test('Mac check is coalesced, downloads only verified asset, and never attempts installation',async()=>{
  let requests=0,opened=[],now=10;
  const c=controller({now:()=>now,fetchImpl:async(url,options)=>{
    requests++;assert.match(url,/api.github.com\/repos\/iam-yeseo\/chiikawa-stock\/releases\/latest$/);
    assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    return {ok:true,status:200,json:async()=>release()};
  },openExternal:async url=>opened.push(url)});
  await Promise.all([c.check(),c.check(),c.check()]);
  assert.equal(requests,1);assert.equal(c.getState().status,'available');
  await c.download();assert.deepEqual(opened,[release().assets[0].browser_download_url]);
  await c.install();assert.equal(c.getState().status,'available');
  await c.check();assert.equal(requests,1);
  now+=30_001;await c.check();assert.equal(requests,2);
});
test('Update errors never expose HTTP payloads or tokens and development runs never make requests',async()=>{
  const bad=controller({fetchImpl:async()=>{throw new Error('secret-token private-host');}});
  await bad.check();assert.equal(bad.getState().status,'error');
  assert.doesNotMatch(JSON.stringify(bad.getState()),/secret-token|private-host/);
  let requests=0;
  const disabled=controller({enabled:false,fetchImpl:async()=>{requests++;}});
  disabled.start();await disabled.check();await disabled.download();await disabled.install();disabled.dispose();
  assert.equal(requests,0);assert.equal(disabled.getState().status,'disabled');
});
test('Missing GitHub release gives a useful no-new-release state',async()=>{
  const c=controller({fetchImpl:async()=>({ok:false,status:404})});
  await c.check();assert.equal(c.getState().status,'current');
  assert.equal(c.getState().latestVersion,null);
});
test('Windows downloads and installs only on explicit calls after verified updater events',async()=>{
  const updater=new EventEmitter();
  let checks=0,downloads=0,installs=0,prepared=0;
  updater.checkForUpdates=async()=>{checks++;updater.emit('update-available',{version:'0.5.1'});};
  updater.downloadUpdate=async()=>{downloads++;updater.emit('download-progress',{percent:55});updater.emit('update-downloaded',{version:'0.5.1'});};
  updater.quitAndInstall=(silent,relaunch)=>{assert.equal(silent,false);assert.equal(relaunch,true);assert.equal(prepared,1);installs++;};
  const c=controller({platform:'win32',updater,beforeInstall:async()=>{prepared++;}});
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.allowDowngrade,false);
  await c.install();assert.equal(installs,0);
  await c.check();assert.equal(checks,1);assert.equal(downloads,0);
  await c.download();assert.equal(downloads,1);assert.equal(c.getState().status,'downloaded');
  await c.check();assert.equal(checks,1,'a ready installer is retained');
  await Promise.all([c.install(),c.install()]);assert.equal(installs,1);
  c.dispose();assert.equal(updater.listenerCount('error'),0);
});
test('Windows rejects a mismatched downloaded version instead of offering installation',async()=>{
  const updater=new EventEmitter(),c=controller({platform:'win32',updater});
  updater.emit('update-available',{version:'0.5.1'});
  updater.emit('update-downloaded',{version:'0.5.2'});
  assert.equal(c.getState().status,'error');await c.install();c.dispose();
});
test('An emitted Windows installer failure allows retry and does not shut down monitoring',async()=>{
  const updater=new EventEmitter();
  let attempts=0;
  updater.quitAndInstall=()=>{attempts++;if(attempts===1)updater.emit('error',new Error('installer failure'));};
  const c=controller({platform:'win32',updater});
  for(let i=0;i<2;i++){
    updater.emit('update-available',{version:'0.5.1'});
    updater.emit('update-downloaded',{version:'0.5.1'});
    await c.install();
  }
  assert.equal(attempts,2);c.dispose();
});
