/* 确定性导出：固定随机种子，页面内 OfflineAudioContext 离线烘焙音频，seek 驱动 paint() 逐帧截屏合成 MP4。
   运行：node scripts/export-video.cjs（需本机 Playwright 与 ffmpeg）
   可选环境变量：EXPORT_SCALE=4 出 4K（3072×4096），默认 2；EXPORT_THEME=blue|ink 选配色，默认墨黑；
   EXPORT_OUT=文件名 覆盖输出名；EXPORT_LIMIT_SECONDS=秒 仅导出前若干秒（冒烟用）；
   EXPORT_SEED=数值 随机种子，默认 20261007。
   截帧写入 output/export-<名称>/，浏览器中途崩溃自动重开续拍；成功后清理工作目录。 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process'), {once} = require('node:events');
const root = path.resolve(__dirname, '..');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/Users/wisewong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const FPS = 30, VIEW_W = 768, VIEW_H = 1024, SCALE = Number(process.env.EXPORT_SCALE || 2); // 截帧 768×1024×SCALE
const THEME = process.env.EXPORT_THEME === 'blue' ? 'blue' : 'ink';
const SEED = Number(process.env.EXPORT_SEED || 20261007) | 0 || 1;
const outDir = path.join(root, '交付文件');
const outName = process.env.EXPORT_OUT
  || (SCALE === 2 && THEME === 'ink' ? '星月来信-3比4.mp4' : `星月来信-3比4${SCALE >= 4 ? '-4K' : ''}-${THEME === 'blue' ? '正蓝' : '墨黑'}.mp4`);
const videoPath = path.join(outDir, outName);
const work = path.join(root, 'output', 'export-' + path.basename(outName, '.mp4')); // 稳定目录，失败重跑可续拍
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(work, {recursive: true});
const framePath = i => path.join(work, 'frame-' + String(i).padStart(6, '0') + '.jpg');
const wavPath = path.join(work, 'audio.wav');

// 页面会话：种子固定后每次重建的星点、飞行路径完全一致，续拍帧与已拍帧无缝衔接
async function openSession(browser, errors) {
  const page = await browser.newPage({viewport: {width: VIEW_W, height: VIEW_H}, deviceScaleFactor: SCALE});
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(seed => {
    let s = seed | 0;
    Math.random = () => { s ^= s << 13; s |= 0; s ^= s >>> 17; s ^= s << 5; s |= 0; return (s >>> 0) / 4294967296; };
  }, SEED);
  await page.goto('file://' + path.join(root, 'index.html'));
  // main 宽度公式内含 100svh-88px，会随播放条预留缩水；强制铺满 3:4 视口后再触发画布重建
  await page.addStyleTag({content: 'body{padding:0!important}main{width:100vw!important;height:100vh!important;max-width:none!important;aspect-ratio:auto!important}.playback{display:none!important}'});
  await page.waitForFunction(() => typeof playback !== 'undefined' && playback.ready === true, null, {timeout: 60000});
  await page.evaluate(() => document.fonts.ready);
  // resize() 的画布 DPR 封顶 2，低于导出倍率；放开上限后重建，截帧才是原生 4K
  await page.evaluate(scale => {
    window.CANVAS_DPR_CAP = scale;
    resize(); buildCycle(); playback.playing = false; paint();
  }, SCALE);
  if (THEME !== 'ink') await page.evaluate(theme => {
    const select = document.querySelector('#play-theme');
    select.value = theme;
    select.dispatchEvent(new Event('change'));
  }, THEME);
  return page;
}

async function main() {
  // 已有帧取连续前缀，之后的残帧删除，从断点续拍
  let done = 0;
  while (fs.existsSync(framePath(done))) done++;
  for (const f of fs.readdirSync(work)) {
    if (/^frame-\d{6}\.jpg$/.test(f) && Number(f.slice(6, 12)) >= done) fs.unlinkSync(path.join(work, f));
  }
  let browser = await chromium.launch({headless: true});
  try {
    const setupErrors = [];
    const page = await openSession(browser, setupErrors);
    const info = await page.evaluate(() => ({
      duration: playback.duration,
      theme: document.body.dataset.theme,
      events: sound.events.length,
      lastEnd: Math.max(0, ...sound.events.map(e => e.time + e.duration)),
      canvas: document.querySelector('#sky').width + 'x' + document.querySelector('#sky').height
    }));
    console.log(JSON.stringify(info));
    if (setupErrors.length) throw Error(setupErrors.join('\n'));
    const VD = Math.min(process.env.EXPORT_LIMIT_SECONDS ? Number(process.env.EXPORT_LIMIT_SECONDS) : Infinity,
      info.duration); // 以作品声明时长为准；结尾由淡出收束
    const frames = Math.round(VD * FPS);

    // ---- 页面内离线音频：复用 sound.schedule，只替换上下文与主链（音频与主题、分辨率无关，烘焙一次即可） ----
    if (!fs.existsSync(wavPath)) {
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
    }
    await page.close();

    // ---- 视频帧：seek + paint + 截屏落盘；超时或崩溃则重开会话续拍，每 240 帧主动重开控制内存 ----
    const t0 = Date.now();
    for (let attempt = 1; done < frames; attempt++) {
      if (attempt > 1) {
        console.log(`浏览器重开续拍，从第 ${done}/${frames} 帧继续（第 ${attempt} 次会话）`);
        await browser.close().catch(() => {});
        browser = await chromium.launch({headless: true});
      }
      try {
        const errors = [];
        const sess = await openSession(browser, errors);
        const sessionStart = done;
        for (; done < frames; done++) {
          await sess.evaluate(t => { playback.time = t; paint(); }, done / FPS);
          const shot = await sess.screenshot({timeout: 180000, type: 'jpeg', quality: 95, clip: {x: 0, y: 0, width: VIEW_W, height: VIEW_H}});
          const tmp = framePath(done) + '.tmp';
          fs.writeFileSync(tmp, shot);
          fs.renameSync(tmp, framePath(done)); // 原子改名，避免中断留下半截帧
          if (errors.length) throw Error(errors.join('\n'));
          if (done % 90 === 0) console.log(`已截帧 ${done}/${frames}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
          if (done - sessionStart >= 240 && done < frames - 1) { console.log('主动重开会话控内存'); break; }
        }
        await sess.close();
      } catch (e) {
        console.error(`会话 ${attempt} 失败于帧 ${done}：${String(e).split('\n')[0]}`);
        if (attempt >= 40) throw e;
      }
    }

    // ---- 合成：帧序列 + 烘焙音频 ----
    const log = fs.openSync(path.join(work, 'ffmpeg.log'), 'w');
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning',
      '-framerate', String(FPS), '-start_number', '0', '-i', path.join(work, 'frame-%06d.jpg'), '-i', wavPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-vf', 'fade=t=out:st=' + (VD - 1).toFixed(2) + ':d=1',
      '-c:a', 'aac', '-b:a', '256k', '-af', 'afade=t=out:st=' + (VD - 1.6).toFixed(2) + ':d=1.6',
      '-movflags', '+faststart', '-t', String(frames / FPS), videoPath],
      {stdio: ['ignore', 'ignore', log]});
    const [code] = await once(ff, 'close'); fs.closeSync(log);
    if (code !== 0) throw Error(fs.readFileSync(path.join(work, 'ffmpeg.log'), 'utf8'));
    fs.rmSync(work, {recursive: true, force: true});
    console.log('完成：' + videoPath);
  } finally {
    await browser.close().catch(() => {});
  }
}
main().catch(e => {console.error(e); process.exitCode = 1;});
