/* 与画面共用事件时间；声音仅在用户主动开启后生成，全程不请求外部资源。 */
(() => {
  'use strict';

  const KINDS = new Set(['type', 'ripple', 'wind', 'flight', 'galaxy']);
  const DEFAULT_DURATION = {type: .075, ripple: 2.8, wind: 2.8, flight: 4.4, galaxy: 8};
  const LEVELS = {type: .1, ripple: .1, wind: .055, flight: .19, galaxy: .13};
  const SAMPLE_RATE = 24000;
  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  class StarLetterSound {
    constructor() {
      this.Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.supported = typeof this.Context === 'function';
      this.enabled = false;
      this.context = null;
      this.events = [];
      this.voices = new Set();
      this.buffers = new Map();
      this.anchor = null;
      this.frame = null;
      this.cursor = 0;
      this.requested = false;
      this.toggleId = 0;
      this.destroyed = false;
      this.hasVoices = false;
      this.lastStart = Object.create(null);
      this.eventsVersion = 0;
      this.preparedSignature = '';
      this.preparation = null;
      this.noiseReady = false;
    }

    create() {
      const context = this.context = new this.Context({latencyHint: 'interactive'});
      this.master = context.createGain();
      this.master.gain.value = .6;
      this.limiter = context.createDynamicsCompressor();
      this.limiter.threshold.value = -14;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 4;
      this.limiter.attack.value = .006;
      this.limiter.release.value = .18;
      this.master.connect(this.limiter);
      this.limiter.connect(context.destination);

      // 六秒固定噪声供所有短音共用，不运行常驻的振荡器或噪声节点。
      this.noise = new Float32Array(SAMPLE_RATE * 6);
    }

    *prepareNoise() {
      let seed = 4738291;
      for (let i = 0; i < this.noise.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        this.noise[i] = seed / 2147483648 - 1;
        if ((i + 1) % 2048 === 0) yield;
      }
      this.noiseReady = true;
    }

    async setEnabled(value) {
      const id = ++this.toggleId;
      this.requested = Boolean(value) && this.supported && !this.destroyed;
      if (!this.requested) {
        this.enabled = false;
        this.invalidate();
        this.cancelPreparation();
        this.suspendWhenIdle();
        return false;
      }
      try {
        if (!this.context) this.create();
        // 必须由按钮的用户操作直接调用，保留浏览器的音频解锁条件。
        await this.context.resume();
        // 波形逐小块准备，等待过程中画面的逐帧循环照常运行。
        while (id === this.toggleId && this.requested && !this.destroyed) {
          const rate = this.frame?.rate || 1;
          await this.prepare(rate);
          if (this.preparedSignature === `${this.eventsVersion}:${this.frame?.rate || 1}`) break;
        }
        if (id !== this.toggleId || this.destroyed) {
          this.suspendWhenIdle();
          return this.enabled;
        }
        this.enabled = this.requested && this.context.state === 'running';
        if (!this.enabled) this.requested = false;
        this.invalidate();
        if (this.enabled && this.frame) this.sync(this.frame);
        return this.enabled;
      } catch (_) {
        if (id === this.toggleId) {
          this.enabled = false;
          this.requested = false;
          this.invalidate();
          this.suspendWhenIdle();
        }
        return this.enabled;
      }
    }

    setEvents(events) {
      this.events = (Array.isArray(events) ? events : [])
        .filter(event => event && KINDS.has(event.kind) && Number.isFinite(event.time) && event.time >= 0)
        .map(event => ({
          time: event.time,
          kind: event.kind,
          duration: clamp(finite(event.duration, DEFAULT_DURATION[event.kind]), .055, 8),
          gain: clamp(finite(event.gain, 1), 0, 2),
          pan: clamp(finite(event.pan, 0), -1, 1),
          panTo: clamp(finite(event.panTo, finite(event.pan, 0)), -1, 1),
          pitch: Math.round(clamp(finite(event.pitch, 0), -24, 24) * 2) / 2
        }))
        .sort((a, b) => a.time - b.time);
      ++this.eventsVersion;
      this.preparedSignature = '';
      // 换配色、重播或改文案时，上一组已排程的声音随即退出。
      this.invalidate();
      if (this.requested && this.context) this.prepare(this.frame?.rate || 1);
    }

    suspendWhenIdle() {
      if (!this.requested && this.context && !this.voices.size && this.context.state === 'running') {
        Promise.resolve(this.context.suspend()).catch(() => {});
      }
    }

    invalidate() {
      const context = this.context;
      if (context && this.hasVoices) {
        const now = context.currentTime;
        for (const voice of this.voices) {
          if (voice.stopped) continue;
          voice.stopped = true;
          // 十二毫秒收声，避免暂停和拖动时出现咔嗒声。
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.linearRampToValueAtTime(0, now + .012);
          try { voice.source.stop(now + .014); } catch (_) { /* 声源已结束。 */ }
        }
      }
      this.hasVoices = false;
      this.anchor = null;
      this.cursor = 0;
      this.lastStart = Object.create(null);
    }

    bufferKey(event, rate) {
      return `${event.kind}:${Math.round(event.duration / rate * 1000) / 1000}:${event.pitch}`;
    }

    bufferFor(event, rate) {
      // 画面回调里的调度只读取缓存，绝不在这里同步计算声音。
      return this.buffers.get(this.bufferKey(event, rate)) || null;
    }

    cancelPreparation() {
      if (!this.preparation) return;
      clearTimeout(this.preparation.timer);
      this.preparation.resolve(false);
      this.preparation = null;
    }

    prepare(rate) {
      const signature = `${this.eventsVersion}:${rate}`;
      if (this.preparedSignature === signature) return Promise.resolve(true);
      if (this.preparation?.signature === signature) return this.preparation.promise;
      this.cancelPreparation();
      const unique = new Map();
      for (const event of this.events) {
        const key = this.bufferKey(event, rate);
        if (!this.buffers.has(key)) unique.set(key, event);
        else {
          // 本轮会用到的旧缓存移到队尾，避免补新音色时把它们淘汰。
          const buffer = this.buffers.get(key);
          this.buffers.delete(key);
          this.buffers.set(key, buffer);
        }
      }
      const job = {signature, rate, entries: [...unique], index: 0, generator: null, noise: false, timer: null};
      job.promise = new Promise(resolve => { job.resolve = resolve; });
      this.preparation = job;
      const step = () => {
        if (this.preparation !== job || this.destroyed || !this.requested) return;
        try {
          if (!job.generator) {
            if (!this.noiseReady) {
              job.noise = true;
              job.generator = this.prepareNoise();
            } else if (job.index < job.entries.length) {
              job.noise = false;
              job.generator = this.renderSamples(job.entries[job.index][1], rate);
            } else {
              this.preparedSignature = signature;
              this.preparation = null;
              job.resolve(true);
              if (this.enabled) {
                this.invalidate();
                if (this.frame) this.sync(this.frame);
              }
              return;
            }
          }
          const result = job.generator.next();
          if (result.done) {
            if (!job.noise) {
              const data = result.value;
              const buffer = this.context.createBuffer(1, data.length, SAMPLE_RATE);
              buffer.getChannelData(0).set(data);
              if (this.buffers.size >= 48) this.buffers.delete(this.buffers.keys().next().value);
              this.buffers.set(job.entries[job.index][0], buffer);
              ++job.index;
            }
            job.generator = null;
          }
          // 音色每次计算 1024 个采样，噪声底和归一化最多 2048 个，减少准备时卡顿。
          job.timer = setTimeout(step, 0);
        } catch (_) {
          this.preparation = null;
          this.requested = false;
          this.enabled = false;
          this.invalidate();
          this.suspendWhenIdle();
          job.resolve(false);
        }
      };
      job.timer = setTimeout(step, 0);
      return job.promise;
    }

    *renderSamples(event, rate) {
      // 倍速只改变音效时长，飞行与星河的音高保持。
      const duration = Math.round(event.duration / rate * 1000) / 1000;
      const length = Math.max(2, Math.round(duration * SAMPLE_RATE));
      const data = new Float32Array(length);
      const pitch = 2 ** (event.pitch / 12);
      const noiseOffset = Math.floor((event.pitch + 25) * 977) % this.noise.length;
      // 星河是一片互相交叠的柔音颗粒；每粒缓缓亮起，没有敲钟式音头。
      const grains = [];
      if (event.kind === 'galaxy') {
        let seed = 8941 + Math.round((event.pitch + 24) * 631);
        const next = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;return seed / 4294967296;};
        const notes = [523.251, 587.33, 659.255, 783.991, 1046.502, 1174.66, 1318.51];
        for (let j = 0; j < 32; j++) grains.push({
          at: next() * .84, span: .10 + next() * .19,
          frequency: notes[Math.floor(next() * notes.length)] * pitch,
          phase: next() * TAU, level: .08 + next() * .13
        });
      }
      let low = 0, deep = 0, air = 0, peak = 0;
      for (let i = 0; i < length; i++) {
        const t = i / SAMPLE_RATE, u = i / (length - 1);
        const white = this.noise[(i + noiseOffset) % this.noise.length];
        const airCutoff = event.kind === 'wind' ? 700 + 650 * Math.sin(Math.PI * u) : 1900;
        low += (1 - Math.exp(-TAU * airCutoff / SAMPLE_RATE)) * (white - low);
        deep += (1 - Math.exp(-TAU * 105 / SAMPLE_RATE)) * (low - deep);
        air += (1 - Math.exp(-TAU * 3100 / SAMPLE_RATE)) * (white - air);
        let sample = 0;
        if (event.kind === 'type') {
          // 短键程按下与轻微回键，不叠加有音高的共鸣。
          const press = (1 - Math.exp(-u / .012)) * Math.exp(-u * 19);
          const releaseTime = Math.max(0, u - .31);
          const release = (1 - Math.exp(-releaseTime / .018)) * Math.exp(-releaseTime * 23) * .22;
          sample = ((low - deep) * .8 + (air - low) * .55) * (press + release);
        } else if (event.kind === 'ripple') {
          // 连续的轻水面声，从静止中升起，再散开；不再使用三次滴水敲击。
          const envelope = Math.sin(Math.PI * u) ** 2;
          const ripple = .8 + .2 * Math.sin(TAU * u * 2.4);
          sample = ((low - deep) * .46 + (air - low) * .025) * envelope * ripple;
        } else if (event.kind === 'wind') {
          const envelope = Math.sin(Math.PI * u) ** 2;
          const breath = .92 + .08 * Math.sin(TAU * u * 1.3);
          sample = (low - deep) * .5 * envelope * breath;
        } else if (event.kind === 'flight') {
          const envelope = Math.sin(Math.PI * u) ** 1.8 * (1 - .42 * u);
          // 空气中细软的一次掠过，轻微滑落的泛音留在噪声之下。
          const phase = TAU * pitch * (620 * t - 110 * t * t / duration);
          const silk = Math.sin(phase) * .045 + Math.sin(phase * 1.501 + .6) * .015;
          sample = ((low - deep) * .54 + (air - low) * .075 + silk) * envelope;
        } else if (event.kind === 'galaxy') {
          for (const grain of grains) {
            const q = (u - grain.at) / grain.span;
            if (q <= 0 || q >= 1) continue;
            const local = (u - grain.at) * duration;
            const envelope = Math.sin(Math.PI * q) ** 2;
            const tone = Math.sin(TAU * grain.frequency * local + grain.phase)
              + .06 * Math.sin(TAU * grain.frequency * 2.001 * local + grain.phase);
            sample += tone * envelope * grain.level;
          }
          // 整片缓慢起落，交叠后成为星河的余光，听不出规则的逐颗提示。
          sample *= Math.sin(Math.PI * u) ** 1.4;
        }
        // 每个缓存样本两端归零；短音的结束与中途暂停都不制造尖锐瞬变。
        const edge = Math.min(1, t / (event.kind === 'type' ? .001 : .004), (duration - t) / .025);
        data[i] = sample * Math.max(0, edge);
        peak = Math.max(peak, Math.abs(data[i]));
        if ((i + 1) % 1024 === 0) yield;
      }
      // 不将本来很轻的水声和风声强行放大到与飞行声一样响。
      const normalizer = peak > 0 ? .72 / Math.max(.38, peak) : 0;
      for (let i = 0; i < length; i++) {
        data[i] *= normalizer;
        if ((i + 1) % 2048 === 0) yield;
      }
      return data;
    }

    schedule(event, when, rate, offset = 0) {
      if (event.gain <= 0 || this.voices.size >= 14) return;
      const buffer = this.bufferFor(event, rate);
      if (!buffer) return;
      const remaining = buffer.duration - offset;
      if (remaining <= .025) return;
      const gap = event.kind === 'type' ? .12 : 0;
      if (when - (this.lastStart[event.kind] ?? -Infinity) < gap) return;
      this.lastStart[event.kind] = when;
      const context = this.context;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      const level = LEVELS[event.kind] * event.gain;
      gain.gain.value = offset > 0 ? 0 : level;
      if (offset > 0) {
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(level, when + .012);
      }
      const pan = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
      source.connect(gain);
      if (pan) {
        const from = clamp(event.pan, -.85, .85), to = clamp(event.panTo, -.85, .85);
        pan.pan.setValueAtTime(from + (to - from) * offset / source.buffer.duration, when);
        if (from !== to) pan.pan.linearRampToValueAtTime(to, when + remaining);
        gain.connect(pan);
        pan.connect(this.master);
      } else gain.connect(this.master);
      const voice = {source, gain, pan, stopped: false};
      this.voices.add(voice);
      this.hasVoices = true;
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (pan) pan.disconnect();
        this.voices.delete(voice);
        if (!this.voices.size) this.hasVoices = false;
        this.suspendWhenIdle();
      };
      source.start(when, offset);
    }

    sync(frame) {
      const time = Math.max(0, finite(frame?.time, 0));
      const rate = clamp(finite(frame?.rate, 1), .25, 4);
      const playing = Boolean(frame?.playing);
      this.frame = {time, rate, playing};
      if (this.requested && this.context && !this.destroyed) this.prepare(rate);
      if (!this.enabled || !this.context || this.destroyed) return;
      if (!playing || this.context.state !== 'running') {
        if (this.anchor || this.hasVoices) this.invalidate();
        return;
      }
      const now = this.context.currentTime;
      if (this.anchor) {
        const expected = this.anchor.time + (now - this.anchor.clock) * this.anchor.rate;
        if (rate !== this.anchor.rate || time < this.anchor.lastTime - .002 || Math.abs(time - expected) > .09 * rate) this.invalidate();
      }
      if (!this.anchor) {
        this.anchor = {time, clock: now, rate, lastTime: time};
        // 跳转后直接从新位置开始，不补播被越过的音效。
        let low = 0, high = this.events.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (this.events[middle].time < time - .000001) low = middle + 1;
          else high = middle;
        }
        this.cursor = low;
        // 暂停后续播或拖到中段，仅续上此刻尚未结束的长音。
        // 跳过的字音不补播；偏移也恢复水面、飞行和星河当时的左右位置。
        for (let i = low - 1; i >= 0; i--) {
          const event = this.events[i];
          if (event.time < time - 8) break;
          if (event.kind === 'type') continue;
          if (event.time + event.duration - time <= .04 * rate) continue;
          this.schedule(event, now + .004, rate, (time - event.time) / rate);
        }
      }
      this.anchor.lastTime = time;
      // 90 毫秒前瞻，由画面自己的逐帧循环推动，没有常驻计时器。
      while (this.cursor < this.events.length && this.events[this.cursor].time <= time + .09 * rate) {
        const event = this.events[this.cursor++];
        if (event.time < time - .045 * rate) continue;
        this.schedule(event, Math.max(now + .004, now + (event.time - time) / rate), rate);
      }
    }

    destroy() {
      this.destroyed = true;
      this.requested = false;
      this.enabled = false;
      ++this.toggleId;
      this.invalidate();
      this.cancelPreparation();
      for (const voice of this.voices) {
        voice.source.onended = null;
        try { voice.source.stop(); } catch (_) { /* 声源已结束。 */ }
        voice.source.disconnect();
        voice.gain.disconnect();
        if (voice.pan) voice.pan.disconnect();
      }
      this.voices.clear();
      this.buffers.clear();
      this.events = [];
      this.noise = null;
      this.frame = null;
      if (this.master) this.master.disconnect();
      if (this.limiter) this.limiter.disconnect();
      if (this.context && this.context.state !== 'closed') Promise.resolve(this.context.close()).catch(() => {});
    }
  }

  globalThis.StarLetterSound = StarLetterSound;
})();
