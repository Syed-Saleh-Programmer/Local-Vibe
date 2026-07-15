import { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { 
  Camera, CameraOff, Mic, MicOff, Volume2, VolumeX, 
  MapPin, LogOut, Settings, Users, AlertCircle, ShieldCheck
} from 'lucide-react';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

const useSpeaking = (stream) => {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    let audioContext;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;

    let source;
    try {
      source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      source.connect(analyser);
    } catch (err) {
      if (audioContext && audioContext.state !== 'closed') {
        const p = audioContext.close();
        if (p && p.catch) p.catch(() => {});
      }
      return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let rafId;
    let lastUpdate = 0;
    let lastValue = false;

    const checkVolume = (timestamp) => {
      // Throttle setState to ~10 updates/sec to avoid render thrashing
      if (timestamp - lastUpdate > 100) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const average = sum / dataArray.length;
        const speaking = average > 15;
        if (speaking !== lastValue) {
          lastValue = speaking;
          setIsSpeaking(speaking);
        }
        lastUpdate = timestamp;
      }
      rafId = requestAnimationFrame(checkVolume);
    };
    rafId = requestAnimationFrame(checkVolume);

    return () => {
      cancelAnimationFrame(rafId);
      if (source) source.disconnect();
      if (audioContext && audioContext.state !== 'closed') {
        const p = audioContext.close();
        if (p && p.catch) p.catch(() => {});
      }
    };
  }, [stream]);

  return isSpeaking;
};

const Video = ({ peer, selectedAudioOutput, isDeafened, name, isVideoOff, onSpeaking, isActiveSpeaker }) => {
  const ref = useRef();
  const [stream, setStream] = useState(null);
  const isSpeaking = useSpeaking(stream);
  const wasSpeakingRef = useRef(false);
  const onSpeakingRef = useRef(onSpeaking);
  onSpeakingRef.current = onSpeaking;

  useEffect(() => {
    if (isSpeaking && !wasSpeakingRef.current) {
      if (onSpeakingRef.current) onSpeakingRef.current();
    }
    wasSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    const handleStream = (stream) => { 
      if (ref.current) ref.current.srcObject = stream; 
      setStream(stream);
    };
    peer.on("stream", handleStream);
    if (peer._remoteStreams && peer._remoteStreams.length > 0) {
      if (ref.current) ref.current.srcObject = peer._remoteStreams[0];
      setStream(peer._remoteStreams[0]);
    }
    return () => {
      peer.off("stream", handleStream);
    };
  }, [peer]);

  useEffect(() => {
    if (ref.current && typeof ref.current.setSinkId === 'function' && selectedAudioOutput) {
      ref.current.setSinkId(selectedAudioOutput).catch(err => console.warn("Audio output unavailable", err));
    }
  }, [selectedAudioOutput]);
  
  useEffect(() => {
    if (ref.current) ref.current.muted = isDeafened;
  }, [isDeafened]);

  return (
    <>
      <video playsInline autoPlay ref={ref} className={`w-full h-full object-cover rounded-2xl bg-slate-900 transition duration-500 ${isVideoOff ? 'opacity-0' : 'opacity-100'}`} />
      
      {isVideoOff && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-400">
           <div className="w-24 h-24 rounded-full bg-slate-700 flex items-center justify-center mb-3 shadow-2xl ring-4 ring-slate-800">
             <span className="text-4xl font-bold text-white">{name ? name.charAt(0).toUpperCase() : 'P'}</span>
           </div>
        </div>
      )}

      <div className={`absolute inset-0 border-4 rounded-2xl pointer-events-none transition-all duration-200 ${isActiveSpeaker ? 'border-amber-400 shadow-[inset_0_0_20px_rgba(251,191,36,0.3)]' : 'border-transparent'}`} />
    </>
  );
};

