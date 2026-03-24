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
  music: { state: 'paused', track: 'Bohemian Rhapsody', artist: 'Queen' },
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

  // Apple Music Routes
  app.get('/api/music', async (req, res) => {
    if (isMac) {
      try {
        const musicScript = path.join(os.tmpdir(), 'get_music.scpt');
        if (!fs.existsSync(musicScript)) {
          fs.writeFileSync(musicScript, `
tell application "System Events"
    if not (exists process "Music") then return "stopped"
end tell
tell application "Music"
    set pState to player state as string
    if pState is "playing" or pState is "paused" then
        set tName to name of current track
        set tArtist to artist of current track
        return pState & "|" & tName & "|" & tArtist
    else
        return pState
    end if
end tell
          `.trim());
        }
        const result = await runCommand(`osascript ${musicScript}`);
        if (result === 'stopped' || result === 'Not Running' || !result) {
          res.json({ state: 'stopped', track: '', artist: '' });
        } else {
          const [state, track, artist] = result.split('|');
          res.json({ state, track: track || '', artist: artist || '' });
        }
      } catch (e) {
        res.json({ state: 'error', track: '', artist: '' });
      }
    } else {
      res.json(mockState.music);
    }
  });

  app.post('/api/music/control', async (req, res) => {
    const { action } = req.body; // 'playpause', 'next track', 'previous track'
    if (isMac) {
      await runCommand(`osascript -e 'tell application "Music" to ${action}'`);
    } else {
      if (action === 'playpause') {
        mockState.music.state = mockState.music.state === 'playing' ? 'paused' : 'playing';
      }
    }
    res.json({ success: true });
  });

  app.post('/api/music/play', async (req, res) => {
    const { query } = req.body;
    try {
      // Search the global Apple Music catalog via iTunes Search API
      const searchRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`);
      const data = await searchRes.json();
      
      if (data.results && data.results.length > 0) {
        const track = data.results[0];
        // Convert https:// to music:// to force opening in the Music app
        const trackUrl = track.trackViewUrl.replace('https://', 'music://');
        
        if (isMac) {
          const script = `open location "${trackUrl}"\ndelay 1.5\ntell application "Music" to play`;
          await runCommand(`osascript -e '${script.split('\n').join("' -e '")}'`);
        } else {
          mockState.music.track = track.trackName;
          mockState.music.artist = track.artistName;
          mockState.music.state = 'playing';
        }
        res.json({ success: true, track: track.trackName, artist: track.artistName });
      } else {
        // Fallback to local library search if not found on Apple Music catalog
        if (isMac) {
          const safeQuery = query.replace(/"/g, '\\"');
          await runCommand(`osascript -e 'tell application "Music" to play track "${safeQuery}"'`);
        }
        res.json({ success: true });
      }
    } catch (err) {
      console.error("Search failed", err);
      res.status(500).json({ error: 'Search failed' });
    }
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
