const fs=require('node:fs'),path=require('node:path');
for(const name of ['hr-tests.txt','full-tests.txt','browser-tests.txt','qa-build.txt','types.txt','lint.txt']){
 const file='output/ees-hr-v7/'+name;if(!fs.existsSync(file))continue;
 const text=fs.readFileSync(file,'utf8');console.log(name);
 console.log(name.includes('tests')?text.match(/^ℹ.*$/gm)?.join('\n')??text.slice(-2200):text.slice(-1200));
}
const output=[];function scan(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())scan(file);else if(/\.tsx?$/.test(file)){const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);lines.forEach((line,index)=>{if(/\.from\(["']drivers["']\)/.test(line)){const block=lines.slice(index,index+9).join('\n');if(/\.update\(|\.delete\(|\.insert\(/.test(block))output.push(file+':'+(index+1)+'\n'+block);}});}}}scan('app');scan('lib');fs.writeFileSync('output/ees-hr-v7/driver-write-audit.txt',output.join('\n\n'));
