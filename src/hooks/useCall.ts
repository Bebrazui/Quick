import { useState, useEffect, useRef, useCallback } from 'react';
import { CallManager, CallState, CallType } from '../lib/call-manager';
import { NostrSignaling } from '../lib/nostr-signaling';

export function useCall(privateKey: Uint8Array, relayUrl?: string) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<{
    callerPubkey: string;
    callId: string;
    callType: CallType;
  } | null>(null);

  const managerRef = useRef<CallManager | null>(null);
  const signalingRef = useRef<NostrSignaling | null>(null);

  useEffect(() => {
    // Если ключа нет, ничего не делаем
    if (!privateKey) return;

    const signaling = new NostrSignaling(privateKey, relayUrl);
    signalingRef.current = signaling;

    const manager = new CallManager(signaling, {
      onStateChange: (state) => {
        setCallState(state);
        // Сбрасываем состояние входящего звонка при возврате в idle
        if (state === 'idle' || state === 'ended') {
          setIncomingCall(null);
          setLocalStream(null);
          setRemoteStream(null);
          setDuration(0);
        }
      },
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onCallDuration: setDuration,
      onError: setError,
      onIncomingCall: (callerPubkey, callId, callType) => {
        // Предотвращаем появление звонка самому себе
        if (callerPubkey === signaling.getPublicKey()) {
          return;
        }
        setIncomingCall({ callerPubkey, callId, callType });
      },
    });
    managerRef.current = manager;

    // Функция очистки для useEffect
    return () => {
      manager.endCall(false); // Завершаем звонок без отправки сигнала, чтобы избежать гонок состояний
      signaling.destroy();
      managerRef.current = null;
      signalingRef.current = null;
    };
  }, [privateKey, relayUrl]); // <-- Зависимости добавлены

  const startCall = useCallback((recipientPubkey: string, type: CallType) => {
    if (!managerRef.current) {
      console.error("CallManager не инициализирован.");
      return;
    }
    managerRef.current.startCall(recipientPubkey, type);
  }, []);

  const acceptCall = useCallback(() => {
    if (!managerRef.current) return;
    managerRef.current.acceptCall();
    setIncomingCall(null); // Немедленно убираем UI входящего звонка
  }, []);

  const rejectCall = useCallback(() => {
    if (!managerRef.current) return;
    managerRef.current.rejectCall();
    setIncomingCall(null);
  }, []);

  const endCall = useCallback(() => {
    if (!managerRef.current) return;
    managerRef.current.endCall(true);
  }, []);

  const toggleMute = useCallback(() => {
    if (!managerRef.current) return;
    const muted = managerRef.current.toggleMute();
    setIsMuted(muted);
  }, []);

  const toggleVideo = useCallback(() => {
    if (!managerRef.current) return;
    const off = managerRef.current.toggleVideo();
    setIsVideoOff(off);
  }, []);

  const formatDuration = useCallback((secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  return {
    callState,
    localStream,
    remoteStream,
    duration,
    formattedDuration: formatDuration(duration),
    isMuted,
    isVideoOff,
    error,
    incomingCall,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
}