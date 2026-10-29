// Use the same legacy Windows PowerShell executable as start.bat, not pwsh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'start-server.ps1');
assert.ok([...fs.readFileSync(script)].every(byte=>byte<128),
  'Launcher must stay ASCII for BOM-free Windows PowerShell 5.1 compatibility');
// Background services can retain inherited pipe handles on Windows. Use files
// so the test waits for the launcher itself, not for the service to shut down.
const logs=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-launcher-'));
const stdout=fs.openSync(path.join(logs,'stdout.log'),'w');
const stderr=fs.openSync(path.join(logs,'stderr.log'),'w');
let result;
try { result=spawnSync('powershell.exe',[
  '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-NoBrowser',
],{cwd:root,stdio:['ignore',stdout,stderr],timeout:60000,windowsHide:true});
} finally { fs.closeSync(stdout);fs.closeSync(stderr); }
result.stdout=fs.readFileSync(path.join(logs,'stdout.log'),'utf8');
result.stderr=fs.readFileSync(path.join(logs,'stderr.log'),'utf8');
assert.ifError(result.error);
assert.equal(result.status,0,result.stderr||result.stdout);
assert.match(result.stdout,/Server ready: http:\/\/127\.0\.0\.1:80\d\d\/index\.html/);
console.log('PASS: actual Windows PowerShell 5.1 launcher parses and reaches a healthy local filesystem service');
