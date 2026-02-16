
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Mic, Pause, Play, Send, Trash2, X } from 'lucide-react';

interface AudioRecorderProps {
  onSend: (audioBlob: Blob) => void;
  onCancel: () => void;
}

// Simple hook to draw waveform
function useWaveform(audioContext: AudioContext | null, analyser: AnalyserNode | null, canvas: HTMLCanvasElement | null, isRecording: boolean) {
  useEffect(() => {
    if (!analyser || !canvas || !audioContext) return;

    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    let animationFrameId: number;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = '#1a1a1a'; // bg-bg-tertiary
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = '#00C4FF'; // accent color
      canvasCtx.beginPath();

      const sliceWidth = canvas.width * 1.0 / analyser.frequencyBinCount;
      let x = 0;

      for (let i = 0; i < analyser.frequencyBinCount; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    };

    if (isRecording) {
      draw();
    } else {
      canvasCtx.fillStyle = '#1a1a1a';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [audioContext, analyser, canvas, isRecording]);
}


export default function AudioRecorder({ onSend, onCancel }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useWaveform(audioContextRef.current, analyserRef.current, canvasRef.current, isRecording);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // --- Web Audio API setup for visualization ---
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;
      // --- End Web Audio API setup ---

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current.ondataavailable = e => chunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        chunksRef.current = [];
        stream.getTracks().forEach(track => track.stop());
        source.disconnect();
        audioContext.close();
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      // TODO: show error to user
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleSend = () => {
    if (audioBlob) {
      onSend(audioBlob);
    }
  };
  
  const handleFullCancel = () => {
      if (isRecording) stopRecording();
      if (audioRef.current) audioRef.current.src = '';
      onCancel();
  }

  const handleTogglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  useEffect(() => {
    if (audioBlob) {
      const audioUrl = URL.createObjectURL(audioBlob);
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onloadedmetadata = () => setDuration(audioRef.current!.duration);
      audioRef.current.ontimeupdate = () => setProgress(audioRef.current!.currentTime);
      audioRef.current.onplay = () => setIsPlaying(true);
      audioRef.current.onpause = () => setIsPlaying(false);
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setProgress(0);
      };
    }
    return () => {
      if (audioRef.current) {
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, [audioBlob]);

  const formatTime = (timeInSeconds: number) => {
    const time = Math.round(timeInSeconds);
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const displayedDuration = audioBlob ? duration : 0;
  const displayedProgress = audioBlob ? progress : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioRef.current || !audioBlob) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      audioRef.current.currentTime = displayedDuration * percentage;
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="bg-bg-secondary/40 border-t border-border px-4 py-3 overflow-hidden"
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {!audioBlob ? (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-white transition-colors ${isRecording ? 'bg-red' : 'bg-accent'}`}
            >
              {isRecording ? <Pause className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          ) : (
            <button onClick={handleTogglePlay} className="p-2 rounded-full hover:bg-bg-hover text-text-muted">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
          )}
        </div>

        <div className="flex-1 flex items-center gap-2">
            {isRecording && !audioBlob && (
                <>
                    <canvas ref={canvasRef} className="w-full h-8 rounded-lg bg-bg-tertiary" />
                    <span className="text-sm text-text-muted w-14 text-right">{formatTime(duration)}</span>
                </>
            )}
            {audioBlob && (
                <>
                    <div className="w-full h-8 flex items-center cursor-pointer" onClick={handleSeek}>
                        <div className="w-full h-1.5 bg-bg-tertiary rounded-full relative">
                            <div
                            className="bg-accent h-full rounded-full"
                            style={{ width: `${displayedDuration > 0 ? (displayedProgress / displayedDuration) * 100 : 0}%` }}
                            />
                            <div 
                                className="absolute h-3 w-3 bg-white rounded-full -top-1 border border-border"
                                style={{ left: `calc(${displayedDuration > 0 ? (displayedProgress / displayedDuration) * 100 : 0}% - 6px)` }}
                            />
                        </div>
                    </div>
                    <span className="text-sm text-text-muted w-14 text-right">{formatTime(displayedDuration - displayedProgress)}</span>
                </>
            )}
            {!isRecording && !audioBlob && (
                <div className='w-full text-sm text-text-muted'>Нажмите, чтобы начать запись...</div>
            )}
        </div>

        <div className="flex items-center gap-2">
            {audioBlob && (
            <button onClick={handleSend} className="p-3 bg-accent hover:bg-accent-hover text-white rounded-xl">
                <Send className="w-5 h-5" />
            </button>
            )}
            <button onClick={handleFullCancel} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-red">
                <X className="w-5 h-5" />
            </button>
        </div>
      </div>
    </motion.div>
  );
}
