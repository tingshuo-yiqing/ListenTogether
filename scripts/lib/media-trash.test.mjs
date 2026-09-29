import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listTrash,restoreTrash} from './media-trash.mjs';
async function fixture(fn) {
  const temp=await mkdtemp(join(tmpdir(),'lt-trash-')),media=join(temp,'media'),trash=join(temp,'trash');
  try {
    await mkdir(media);await mkdir(join(trash,'run'),{recursive:true});
    const entry={id:'a',title:'恢复测试',file:'a.mp3'},source=join(trash,'run','a.mp3');
    await writeFile(source,'audio');
    const row={id:'a',title:entry.title,catalogEntry:entry,moved:[{kind:'audio',from:join(media,'a.mp3'),to:source}]};
    await writeFile(join(trash,'run','manifest.jsonl'),JSON.stringify(row)+'\n');
    const key=(await listTrash(trash)).items[0].key;
    await fn({temp,media,trash,row,key,source,options:{trashDir:trash,mediaDir:media,run:'run',key,entries:[],validate:async()=>{},commit:async()=>{}}});
  } finally {await rm(temp,{recursive:true,force:true});}
}
test('恢复：坏库在复制前被拒绝；校验失败撤销新文件，回收原件不变', async()=>{
  await fixture(async({media,source,options})=>{
    await assert.rejects(restoreTrash({...options,validate:async()=>{throw new Error('坏库');}}),/坏库/);
    await assert.rejects(access(join(media,'a.mp3')));
    await assert.rejects(restoreTrash({...options,commit:async()=>{throw new Error('写入后校验未通过，已回滚');}}),/已回滚/);
    await assert.rejects(access(join(media,'a.mp3')));assert.equal(await readFile(source,'utf8'),'audio');
  });
});
test('恢复：原ID已存在不动文件；篡改清单不能读取回收目录外文件', async()=>{
  await fixture(async({media,trash,row,options})=>{
    await assert.rejects(restoreTrash({...options,entries:[row.catalogEntry]}),/ID/);
    await assert.rejects(access(join(media,'a.mp3')));
    row.moved[0].to=join(media,'secret');await writeFile(join(media,'secret'),'private');
    await writeFile(join(trash,'run','manifest.jsonl'),JSON.stringify(row)+'\n');
    const key=(await listTrash(trash)).items[0].key;
    await assert.rejects(restoreTrash({...options,key}),/越出/);
    assert.equal(await readFile(join(media,'secret'),'utf8'),'private');
  });
});
test('恢复：一个坏批次不阻止其他回收记录展示', async()=>{
  await fixture(async({trash})=>{
    await mkdir(join(trash,'bad'));await writeFile(join(trash,'bad','manifest.jsonl'),'{broken');
    const r=await listTrash(trash);assert.equal(r.items.length,1);assert.equal(r.errors.length,1);assert.equal(r.errors[0].run,'bad');
  });
});
