// Builds the integrated browser product without legacy APIs or analytics.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
// The build id hashes the src/Next tree only, path then bytes per file in name order. desktop/runtime.mjs,
// whose bytes were appended last, left with native dispatch (fm-be10), so build ids changed from that revision.
function buildIdInputs(folder=path.join(root,'src/Next'),found=[]){for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(folder,entry.name);if(entry.isDirectory())buildIdInputs(file,found);else if(/\.(fs|mjs|scss)$/.test(file))found.push(path.relative(root,file));}return found;}
function buildId(files=buildIdInputs()){const hash=crypto.createHash('sha256');for(const file of files){hash.update(file);hash.update(fs.readFileSync(path.join(root,file)));}return 'next-'+hash.digest('hex').slice(0,16);}
module.exports={buildIdInputs,buildId};
if(require.main===module){
function sourceSha(){
 if(/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA||''))return process.env.GITHUB_SHA;
 const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
 if(head.status!==0)return 'unknown';
 const dirty=spawnSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'});
 return head.stdout.trim()+(dirty.stdout&&dirty.stdout.trim()?'-dirty':'');
}
const env={...process.env,FACEMORPH_SOURCE_SHA:sourceSha(),FACEMORPH_BUILD_ID:buildId(),FACEMORPH_NEXT:'1',FACEMORPH_SELF_HOST:'0',FACEMORPH_TRIAL:'0',FACEMORPH_REVIEW:'0',FACEMORPH_TRIAL_URL:''};
// Fable emits imports straight from [<Import>] attributes and cannot see whether the JavaScript
// side still exports that name; webpack only warns, then bundles `undefined`. That is how the
// whole photo path shipped dead. The check runs between fable and webpack, so a rename fails
// the build instead of the user's first tap.
for(const [command,args] of [['dotnet',['tool','restore']],['dotnet',['fable','./src']],[process.execPath,[path.join(__dirname,'check-bridge-imports.mjs')]],[process.execPath,[path.join(__dirname,'check-progress-copy.mjs')]],[process.execPath,[require.resolve('webpack-cli/bin/cli.js'),'--config','webpack.config.js']]]){
 const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
// The names and seed gallery index is part of what visitors run, so it is part of the artifact:
// covered by SHA256SUMS, served by the qualification server, scanned by the no-third-party gate,
// and compared at promotion. It used to be added only by stage.py at promotion time, so a local
// build had no names at all (audit A-4) and nothing CI qualified was the catalogue that shipped.
fs.copyFileSync(path.join(root,'hosting/next-static/catalogue.json'),path.join(root,'deploy-next/catalogue.json'));
}
