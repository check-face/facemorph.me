// Builds the integrated browser/desktop product without legacy APIs or analytics.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const hash=crypto.createHash('sha256');
function sourceTree(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(folder,entry.name);if(entry.isDirectory())sourceTree(file);else if(/\.(fs|mjs|scss)$/.test(file)){hash.update(path.relative(root,file));hash.update(fs.readFileSync(file));}}}
sourceTree(path.join(root,'src/Next'));hash.update(fs.readFileSync(path.join(root,'desktop/runtime.mjs')));
const env={...process.env,FACEMORPH_BUILD_ID:'next-'+hash.digest('hex').slice(0,16),FACEMORPH_NEXT:'1',FACEMORPH_SELF_HOST:'0',FACEMORPH_TRIAL:'0',FACEMORPH_REVIEW:'0',FACEMORPH_TRIAL_URL:''};
// Fable emits imports straight from [<Import>] attributes and cannot see whether the JavaScript
// side still exports that name; webpack only warns, then bundles `undefined`. That is how the
// whole photo path shipped dead. The check runs between fable and webpack, so a rename fails
// the build instead of the user's first tap.
for(const [command,args] of [['dotnet',['tool','restore']],['dotnet',['fable','./src']],[process.execPath,[path.join(__dirname,'check-bridge-imports.mjs')]],[process.execPath,[path.join(__dirname,'check-progress-copy.mjs')]],[process.execPath,[require.resolve('webpack-cli/bin/cli.js'),'--config','webpack.config.js']]]){
 const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
