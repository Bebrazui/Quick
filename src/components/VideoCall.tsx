import React, { useRef, useEffect } from 'react';
import { useCall } from '../hooks/useCall';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';

interface VideoCallProps {
  privateKey: Uint8Array;
  recipientPubkey?: string;
}

export const VideoCall: React.FC<VideoCallProps> = ({ privateKey, recipientPubkey }) => {
  const {
    callState,
    localStream,
    remoteStream,
    formattedDuration,
    isMuted,
    isVideoOff,
    incomingCall,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
  } = useCall(privateKey);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Привязываем потоки к video элементам
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

  return (
    <>
      {/* ============= Входящий звонок ============= */}
      {incomingCall && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-8 shadow-2xl text-center">
            <h3 className="text-xl font-bold">Входящий {incomingCall.callType === 'video' ? 'видео' : 'аудио'} звонок</h3>
            <p className="text-gray-600 mt-2">от {incomingCall.callerPubkey.slice(0, 16)}...</p>
            <div className="mt-6 flex justify-center gap-4">
              <button className="bg-red-500 text-white rounded-full p-4" onClick={rejectCall}>
                <PhoneOff />
              </button>
              <button className="bg-green-500 text-white rounded-full p-4" onClick={acceptCall}>
                <Phone />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============= Активный звонок ============= */}
      {callState !== 'idle' && !incomingCall && (
        <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col">
          {/* Удалённое видео (полный экран) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Локальное видео (PiP) */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute top-4 right-4 w-1/4 max-w-xs border-2 border-white rounded-lg"
          />

          {/* Статус звонка */}
          <div className="absolute top-4 left-4 bg-black/50 p-2 rounded">
            {callState === 'calling' && <p>Совершение вызова...</p>}
            {callState === 'connecting' && <p>Соединение...</p>}
            {callState === 'connected' && <p>{formattedDuration}</p>}
            {callState === 'ended' && <p>Звонок завершен</p>}
          </div>

          {/* Панель управления */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4">
            <button
              className={`p-4 rounded-full ${isMuted ? 'bg-red-500' : 'bg-gray-700'}`}
              onClick={toggleMute}
            >
              {isMuted ? <MicOff /> : <Mic />}
            </button>

            <button
              className={`p-4 rounded-full ${isVideoOff ? 'bg-red-500' : 'bg-gray-700'}`}
              onClick={toggleVideo}
            >
              {isVideoOff ? <VideoOff /> : <Video />}
            </button>

            <button className="p-4 rounded-full bg-red-600" onClick={() => endCall()}>
              <PhoneOff />
            </button>
          </div>
        </div>
      )}

      {/* ============= Кнопки начала звонка ============= */}
      {callState === 'idle' && recipientPubkey && (
        <div className="flex gap-2">
          <button className="bg-blue-500 text-white p-2 rounded" onClick={() => startCall(recipientPubkey, 'audio')}>
            <Phone />
          </button>
          <button className="bg-blue-500 text-white p-2 rounded" onClick={() => startCall(recipientPubkey, 'video')}>
            <Video />
          </button>
        </div>
      )}
    </>
  );
};