function App() {
  const [city, setCity] = useState('');
  const [errorStatus, setErrorStatus] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [inRoom, setInRoom] = useState(false);
  const [peersState, setPeersState] = useState([]);
  const [hasMedia, setHasMedia] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [userName, setUserName] = useState('');
  const [tempName, setTempName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);

  const userNameRef = useRef(userName);
  const userVideo = useRef();
  const socketRef = useRef();
  const peersRef = useRef([]);
  const streamRef = useRef();

  const isVideoOffRef = useRef(isVideoOff);
  useEffect(() => {
    isVideoOffRef.current = isVideoOff;
  }, [isVideoOff]);

  const [localStream, setLocalStream] = useState(null);
  useEffect(() => {
    if (hasMedia && streamRef.current && !localStream) {
      setLocalStream(streamRef.current);
    }
  }, [hasMedia]);

  const localStreamActive = useSpeaking(localStream);
  const isLocalSpeaking = localStreamActive && !isMuted;

  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const prevLocalSpeakingRef = useRef(false);

  useEffect(() => {
    if (isLocalSpeaking && !prevLocalSpeakingRef.current) {
      setActiveSpeaker('local');
    }
    prevLocalSpeakingRef.current = isLocalSpeaking;
  }, [isLocalSpeaking]);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);
    return () => {
      socketRef.current.disconnect();
      // Release all media tracks on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    userNameRef.current = userName;
    peersRef.current.forEach(p => {
      if (p.peer.connected) {
        try { p.peer.send(JSON.stringify({ type: 'name', name: userName })); } catch (e) {}
      }
    });
  }, [userName]);

  useEffect(() => {
    if (inRoom && streamRef.current && userVideo.current) {
      userVideo.current.srcObject = streamRef.current;
    }
  }, [inRoom, hasMedia]);

  const fetchDevices = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(device => device.kind === 'audioinput');
      const outputs = devices.filter(device => device.kind === 'audiooutput');
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (inputs.length && !selectedAudioInput) setSelectedAudioInput(inputs[0].deviceId);
      if (outputs.length && !selectedAudioOutput) setSelectedAudioOutput(outputs[0].deviceId);
    } catch (err) {
      console.warn("Could not fetch devices", err);
    }
  };

  const handleAudioInputChange = async (e) => {
    const deviceId = e.target.value;
    setSelectedAudioInput(deviceId);
    
    if (!streamRef.current) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      const newAudioTrack = newStream.getAudioTracks()[0];
      const oldAudioTrack = streamRef.current.getAudioTracks()[0];
      
      if (oldAudioTrack && newAudioTrack) {
        newAudioTrack.enabled = !isMuted;
        streamRef.current.removeTrack(oldAudioTrack);
        streamRef.current.addTrack(newAudioTrack);
        
        peersRef.current.forEach(p => {
          try {
            p.peer.replaceTrack(oldAudioTrack, newAudioTrack, streamRef.current);
          } catch(e) { console.warn('replaceTrack failed for peer', e); }
        });
        oldAudioTrack.stop();
      } else if (!oldAudioTrack && newAudioTrack) {
        newAudioTrack.enabled = !isMuted;
        streamRef.current.addTrack(newAudioTrack);
      }
      // Refresh speaking detection with updated stream
      setLocalStream(streamRef.current);
    } catch (error) {
      console.error("Error changing audio input", error);
    }
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = isMuted;
        setIsMuted(!isMuted);
      }
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const newOffState = !isVideoOff;
        videoTrack.enabled = !newOffState;
        setIsVideoOff(newOffState);
        peersRef.current.forEach(p => {
          if (p.peer.connected) {
            try { p.peer.send(JSON.stringify({ type: 'video', isVideoOff: newOffState })); } catch (e) {}
          }
        });
      }
    }
  };

  const toggleDeafen = () => {
    setIsDeafened(!isDeafened);
  };

  const getCityFromCoordinates = async (lat, lng) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      const extractedCity = data.address.city || data.address.town || data.address.village || data.address.county || "Unknown City";
      setCity(extractedCity);
      joinConference(extractedCity);
    } catch (err) {
      setErrorStatus("Failed to resolve city from coordinates.");
      setIsConnecting(false);
    }
  };

  const requestLocationAndJoin = async () => {
    const finalName = userName.trim() || `Guest ${Math.floor(Math.random() * 1000)}`;
    if (!userName.trim()) setUserName(finalName);

    setIsConnecting(true);
    setErrorStatus("Requesting hardware access...");
    
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err1) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          } catch (err2) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            } catch (err3) {
              console.warn("All media requests failed.", err3);
            }
          }
        }

        if (stream) {
          streamRef.current = stream;
          setHasMedia(true);
          const hasVid = stream.getVideoTracks().length > 0;
          setHasVideo(hasVid);
          if (userVideo.current) {
             userVideo.current.srcObject = stream;
          }
        }
      }
    } catch (error) {
      console.warn("Hardware media bypassed.", error);
    }
    
    await fetchDevices();
    setErrorStatus("Acquiring GPS coordinates...");
    
    if (!navigator.geolocation) {
       setErrorStatus("Geolocation not supported. Location is mandatory.");
       setIsConnecting(false);
       return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        getCityFromCoordinates(latitude, longitude);
      },
      (error) => {
        setErrorStatus(`GPS Error: ${error.message}.`);
        setIsConnecting(false);
      }
    );
  };

  const joinConference = (cityName) => {
    setErrorStatus("Connecting to secure room...");
    
    // Remove old listeners to prevent stacking on reconnect
    socketRef.current.off("all_users");
    socketRef.current.off("user_joined_signal");
    socketRef.current.off("receiving_returned_signal");
    socketRef.current.off("user_left");
    
    socketRef.current.emit("join_city", { city: cityName });
    setInRoom(true);
    setIsConnecting(false);
    setErrorStatus("");

    socketRef.current.on("all_users", users => {
      const peers = [];
      users.forEach(userID => {
        const peer = createPeer(userID, socketRef.current.id, streamRef.current);
        peersRef.current.push({ peerID: userID, peer });
        peers.push({ peerID: userID, peer });
      });
      setPeersState(peers);
    });

    socketRef.current.on("user_joined_signal", payload => {
      const peer = addPeer(payload.signal, payload.callerID, streamRef.current);
      peersRef.current.push({ peerID: payload.callerID, peer });
      setPeersState(prev => [...prev, { peerID: payload.callerID, peer }]);
    });

    socketRef.current.on("receiving_returned_signal", payload => {
      const item = peersRef.current.find(p => p.peerID === payload.id);
      if (item) item.peer.signal(payload.signal);
    });

    socketRef.current.on("user_left", id => {
      const peerObj = peersRef.current.find(p => p.peerID === id);
      if (peerObj) peerObj.peer.destroy();
      const newPeers = peersRef.current.filter(p => p.peerID !== id);
      peersRef.current = newPeers;
      setPeersState(newPeers);
      setActiveSpeaker(prev => prev === id ? null : prev);
    });
  };

  function createPeer(userToSignal, callerID, stream) {
    const iceConfig = { iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ] };
    const peerOpts = { initiator: true, trickle: false, config: iceConfig };
    if (stream) peerOpts.stream = stream;
    const peer = new Peer(peerOpts);
    peer.on("error", err => console.warn("Peer error (initiator):", err.message));
    peer.on("signal", signal => { socketRef.current.emit("sending_signal", { userToSignal, callerID, signal }); });
    peer.on("data", data => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'name') {
           setPeersState(prev => prev.map(p => p.peerID === userToSignal ? { ...p, name: parsed.name } : p));
           peersRef.current.forEach(p => { if (p.peerID === userToSignal) p.name = parsed.name; });
        } else if (parsed.type === 'video') {
           setPeersState(prev => prev.map(p => p.peerID === userToSignal ? { ...p, isVideoOff: parsed.isVideoOff } : p));
           peersRef.current.forEach(p => { if (p.peerID === userToSignal) p.isVideoOff = parsed.isVideoOff; });
        }
      } catch(e) {}
    });
    peer.on("connect", () => {
      peer.send(JSON.stringify({ type: 'name', name: userNameRef.current }));
      peer.send(JSON.stringify({ type: 'video', isVideoOff: isVideoOffRef.current }));
    });
    return peer;
  }

  function addPeer(incomingSignal, callerID, stream) {
    const iceConfig = { iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ] };
    const peerOpts = { initiator: false, trickle: false, config: iceConfig };
    if (stream) peerOpts.stream = stream;
    const peer = new Peer(peerOpts);
    peer.on("error", err => console.warn("Peer error (responder):", err.message));
    peer.on("signal", signal => { socketRef.current.emit("returning_signal", { signal, callerID }); });
    peer.on("data", data => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'name') {
           setPeersState(prev => prev.map(p => p.peerID === callerID ? { ...p, name: parsed.name } : p));
           peersRef.current.forEach(p => { if (p.peerID === callerID) p.name = parsed.name; });
        } else if (parsed.type === 'video') {
           setPeersState(prev => prev.map(p => p.peerID === callerID ? { ...p, isVideoOff: parsed.isVideoOff } : p));
           peersRef.current.forEach(p => { if (p.peerID === callerID) p.isVideoOff = parsed.isVideoOff; });
        }
      } catch(e) {}
    });
    peer.on("connect", () => {
      peer.send(JSON.stringify({ type: 'name', name: userNameRef.current }));
      peer.send(JSON.stringify({ type: 'video', isVideoOff: isVideoOffRef.current }));
    });
    peer.signal(incomingSignal);
    return peer;
  }

  // Render calculations
  const totalUsers = peersState.length + 1;
  let gridClass = "grid-cols-1";
  if (totalUsers >= 2 && totalUsers <= 4) gridClass = "sm:grid-cols-2";
  else if (totalUsers >= 5 && totalUsers <= 9) gridClass = "sm:grid-cols-2 md:grid-cols-3";
  else if (totalUsers > 9) gridClass = "sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-blue-500/30 relative">
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Settings size={20} className="text-blue-400" />
                Device Settings
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white transition">
                ✕
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Microphone (Input)</label>
                <select 
                  value={selectedAudioInput} onChange={handleAudioInputChange}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition appearance-none"
                >
                  {audioInputs.length === 0 && <option>No microphone found</option>}
                  {audioInputs.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || `Mic ${device.deviceId.slice(0,5)}`}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Speakers (Output)</label>
                <select 
                  value={selectedAudioOutput} onChange={e => setSelectedAudioOutput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition appearance-none"
                >
                  {audioOutputs.length === 0 && <option>Default system speaker</option>}
                  {audioOutputs.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${device.deviceId.slice(0,5)}`}</option>)}
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-slate-800 bg-slate-900/50 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-lg font-medium transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {inRoom && (
        <header className="h-16 border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <MapPin size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-wide">{city}</h1>
              <span className="text-xs text-emerald-400 font-medium tracking-wider uppercase flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Secure connection
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700/50 text-sm font-medium text-slate-300">
              <Users size={16} className="text-slate-400" />
              <span>{totalUsers} participant{totalUsers !== 1 && 's'}</span>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="ml-2 flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-4 py-2 rounded-lg font-medium transition"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        {!inRoom ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden">
             <div className="absolute top-0 w-full h-full overflow-hidden pointer-events-none -z-10">
               <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/10 blur-[120px]"></div>
               <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-600/10 blur-[120px]"></div>
             </div>
             
             <div className="mb-10 text-center">
               <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shadow-blue-500/20 mb-6">
                 <MapPin size={32} className="text-white" />
               </div>
               <h1 className="text-5xl font-black tracking-tight mb-4">
                 Local<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">Vibe</span>
               </h1>
               <p className="text-slate-400 text-lg max-w-md mx-auto">
                 Peer-to-peer enterprise conferencing based strictly on your geographic location.
               </p>
             </div>

             <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl w-full max-w-sm flex flex-col relative overflow-hidden">
                {isConnecting && (
                  <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 animate-[pulse_2s_ease-in-out_infinite] w-full"></div>
                )}
                
                <div className="w-full mb-5">
                  <label className="block text-sm font-medium text-slate-400 mb-2">Display Name</label>
                  <input 
                    type="text"
                    placeholder="Enter your name"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition placeholder:text-slate-600"
                    maxLength={24}
                    onKeyDown={(e) => e.key === 'Enter' && requestLocationAndJoin()}
                    disabled={isConnecting}
                  />
                </div>

                <button 
                  onClick={requestLocationAndJoin}
                  disabled={isConnecting}
                  className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-4 px-6 rounded-xl transition duration-300 shadow-lg shadow-white/5 flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed text-lg"
                >
                  {isConnecting ? (
                    <span className="flex items-center gap-2">
                       <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-slate-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                       Connecting...
                    </span>
                  ) : "Join Location Room"}
                </button>
                
                {errorStatus && (
                  <div className="mt-6 flex items-start gap-3 bg-slate-950/50 p-3 rounded-lg border border-slate-800/50">
                    <AlertCircle size={18} className="text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-300 leading-snug">{errorStatus}</p>
                  </div>
                )}
                
                <div className="mt-6 pt-6 border-t border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-500">
                   <ShieldCheck size={14} /> End-to-end encrypted signals
                </div>
             </div>
          </div>
        ) : (
          <div className="flex-1 p-4 pb-28 md:p-6 md:pb-32 overflow-y-auto">
             <div className={`grid ${gridClass} gap-4 max-w-7xl mx-auto auto-rows-[minmax(200px,300px)]`}>
                {/* Local User */}
                <div className="relative rounded-2xl overflow-hidden shadow-xl ring-1 ring-slate-800 bg-slate-900 group">
                  <video muted ref={userVideo} autoPlay playsInline className={`w-full h-full object-cover transition duration-500 ${(isVideoOff || !hasVideo) ? 'opacity-0' : 'opacity-100'}`} />
                  
                  {(isVideoOff || !hasVideo) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-400">
                      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-3 shadow-2xl ring-4 ring-slate-800">
                         <span className="text-4xl font-bold text-white">{userName ? userName.charAt(0).toUpperCase() : 'Y'}</span>
                      </div>
                      <span className="text-sm font-medium">{!hasVideo ? 'No Camera' : 'Camera Off'}</span>
                    </div>
                  )}
                  
                  {isMuted && (
                    <div className="absolute top-4 right-4 bg-red-500 text-white p-1.5 rounded-full shadow-lg">
                      <MicOff size={16} />
                    </div>
                  )}
                  
                  <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2 text-white">
                    {isEditingName ? (
                       <input 
                         type="text" 
                         value={tempName} 
                         onChange={e => setTempName(e.target.value.slice(0, 24))}
                         onBlur={() => { setUserName(tempName || 'Guest'); setIsEditingName(false); }}
                         onKeyDown={e => { if(e.key === 'Enter') { setUserName(tempName || 'Guest'); setIsEditingName(false); } }}
                         autoFocus 
                         className="bg-transparent border-b border-blue-400 focus:outline-none text-white w-24 placeholder-slate-400"
                       />
                    ) : (
                       <span onClick={() => { setTempName(userName); setIsEditingName(true); }} className="cursor-pointer hover:text-blue-200 transition flex items-center gap-1 group" title="Click to edit name">
                         {userName} (You) <span className="opacity-0 group-hover:opacity-100 text-[10px] bg-slate-700 rounded px-1.5 py-0.5 ml-1 transition">Edit</span>
                       </span>
                    )}
                  </div>
                  
                  <div className={`absolute inset-0 border-4 rounded-2xl pointer-events-none transition-all duration-200 ${activeSpeaker === 'local' ? 'border-amber-400 shadow-[inset_0_0_20px_rgba(251,191,36,0.3)]' : 'border-transparent'}`} />
                </div>
                
                {/* Remote Peers */}
                {peersState.map((peer, index) => {
                  const handleSpeaking = () => setActiveSpeaker(peer.peerID);
                  return (
                    <div key={peer.peerID} className="relative rounded-2xl overflow-hidden shadow-xl ring-1 ring-slate-800 bg-slate-900 group">
                      <Video peer={peer.peer} selectedAudioOutput={selectedAudioOutput} isDeafened={isDeafened} name={peer.name} isVideoOff={peer.isVideoOff} onSpeaking={handleSpeaking} isActiveSpeaker={activeSpeaker === peer.peerID} />
                      <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2 text-slate-200">
                        {peer.name || `Participant ${index + 1}`}
                      </div>
                    </div>
                  );
                })}
             </div>
          </div>
        )}
      </main>

      {/* Bottom Controls Bar */}
      {inRoom && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-xl border border-slate-700/60 p-2 rounded-2xl shadow-2xl flex items-center gap-2 z-40 transition-all">
          
          <button 
            onClick={toggleMute}
            className={`flex flex-col items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-xl transition-all ${isMuted ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
            title="Toggle Microphone"
          >
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            <span className="text-[10px] font-medium mt-1">{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          <button 
            onClick={toggleVideo}
            className={`flex flex-col items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-xl transition-all ${isVideoOff ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
            title="Toggle Camera"
          >
            {isVideoOff ? <CameraOff size={22} /> : <Camera size={22} />}
            <span className="text-[10px] font-medium mt-1">{isVideoOff ? 'Start' : 'Stop'}</span>
          </button>

          <div className="w-px h-10 bg-slate-700/50 mx-1"></div>

          <button 
            onClick={toggleDeafen}
            className={`flex flex-col items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-xl transition-all ${isDeafened ? 'bg-orange-500/20 text-orange-500 hover:bg-orange-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
            title="Toggle incoming audio"
          >
            {isDeafened ? <VolumeX size={22} /> : <Volume2 size={22} />}
            <span className="text-[10px] font-medium mt-1">{isDeafened ? 'Undeafen' : 'Deafen'}</span>
          </button>

          <button 
            onClick={() => setShowSettings(true)}
            className="flex flex-col items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-all ml-1"
            title="Device Settings"
          >
            <Settings size={22} />
            <span className="text-[10px] font-medium mt-1">Audio</span>
          </button>

        </div>
      )}
    </div>
  );
}

export default App;
