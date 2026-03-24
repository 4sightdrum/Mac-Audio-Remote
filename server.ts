import express from 'express';
import { createServer as createViteServer } from 'vite';
import { exec } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

const isMac = os.platform() === 'darwin';

// Helper to run shell commands
function runCommand(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    if (!isMac) {
      return resolve('');
    }
    exec(cmd, (error, stdout) => {
      if (error) {
        return resolve('');
      }
      resolve(stdout.trim());
    });
  });
}

// Mock state for non-Mac environments (like this cloud container)
let mockState = {
  outputVolume: 65,
  outputMuted: false,
  inputVolume: 80,
  currentOutput: 'MacBook Air Speakers',
  currentInput: 'MacBook Air Microphone',
  sampleRate: 48000,
  bitDepth: 24,
  outputs: [
    { id: 'out-1', name: 'MacBook Air Speakers', type: 'output' },
    { id: 'out-2', name: 'External Headphones', type: 'output' }
  ],
  inputs: [
    { id: 'in-1', name: 'MacBook Air Microphone', type: 'input' }
  ]
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get('/api/audio', async (req, res) => {
    if (isMac) {
      try {
        const outVol = await runCommand("osascript -e 'output volume of (get volume settings)'");
        const outMuted = await runCommand("osascript -e 'output muted of (get volume settings)'");
        const inVol = await runCommand("osascript -e 'input volume of (get volume settings)'");
        
        // Check if SwitchAudioSource CLI is installed
        const hasSwitchAudio = await runCommand('which SwitchAudioSource').then(r => r.length > 0);
        
        let outputs = mockState.outputs;
        let inputs = mockState.inputs;
        let currentOutput = mockState.currentOutput;
        let currentInput = mockState.currentInput;
        let currentSampleRate = mockState.sampleRate;
        let currentBitDepth = mockState.bitDepth;

        try {
          const getRateScript = path.join(os.tmpdir(), 'get_sample_rate.swift');
          if (!fs.existsSync(getRateScript)) {
            fs.writeFileSync(getRateScript, `
import CoreAudio
import Foundation
var id = AudioDeviceID(0)
var size = UInt32(MemoryLayout.size(ofValue: id))
var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
var rate = Float64(0)
var rateSize = UInt32(MemoryLayout.size(ofValue: rate))
var rateAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
AudioObjectGetPropertyData(id, &rateAddr, 0, nil, &rateSize, &rate)
print(Int(rate))
            `.trim());
          }
          const rateStr = await runCommand(`swift ${getRateScript}`);
          if (rateStr && !isNaN(parseInt(rateStr))) {
            currentSampleRate = parseInt(rateStr);
          }
        } catch (e) {
          console.error("Failed to get sample rate", e);
        }

        if (hasSwitchAudio) {
          const outRaw = await runCommand('SwitchAudioSource -a -t output');
          const inRaw = await runCommand('SwitchAudioSource -a -t input');
          currentOutput = await runCommand('SwitchAudioSource -c -t output');
          currentInput = await runCommand('SwitchAudioSource -c -t input');

          outputs = outRaw.split('\n').filter(Boolean).map((name, i) => ({ id: `out-${i}`, name, type: 'output' }));
          inputs = inRaw.split('\n').filter(Boolean).map((name, i) => ({ id: `in-${i}`, name, type: 'input' }));
        }

        res.json({
          outputVolume: parseInt(outVol) || 0,
          outputMuted: outMuted === 'true',
          inputVolume: parseInt(inVol) || 0,
          isMac: true,
          hasSwitchAudio,
          outputs,
          inputs,
          currentOutput,
          currentInput,
          sampleRate: currentSampleRate,
          bitDepth: currentBitDepth
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to get audio settings' });
      }
    } else {
      res.json({ ...mockState, isMac: false, hasSwitchAudio: false });
    }
  });

  app.post('/api/audio/volume', async (req, res) => {
    const { volume } = req.body;
    if (isMac) {
      await runCommand(`osascript -e 'set volume output volume ${volume}'`);
    } else {
      mockState.outputVolume = volume;
    }
    res.json({ success: true, volume });
  });

  app.post('/api/audio/mute', async (req, res) => {
    const { muted } = req.body;
    if (isMac) {
      await runCommand(`osascript -e 'set volume ${muted ? 'with' : 'without'} output muted'`);
    } else {
      mockState.outputMuted = muted;
    }
    res.json({ success: true, muted });
  });

  app.post('/api/audio/input-volume', async (req, res) => {
    const { volume } = req.body;
    if (isMac) {
      await runCommand(`osascript -e 'set volume input volume ${volume}'`);
    } else {
      mockState.inputVolume = volume;
    }
    res.json({ success: true, volume });
  });

  app.post('/api/audio/device', async (req, res) => {
    const { name, type } = req.body;
    if (isMac) {
      await runCommand(`SwitchAudioSource -t ${type} -s "${name}"`);
    } else {
      if (type === 'output') mockState.currentOutput = name;
      if (type === 'input') mockState.currentInput = name;
    }
    res.json({ success: true });
  });

  app.post('/api/audio/format', async (req, res) => {
    const { sampleRate, bitDepth } = req.body;
    if (isMac) {
      if (sampleRate) {
        try {
          const setRateScript = path.join(os.tmpdir(), 'set_sample_rate.swift');
          if (!fs.existsSync(setRateScript)) {
            fs.writeFileSync(setRateScript, `
import CoreAudio
import Foundation
guard CommandLine.arguments.count > 1, let newRate = Float64(CommandLine.arguments[1]) else { exit(1) }
var id = AudioDeviceID(0)
var size = UInt32(MemoryLayout.size(ofValue: id))
var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
var rate = newRate
let rateSize = UInt32(MemoryLayout.size(ofValue: rate))
var rateAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
AudioObjectSetPropertyData(id, &rateAddr, 0, nil, rateSize, &rate)
            `.trim());
          }
          await runCommand(`swift ${setRateScript} ${sampleRate}`);
        } catch (e) {
          console.error("Failed to set sample rate", e);
        }
      }
      if (bitDepth) mockState.bitDepth = bitDepth;
    } else {
      if (sampleRate) mockState.sampleRate = sampleRate;
      if (bitDepth) mockState.bitDepth = bitDepth;
    }
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
