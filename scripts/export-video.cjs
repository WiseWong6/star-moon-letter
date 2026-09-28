/* 确定性导出：页面内 OfflineAudioContext 离线烘焙音频，seek 驱动 paint() 逐帧截屏合成 MP4。
   运行：node scripts/export-video.cjs（需本机 Playwright 与 ffmpeg） */
'use strict';
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process'), {once} = require('node:events');
const root = path.resolve(__dirname, '..');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/Users/wisewong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const FPS = 30, VIEW_W = 768, VIEW_H = 1024, SCALE = 2; // 截帧 1536×2048
const outDir = path.join(root, '交付文件');
const videoPath = path.join(outDir, '星月来信-3比4.mp4');
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(path.join(root, 'output/'), {recursive: true});

async function main() {
  const browser = await chromium.launch({headless: true});
  const work = fs.mkdtempSync(path.join(root, 'output/', 'export-'));
  try {
    const page = await browser.newPage({viewport: {width: VIEW_W, height: VIEW_H}, deviceScaleFactor: SCALE});
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('file://' + path.join(root, 'index.html'));
    // main 宽度公式内含 100svh-88px，会随播放条预留缩水；强制铺满 3:4 视口后再触发画布重建
    await page.addStyleTag({content: 'body{padding:0!important}main{width:100vw!important;height:100vh!important;max-width:none!important;aspect-ratio:auto!important}.playback{display:none!important}'});
    await page.waitForFunction(() => typeof playback !== 'undefined' && playback.ready === true, null, {timeout: 60000});
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { resize(); buildCycle(); playback.playing = false; paint(); });
    if (errors.length) throw Error(errors.join('\n'));

    const info = await page.evaluate(() => ({
      duration: playback.duration,
      theme: document.body.dataset.theme,
      events: sound.events.length,
      lastEnd: Math.max(0, ...sound.events.map(e => e.time + e.duration)),
      canvas: document.querySelector('#sky').width + 'x' + document.querySelector('#sky').height
    }));
    console.log(JSON.stringify(info));
    if (errors.length) throw Error(errors.join('\n'));

    const VD = Math.max(info.duration, info.lastEnd); // 视频覆盖完整时间线与最后一个音的收尾
    const frames = Math.round(VD * FPS);

    // ---- 页面内离线音频：复用 sound.schedule，只替换上下文与主链 ----
    await page.evaluate(duration => {
      const SR = 48000, total = Math.ceil((duration + 1.5) * SR);
      const off = new OfflineAudioContext(2, total, SR);
      const master = off.createGain(); master.gain.value = .6;
      const limiter = off.createDynamicsCompressor();
      limiter.threshold.value = -14; limiter.knee.value = 12; limiter.ratio.value = 4;
      limiter.attack.value = .006; limiter.release.value = .18;
      master.connect(limiter); limiter.connect(off.destination);
      const backup = {context: sound.context, master: sound.master, limiter: sound.limiter, voices: sound.voices};
      sound.context = off; sound.master = master; sound.limiter = limiter;
      sound.voices = {add() {}, delete() {}, clear() {}, has() {return false}, get size() {return 0}};
      for (const e of sound.events) sound.schedule(e, e.time, 1, 0);
      return off.startRendering().then(rendered => {
        Object.assign(sound, backup);
        const n = rendered.length, bytes = new Uint8Array(44 + n * 4), dv = new DataView(bytes.buffer);
        const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
        wstr(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); wstr(8, 'WAVEfmt ');
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
        dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
        wstr(36, 'data'); dv.setUint32(40, n * 4, true);
        const L = rendered.getChannelData(0), R = rendered.getChannelData(1);
        for (let i = 0; i < n; i++) {
          dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
          dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
        }
        window.__wavBytes = bytes;
        window.__wavChunks = Math.ceil(bytes.length / (3 * 1024 * 1024));
      });
    }, VD);
    const wavPath = path.join(work, 'audio.wav');
    const fd = fs.openSync(wavPath, 'w');
    for (let k = 0; k < await page.evaluate(() => window.__wavChunks); k++) {
      const part = await page.evaluate(i => {
        const bytes = window.__wavBytes.subarray(i * 3 * 1024 * 1024, (i + 1) * 3 * 1024 * 1024);
        let bin = ''; const step = 0x8000;
        for (let j = 0; j < bytes.length; j += step) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + step));
        return btoa(bin);
      }, k);
      fs.writeSync(fd, Buffer.from(part, 'base64'));
    }
    fs.closeSync(fd);
    await page.evaluate(() => { delete window.__wavBytes; delete window.__wavChunks; });
    console.log('音频已烘焙', fs.statSync(wavPath).size, '字节');

    // ---- 视频帧：seek + paint + 截屏，管道进 ffmpeg ----
    const log = fs.openSync(path.join(work, 'ffmpeg.log'), 'w');
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning',
      '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0', '-i', wavPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', String(VD), videoPath],
      {stdio: ['pipe', 'ignore', log]});
    const done = once(ff, 'close'); ff.stdin.on('error', () => {});
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      await page.evaluate(t => { playback.time = t; paint(); }, i / FPS);
      const shot = await page.screenshot({type: 'jpeg', quality: 95, clip: {x: 0, y: 0, width: VIEW_W, height: VIEW_H}});
      if (errors.length) throw Error(errors.join('\n'));
      if (!ff.stdin.write(shot)) await once(ff.stdin, 'drain');
      if (i % 90 === 0) console.log(`已截帧 ${i}/${frames}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
    }
    ff.stdin.end();
    const [code] = await done; fs.closeSync(log);
    if (code !== 0) throw Error(fs.readFileSync(path.join(work, 'ffmpeg.log'), 'utf8'));
    console.log('完成：' + videoPath);
  } finally {
    await browser.close(); fs.rmSync(work, {recursive: true, force: true});
  }
}
main().catch(e => {console.error(e); process.exitCode = 1;});
