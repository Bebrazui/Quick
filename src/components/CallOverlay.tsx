import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, PhoneIncoming, AlertTriangle } from 'lucide-react';
import { webrtcManager, type CallState, type CallType } from '../lib/webrtc';
import { nostrClient } from '../lib/nostr';
import { useAppState } from '../lib/store';
import Avatar from './Avatar';

export default function CallOverlay() {
  const { contacts } = useAppState();
  const [callState, setCallState] = useState<CallState>('idle');
  const [remotePubkey, setRemotePubkey] = useState<string | null>(null);
  const [callType, setCallType] = useState<CallType>('audio');
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    webrtcManager.init();

    const unsubState = webrtcManager.onStateChange((state, pubkey, type, error) => {
      setCallState(state);
      setRemotePubkey(pubkey);
      setCallType(type);
      if (error) {
        setCallError(error);
        setTimeout(() => setCallError(null), 4000);
      }
      if (state === 'idle') {
        setMuted(false);
        setVideoOff(false);
        setElapsed(0);
      }
    });

    const unsubStream = webrtcManager.onStream((local, remote) => {
      setLocalStream(local);
      setRemoteStream(remote);
    });

    return () => {
      unsubState();
      unsubStream();
      webrtcManager.destroy();
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (callState !== 'connected') return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - webrtcManager.callStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [callState]);

  const handleToggleMute = useCallback(() => {
    const isMuted = webrtcManager.toggleMute();
    setMuted(isMuted);
  }, []);

  const handleToggleVideo = useCallback(() => {
    const isOff = webrtcManager.toggleVideo();
    setVideoOff(isOff);
  }, []);

  const contact = remotePubkey ? contacts.find(c => c.pubkey === remotePubkey) : null;
  const displayName = contact?.name || (remotePubkey ? nostrClient.shortenKey(remotePubkey) : 'Неизвестный');

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // Показать ошибку даже когда звонок не активен
  if (callState === 'idle' && !callError) return null;

  // Только ошибка — маленький тост
  if (callState === 'idle' && callError) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-5 py-3 bg-red/90 backdrop-blur-sm rounded-2xl shadow-2xl shadow-red/20 text-white text-sm max-w-md"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{callError}</span>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center"
      >
        {/* Фон */}
        <div className="absolute inset-0 bg-bg/95 backdrop-blur-xl" />

        {/* Видео для видеозвонка */}
        {callType === 'video' && callState === 'connected' && (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/20" />
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="absolute top-4 right-4 w-32 h-44 sm:w-40 sm:h-56 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-10"
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            </motion.div>
          </>
        )}

        {/* Аудиозвонок / Вызов / Входящий */}
        {(callType === 'audio' || callState !== 'connected') && (
          <div className="relative z-10 flex flex-col items-center">
            {(callState === 'calling' || callState === 'ringing') && (
              <>
                <div className="absolute w-40 h-40 rounded-full border-2 border-accent/20 animate-pulse-ring" />
                <div className="absolute w-56 h-56 rounded-full border border-accent/10 animate-pulse-ring" style={{ animationDelay: '0.5s' }} />
              </>
            )}

            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
            >
              <Avatar
                pubkey={remotePubkey || ''}
                name={contact?.name}
                picture={contact?.picture}
                size="xl"
                showBorder={true}
              />
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mt-6 text-xl font-bold text-text"
              style={{ fontFamily: 'Space Grotesk' }}
            >
              {displayName}
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-2 text-sm text-text-secondary"
            >
              {callState === 'calling' && (
                <span className="animate-call-pulse">Вызов...</span>
              )}
              {callState === 'ringing' && (
                <span className="animate-call-pulse flex items-center gap-2">
                  <PhoneIncoming className="w-4 h-4" />
                  Входящий {callType === 'video' ? 'видео' : 'аудио'} звонок
                </span>
              )}
              {callState === 'connected' && (
                <span className="text-green">{formatElapsed(elapsed)}</span>
              )}
            </motion.p>
          </div>
        )}

        {/* Инфо видеозвонка */}
        {callType === 'video' && callState === 'connected' && (
          <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-black/50 backdrop-blur-sm rounded-2xl px-4 py-2">
            <Avatar pubkey={remotePubkey || ''} name={contact?.name} picture={contact?.picture} size="xs" showBorder />
            <div>
              <p className="text-sm font-medium text-white">{displayName}</p>
              <p className="text-xs text-green">{formatElapsed(elapsed)}</p>
            </div>
          </div>
        )}

        {/* Кнопки управления */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="absolute bottom-8 sm:bottom-12 left-0 right-0 flex items-center justify-center gap-4 z-10"
        >
          {/* Входящий: Принять / Отклонить */}
          {callState === 'ringing' && (
            <>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => webrtcManager.rejectCall()}
                className="w-16 h-16 rounded-full bg-red flex items-center justify-center shadow-lg shadow-red/30"
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => webrtcManager.acceptCall()}
                className="w-16 h-16 rounded-full bg-green flex items-center justify-center shadow-lg shadow-green/30"
              >
                <Phone className="w-7 h-7 text-white" />
              </motion.button>
            </>
          )}

          {/* В звонке */}
          {(callState === 'calling' || callState === 'connected') && (
            <>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={handleToggleMute}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                  muted ? 'bg-red/20 text-red' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </motion.button>

              {callType === 'video' && (
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleToggleVideo}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                    videoOff ? 'bg-red/20 text-red' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {videoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                </motion.button>
              )}

              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => webrtcManager.endCall()}
                className="w-16 h-16 rounded-full bg-red flex items-center justify-center shadow-lg shadow-red/30"
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </motion.button>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
