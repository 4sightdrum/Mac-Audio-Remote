import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2, VolumeX, Mic, MicOff, Settings, MonitorSpeaker, Headphones, Radio, Activity, Wifi, Smartphone, Laptop, AlertCircle, Info, Play, Pause, SkipForward, SkipBack, Search, Music as MusicIcon, Cast, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const SAMPLE_RATES = [44100, 48000, 88200, 96000];
const BIT_DEPTHS = [16, 24, 32];

type AudioDevice = { id: string; name: string; type: 'output' | 'input' };

export default function App() {
  const [volume, setVolume] = useState(65);
  const [isMuted, setIsMuted] = useState(false);
  const [inputVolume, setInputVolume] = useState(80);
  const [isInputMuted, setIsInputMuted] = useState(false);
  
  const [activeOutput, setActiveOutput] = useState('');
  const [activeInput, setActiveInput] = useState('');
  
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);

  const [sampleRate, setSampleRate] = useState(48000);
  const [bitDepth, setBitDepth] = useState(24);

  const [isConnected, setIsConnected] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [hasSwitchAudio, setHasSwitchAudio] = useState(false);

  // Music State
  const [musicState, setMusicState] = useState<'playing' | 'paused' | 'stopped' | 'error'>('stopped');
  const [currentTrack, setCurrentTrack] = useState('');
  const [currentArtist, setCurrentArtist] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'song' | 'album' | 'artist' | 'playlist'>('song');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [airplayDevices, setAirplayDevices] = useState<{name: string, selected: boolean, kind: string}[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  const fetchAudioState = useCallback(async () => {
    try {
      const res = await fetch('/api/audio');
      if (!res.ok) throw new Error('Network response was not ok');
      const data = await res.json();
      
      setVolume(data.outputVolume);
      setIsMuted(data.outputMuted);
      setInputVolume(data.inputVolume);
      setIsMac(data.isMac);
      setHasSwitchAudio(data.hasSwitchAudio);
      
      setOutputDevices(data.outputs || []);
      setInputDevices(data.inputs || []);
      setActiveOutput(data.currentOutput || '');
      setActiveInput(data.currentInput || '');
      setSampleRate(data.sampleRate || 48000);
      setBitDepth(data.bitDepth || 24);

      setIsConnected(true);
    } catch (err) {
      console.error("Failed to fetch audio state", err);
      setIsConnected(false);
    }
  }, []);

  const fetchMusicState = useCallback(async () => {
    try {
      const res = await fetch('/api/music');
      if (res.ok) {
        const data = await res.json();
        setMusicState(data.state);
        setCurrentTrack(data.track);
        setCurrentArtist(data.artist);
      }
    } catch (err) {
      console.error("Failed to fetch music state", err);
    }
  }, []);

  const fetchAirplayState = useCallback(async () => {
    try {
      const res = await fetch('/api/music/airplay');
      if (res.ok) {
        const data = await res.json();
        setAirplayDevices(data.devices);
      }
    } catch (err) {
      console.error("Failed to fetch airplay state", err);
    }
  }, []);

  useEffect(() => {
    fetchAudioState();
    fetchMusicState();
    fetchAirplayState();
    // Poll every 2 seconds to keep in sync if changed on the Mac directly
    const interval = setInterval(() => {
      fetchAudioState();
      fetchMusicState();
      fetchAirplayState();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchAudioState, fetchMusicState, fetchAirplayState]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const delay = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/music/search?term=${encodeURIComponent(searchQuery)}&type=${searchType}`);
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch (e) {
        console.error("Search failed", e);
      }
      setIsSearching(false);
    }, 400);
    return () => clearTimeout(delay);
  }, [searchQuery, searchType]);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateVolume = async (newVol: number) => {
    setVolume(newVol);
    if (isMuted) setIsMuted(false);
    try {
      await fetch('/api/audio/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: newVol })
      });
    } catch (err) {
      console.error("Failed to update volume", err);
    }
  };

  const updateMute = async (mute: boolean) => {
    setIsMuted(mute);
    try {
      await fetch('/api/audio/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: mute })
      });
    } catch (err) {
      console.error("Failed to update mute", err);
    }
  };

  const updateInputVolume = async (newVol: number) => {
    setInputVolume(newVol);
    try {
      await fetch('/api/audio/input-volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: newVol })
      });
    } catch (err) {
      console.error("Failed to update input volume", err);
    }
  };

  const updateDevice = async (name: string, type: 'output' | 'input') => {
    if (type === 'output') setActiveOutput(name);
    if (type === 'input') setActiveInput(name);
    try {
      await fetch('/api/audio/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type })
      });
      // Re-fetch to confirm
      setTimeout(fetchAudioState, 500);
    } catch (err) {
      console.error("Failed to update device", err);
    }
  };

  const updateFormat = async (newRate: number, newDepth: number) => {
    setSampleRate(newRate);
    setBitDepth(newDepth);
    try {
      await fetch('/api/audio/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleRate: newRate, bitDepth: newDepth })
      });
      setTimeout(fetchAudioState, 500);
    } catch (err) {
      console.error("Failed to update format", err);
    }
  };

  const handleMusicControl = async (action: 'playpause' | 'next track' | 'previous track') => {
    // Optimistic UI update for play/pause
    if (action === 'playpause') {
      setMusicState(prev => prev === 'playing' ? 'paused' : 'playing');
    }
    try {
      await fetch('/api/music/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      setTimeout(fetchMusicState, 500);
    } catch (err) {
      console.error("Failed to control music", err);
    }
  };

  const handleMusicSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    try {
      await fetch('/api/music/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery })
      });
      setSearchQuery('');
      setSearchResults([]);
      setTimeout(fetchMusicState, 1000);
    } catch (err) {
      console.error("Failed to search and play music", err);
    }
  };

  const playSearchResult = async (result: any) => {
    setSearchQuery('');
    setSearchResults([]);
    try {
      const url = (result.trackViewUrl || result.collectionViewUrl || result.artistLinkUrl).replace('https://', 'music://');
      await fetch('/api/music/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: url, isUrl: true })
      });
      setTimeout(fetchMusicState, 1000);
    } catch (err) {
      console.error("Failed to play search result", err);
    }
  };

  const toggleAirplay = async (deviceName: string, selected: boolean) => {
    // Optimistic update
    setAirplayDevices(prev => prev.map(d => d.name === deviceName ? { ...d, selected } : d));
    try {
      await fetch('/api/music/airplay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName, selected })
      });
      setTimeout(fetchAirplayState, 500);
    } catch (err) {
      console.error("Failed to toggle airplay", err);
    }
  };

  const formatSampleRate = (rate: number) => `${(rate / 1000).toFixed(1)} kHz`;

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-blue-500/30 overflow-x-hidden pb-12">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-xl border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Laptop className="w-6 h-6 text-blue-400" />
            <span className={`absolute -bottom-1 -right-1 w-3 h-3 border-2 border-black rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">MacBook Air</h1>
            <p className="text-xs text-white/50">{isConnected ? 'Connected via Wi-Fi' : 'Disconnected'}</p>
          </div>
        </div>
        <button className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
          <Settings className="w-5 h-5 text-white/70" />
        </button>
      </header>

      <main className="p-6 space-y-8 max-w-md mx-auto">
        
        {/* Apple Music Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <MusicIcon className="w-5 h-5 text-pink-500" />
              Apple Music
            </h2>
          </div>
          
          <div className="bg-white/5 rounded-3xl p-5 border border-white/10 space-y-6">
            
            {/* Now Playing info */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-orange-400 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-pink-500/20">
                <MusicIcon className="w-8 h-8 text-white/80" />
              </div>
              <div className="flex-1 min-w-0">
                {musicState === 'stopped' ? (
                  <p className="text-white/60 font-medium">Not Playing</p>
                ) : (
                  <>
                    <h3 className="font-semibold text-lg truncate">{currentTrack || 'Unknown Track'}</h3>
                    <p className="text-white/60 text-sm truncate">{currentArtist || 'Unknown Artist'}</p>
                  </>
                )}
              </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center justify-center gap-6">
              <button 
                onClick={() => handleMusicControl('previous track')}
                className="p-3 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <SkipBack className="w-6 h-6" />
              </button>
              <button 
                onClick={() => handleMusicControl('playpause')}
                className="p-4 bg-white text-black rounded-full hover:scale-105 active:scale-95 transition-all shadow-lg shadow-white/10"
              >
                {musicState === 'playing' ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
              </button>
              <button 
                onClick={() => handleMusicControl('next track')}
                className="p-3 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <SkipForward className="w-6 h-6" />
              </button>
            </div>

            {/* Search & Play */}
            <div className="space-y-3" ref={searchRef}>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {['song', 'album', 'artist', 'playlist'].map(type => (
                  <button 
                    key={type} 
                    onClick={() => setSearchType(type as any)} 
                    className={`px-4 py-1.5 rounded-full text-xs font-medium capitalize whitespace-nowrap transition-colors ${searchType === type ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/20' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <form onSubmit={handleMusicSearch} className="relative">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  {isSearching ? (
                    <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4 text-white/40" />
                  )}
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search for a ${searchType}...`}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all"
                />
                
                {/* Autofill Dropdown */}
                <AnimatePresence>
                  {searchResults.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden z-50 max-h-64 overflow-y-auto shadow-2xl"
                    >
                      {searchResults.map((result, idx) => (
                        <button 
                          key={result.trackId || result.collectionId || result.artistId || idx}
                          type="button"
                          onClick={() => playSearchResult(result)}
                          className="w-full text-left px-4 py-3 hover:bg-white/10 flex items-center gap-3 border-b border-white/5 last:border-0 transition-colors"
                        >
                          {result.artworkUrl60 ? (
                            <img src={result.artworkUrl60} alt="" className="w-10 h-10 rounded-lg object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
                              <MusicIcon className="w-5 h-5 text-white/40" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-white truncate">
                              {result.trackName || result.collectionName || result.artistName}
                            </div>
                            <div className="text-xs text-white/50 truncate">
                              {result.artistName || 'Apple Music'}
                            </div>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>
            </div>
          </div>
        </section>

        {/* AirPlay & Output Groups Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Cast className="w-5 h-5 text-blue-400" />
              AirPlay Output Groups
            </h2>
          </div>
          
          <div className="bg-white/5 rounded-3xl p-5 border border-white/10 space-y-4">
            {airplayDevices.length === 0 ? (
              <p className="text-sm text-white/50 text-center py-2">No AirPlay devices found</p>
            ) : (
              airplayDevices.map(device => (
                <div key={device.name} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    {device.kind?.toLowerCase().includes('homepod') ? (
                      <MonitorSpeaker className="w-5 h-5 text-white/60" />
                    ) : device.kind?.toLowerCase().includes('tv') ? (
                      <MonitorSpeaker className="w-5 h-5 text-white/60" />
                    ) : (
                      <Laptop className="w-5 h-5 text-white/60" />
                    )}
                    <span className="text-white/90 font-medium text-sm">{device.name}</span>
                  </div>
                  <button
                    onClick={() => toggleAirplay(device.name, !device.selected)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${device.selected ? 'bg-blue-500' : 'bg-white/20 group-hover:bg-white/30'}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${device.selected ? 'translate-x-6.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))
            )}
            <p className="text-xs text-white/40 text-center pt-2">
              Select multiple devices to sync audio output across them.
            </p>
          </div>
        </section>

        {/* Output Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <MonitorSpeaker className="w-5 h-5 text-blue-400" />
              Output
            </h2>
          </div>
          
          <div className="bg-white/5 rounded-3xl p-5 border border-white/10 space-y-6">
            {/* Volume Slider */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm text-white/60">
                <span>Volume</span>
                <span>{isMuted ? 'Muted' : `${volume}%`}</span>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => updateMute(!isMuted)} className="text-white/50 hover:text-white transition-colors">
                  {isMuted || volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                </button>
                <div className="relative flex-1 h-12 bg-white/10 rounded-full overflow-hidden group">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => updateVolume(parseInt(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div 
                    className="absolute left-0 top-0 bottom-0 bg-blue-500 pointer-events-none transition-all duration-75 ease-out"
                    style={{ width: `${isMuted ? 0 : volume}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Device Selection */}
            <div className="space-y-3">
              <span className="text-sm text-white/60">Device</span>
              <div className="grid gap-2">
                {outputDevices.map(device => (
                  <button
                    key={device.id}
                    onClick={() => updateDevice(device.name, 'output')}
                    className={`flex items-center justify-between p-4 rounded-2xl transition-all ${
                      activeOutput === device.name 
                        ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400' 
                        : 'bg-white/5 border border-transparent text-white/80 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {device.name.toLowerCase().includes('headphone') ? <Headphones className="w-5 h-5" /> : <MonitorSpeaker className="w-5 h-5" />}
                      <span className="font-medium text-left">{device.name}</span>
                    </div>
                    {activeOutput === device.name && (
                      <motion.div layoutId="activeOutput" className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Audio Format Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-400" />
              Audio Format
            </h2>
          </div>
          
          <div className="bg-white/5 rounded-3xl p-5 border border-white/10 space-y-6">
            {/* Bit Depth */}
            <div className="space-y-3">
              <span className="text-sm text-white/60">Bit Depth</span>
              <div className="flex bg-white/5 p-1 rounded-2xl">
                {BIT_DEPTHS.map(depth => (
                  <button
                    key={depth}
                    onClick={() => updateFormat(sampleRate, depth)}
                    className={`flex-1 py-3 text-sm font-medium rounded-xl transition-all relative ${
                      bitDepth === depth ? 'text-white' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {bitDepth === depth && (
                      <motion.div 
                        layoutId="activeBitDepth" 
                        className="absolute inset-0 bg-white/10 rounded-xl shadow-sm" 
                      />
                    )}
                    <span className="relative z-10">{depth}-bit</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Sample Rate */}
            <div className="space-y-3">
              <span className="text-sm text-white/60">Sample Rate</span>
              <div className="grid grid-cols-2 gap-2">
                {SAMPLE_RATES.map(rate => (
                  <button
                    key={rate}
                    onClick={() => updateFormat(rate, bitDepth)}
                    className={`py-3 text-sm font-medium rounded-xl transition-all border ${
                      sampleRate === rate 
                        ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' 
                        : 'bg-white/5 border-transparent text-white/60 hover:bg-white/10'
                    }`}
                  >
                    {formatSampleRate(rate)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Input Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Mic className="w-5 h-5 text-green-400" />
              Input
            </h2>
          </div>
          
          <div className="bg-white/5 rounded-3xl p-5 border border-white/10 space-y-6">
            {/* Input Volume Slider */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm text-white/60">
                <span>Gain</span>
                <span>{isInputMuted ? 'Muted' : `${inputVolume}%`}</span>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setIsInputMuted(!isInputMuted)} className="text-white/50 hover:text-white transition-colors">
                  {isInputMuted || inputVolume === 0 ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                </button>
                <div className="relative flex-1 h-12 bg-white/10 rounded-full overflow-hidden group">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isInputMuted ? 0 : inputVolume}
                    onChange={(e) => updateInputVolume(parseInt(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div 
                    className="absolute left-0 top-0 bottom-0 bg-green-500 pointer-events-none transition-all duration-75 ease-out"
                    style={{ width: `${isInputMuted ? 0 : inputVolume}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Input Device Selection */}
            <div className="space-y-3">
              <span className="text-sm text-white/60">Device</span>
              <div className="grid gap-2">
                {inputDevices.map(device => (
                  <button
                    key={device.id}
                    onClick={() => updateDevice(device.name, 'input')}
                    className={`flex items-center justify-between p-4 rounded-2xl transition-all ${
                      activeInput === device.name 
                        ? 'bg-green-500/20 border border-green-500/50 text-green-400' 
                        : 'bg-white/5 border border-transparent text-white/80 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Mic className="w-5 h-5" />
                      <span className="font-medium text-left">{device.name}</span>
                    </div>
                    {activeInput === device.name && (
                      <motion.div layoutId="activeInput" className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Warnings & Info Cards */}
        <div className="space-y-3">
          {!isMac && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 text-sm text-yellow-200/80 flex gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-yellow-400" />
              <p>
                <strong>Preview Mode:</strong> You are viewing this in the cloud. To actually control your Mac's audio, you must export this project and run it locally on your MacBook.
              </p>
            </div>
          )}

          {isMac && !hasSwitchAudio && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 text-sm text-blue-200/80 flex gap-3">
              <Info className="w-5 h-5 shrink-0 text-blue-400" />
              <div className="space-y-2">
                <p><strong>Device Switching Not Enabled</strong></p>
                <p>To enable switching output and input devices, you need to install the <code>switchaudio-osx</code> CLI tool on your Mac.</p>
                <p className="font-mono bg-black/50 p-2 rounded text-xs">brew install switchaudio-osx</p>
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
