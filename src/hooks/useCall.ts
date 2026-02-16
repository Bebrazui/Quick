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
    const signaling = new NostrSignaling(privateKey, relayUrl);
    signalingRef.current = signaling;

    const manager = new CallManager(signaling, {
      onStateChange: setCallState,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onCallDuration: setDuration,
      onError: setError,
      onIncomingCall: (callerPubkey, callId, callType) => {
        setIncomingCall({ callerPubkey, callId, callType });
      },
    });
    managerRef.current = manager;

    return () => {
      manager.endCall(true);
      signaling.destroy();
    };
  }, [privateKey, relayUrl]);

  const startCall = useCallback((recipientPubkey: string, type: CallType) => {
    managerRef.current?.startCall(recipientPubkey, type);
  }, []);

  const acceptCall = useCallback(() => {
    managerRef.current?.acceptCall();
    setIncomingCall(null);
  }, []);

  const rejectCall = useCallback(() => {
    managerRef.current?.rejectCall();
    setIncomingCall(null);
  }, []);

  const endCall = useCallback(() => {
    managerRef.current?.endCall(true);
  }, []);

  const toggleMute = useCallback(() => {
    const muted = managerRef.current?.toggleMute();
    setIsMuted(muted ?? false);
  }, []);

  const toggleVideo = useCallback(() => {
    const off = managerRef.current?.toggleVideo();
    setIsVideoOff(off ?? false);
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
