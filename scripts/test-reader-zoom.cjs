const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
// Run with Electron after npm run build and npm run native:build.
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hondana-zoom-perf-'));
app.setPath('userData', profile);
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const core = require(path.join(root, 'native', `hondana_core.${process.platform}-${process.arch}${suffix}.node`));
const file = path.join(profile, 'Zoom performance.md');
fs.writeFileSync(file, '# Zoom performance\n\n' + Array.from({length:500}, (_, i) => `## Section ${i}\n\n` + ('Reading text with **bold**, *emphasis*, [a link](https://example.com) and a quiet paragraph.\n\n'.repeat(8))).join(''));
core.dispatch(path.join(profile, 'hondana.sqlite3'), 'import', JSON.stringify({paths:[file]}));
const timeout=setTimeout(()=>app.exit(2),90000);
app.on('browser-window-created', (_,win)=>win.webContents.once('did-finish-load',async()=>{
 try {
 const setup=await win.webContents.executeJavaScript(`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 for(let i=0;i<400&&!document.querySelector('.book-open');i++)await wait(50);
 document.querySelector('.book-open').click();
 for(let i=0;i<400&&!document.querySelector('.article-content h1');i++)await wait(50);
 await wait(600);
 return document.querySelectorAll('.article-content *').length;
 })()`);
 win.webContents.debugger.attach('1.3');
 await win.webContents.debugger.sendCommand('Performance.enable');
 const before=await win.webContents.debugger.sendCommand('Performance.getMetrics');
 const frames=await win.webContents.executeJavaScript(`(async()=>{
 const canvas=document.querySelector('.reading-canvas');canvas.scrollTop=8000;
 await new Promise(r=>setTimeout(r,100));
 const rect=canvas.getBoundingClientRect();const times=[];let last=performance.now();
 for(let i=0;i<90;i++){
 await new Promise(requestAnimationFrame);const now=performance.now();times.push(now-last);last=now;
 canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:i<45?-1:1,clientX:rect.left+200,clientY:rect.top+200}));
 }
 await new Promise(r=>setTimeout(r,400));
 const slow=times.map((ms,index)=>({ms,index})).filter(v=>v.ms>33.4); times.sort((a,b)=>a-b);
 return {slow,p50:times[45],p95:times[85],max:times[89],over33:times.filter(v=>v>33.4).length,frames:90};
 })()`);
 const after=await win.webContents.debugger.sendCommand('Performance.getMetrics');
 const map=new Map(before.metrics.map(m=>[m.name,m.value]));
 const metrics=Object.fromEntries(after.metrics.filter(m=>/^(LayoutCount|RecalcStyleCount|LayoutDuration|ScriptDuration|TaskDuration)$/.test(m.name)).map(m=>[m.name,m.value-map.get(m.name)]));
 console.log(JSON.stringify({nodes:setup,frames,metrics}));
 const checks = await win.webContents.executeJavaScript(`(async()=>{
   const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
   const assert = (value, message) => { if (!value) throw new Error(message); };
   const canvas = document.querySelector('.reading-canvas');
   const content = document.querySelector('.reader-zoom-content');
   const scale = () => new DOMMatrix(getComputedStyle(content).transform).a;
   const settle = async () => { for(let i=0;i<100 && canvas.dataset.zooming;i++) await wait(20); assert(!canvas.dataset.zooming, 'animation must settle'); };
   const click = label => document.querySelector('[aria-label="'+label+'"]').click();
   const wheel = (delta, ctrl=true, mode=0) => {
     const rect=canvas.getBoundingClientRect();
     const event = new WheelEvent('wheel', {bubbles:true,cancelable:true,ctrlKey:ctrl,deltaY:delta,deltaMode:mode,clientX:rect.left+150,clientY:rect.top+200});
     canvas.dispatchEvent(event);return event.defaultPrevented;
   };
   click('重置缩放');await settle();
   assert(Math.abs(scale()-1)<.00001, 'reset to 100%');
   assert(!wheel(-30,false), 'normal scrolling is not intercepted');
   await wait(30);assert(scale()===1, 'normal scroll does not zoom');
   canvas.scrollTop=8000;await wait(100);
   const rect=canvas.getBoundingClientRect();
   const anchorBefore=(rect.top+200-content.getBoundingClientRect().top)/scale();
   const layoutHeight=content.offsetHeight;
   const range=document.createRange();range.selectNodeContents(document.querySelector('.article-content h1'));
   const rangeHeight=range.getBoundingClientRect().height;
   assert(wheel(-20), 'prevent native browser zoom');
   await settle();
   const anchorAfter=(rect.top+200-content.getBoundingClientRect().top)/scale();
   assert(Math.abs(anchorAfter-anchorBefore)<1.1, 'zoom anchor must not drift');
   assert(content.offsetHeight===layoutHeight, 'zoom must not reflow book contents');
   assert(Math.abs(range.getBoundingClientRect().height/rangeHeight-scale())<.01, 'selection geometry scales correctly');
   for(let i=0;i<30;i++)wheel(-120);
   await settle();assert(scale()===3, 'maximum is 300%');
   assert(canvas.scrollWidth>canvas.clientWidth, 'can pan enlarged page horizontally');
   document.querySelectorAll('.article-content h2')[100].scrollIntoView({block:'start'});
   await wait(100);
   const headingTop=document.querySelectorAll('.article-content h2')[100].getBoundingClientRect().top;
   assert(headingTop>=canvas.getBoundingClientRect().top-1 && headingTop<canvas.getBoundingClientRect().bottom, 'outline navigation works when scaled');
   for(let i=0;i<30;i++)wheel(120);
   await settle();assert(scale()===.5, 'minimum is 50%');
   assert(canvas.scrollWidth<=canvas.clientWidth+1, 'no unscaled overflow when shrinking');
   click('重置缩放');await settle();
   click('放大');click('放大');click('放大');await settle();
   assert(Math.abs(scale()-1.3)<.00001, 'rapid button clicks accumulate');
   click('重置缩放');await settle();
   wheel(-1,true,1);await settle();assert(scale()>1, 'line-based wheels work');
   click('重置缩放');await settle();
   const image=document.createElement('img');image.width=400;image.height=200;
   image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="coral"/></svg>');
   content.appendChild(image);await wait(100);
   assert(document.querySelector('.reader-zoom-surface').offsetHeight>=content.offsetHeight-1, 'surface follows image/content size changes');
   click('放大');await settle();
   assert(Math.abs(image.getBoundingClientRect().width-440)<1, 'images scale with content');
   image.remove();click('重置缩放');await settle();
   return {functionalChecks:'passed',anchorError:Math.abs(anchorAfter-anchorBefore)};
 })()`);
 console.log(JSON.stringify(checks));
 await win.webContents.debugger.sendCommand('Input.synthesizePinchGesture', {x:700,y:300,scaleFactor:1.5,gestureSourceType:'mouse'});
 await new Promise(resolve=>setTimeout(resolve,500));
 const pinch=await win.webContents.executeJavaScript(`({scale:new DOMMatrix(getComputedStyle(document.querySelector('.reader-zoom-content')).transform).a,visualScale:visualViewport.scale})`);
 if(Math.abs(pinch.scale-1.5)>.02 || pinch.visualScale!==1)throw new Error('Native Chromium pinch failed: '+JSON.stringify(pinch));
 console.log('Chromium pinch passed:',JSON.stringify(pinch));
 win.setSize(1000,700);await new Promise(resolve=>setTimeout(resolve,200));
 const resized=await win.webContents.executeJavaScript(`(async()=>{
   for(let i=0;i<100;i++){
     if(Math.abs(document.querySelector('.reader-zoom-content').offsetWidth-document.querySelector('.reading-canvas').clientWidth)<=1)return true;
     await new Promise(resolve=>setTimeout(resolve,20));
   }
   return false;
 })()`);
 if(!resized)throw new Error('Zoom surface did not follow window resize');
 console.log('Resize passed');clearTimeout(timeout);app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
}));
require(path.join(root,'electron/main.cjs'));
