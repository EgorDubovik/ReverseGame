import { useState, useEffect, useRef } from 'react';
import { Mic, Square, AlertCircle } from 'lucide-react';
import { bufferToWav } from '../utils/audio';

interface AudioRecorderProps {
  onAudioReady: (wavArrayBuffer: ArrayBuffer) => void;
  maxDuration?: number; // in seconds
}

export function AudioRecorder({ onAudioReady, maxDuration = 15 }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(maxDuration);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecordingTracks();
      clearTimer();
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRecordingTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const startRecording = async () => {
    chunksRef.current = [];
    setError(null);
    setTimeLeft(maxDuration);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        await processAndSendAudio(audioBlob);
        stopRecordingTracks();
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Start countdown timer
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err: any) {
      console.error('Error accessing microphone:', err);
      setError('Не удалось получить доступ к микрофону. Проверьте разрешения.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    clearTimer();
    setIsRecording(false);
  };

  const processAndSendAudio = async (blob: Blob) => {
    try {
      // Decode audio data using browser's AudioContext
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await blob.arrayBuffer();
      
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      // Convert to 16-bit mono WAV Blob
      const wavBlob = bufferToWav(audioBuffer);
      const wavArrayBuffer = await wavBlob.arrayBuffer();
      
      onAudioReady(wavArrayBuffer);
    } catch (err) {
      console.error('Error decoding audio:', err);
      setError('Ошибка обработки аудиоданных. Попробуйте еще раз.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-4 p-6 glass rounded-2xl border border-slate-800 w-full max-w-sm mx-auto shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl"></div>
      
      {error && (
        <div className="bg-rose-950/60 border border-rose-500/30 text-rose-300 p-3 rounded-xl flex items-center space-x-2 text-xs font-semibold w-full">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isRecording ? (
        <div className="flex flex-col items-center space-y-4 w-full">
          {/* Waveform/Pulse animation indicator */}
          <div className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-16 w-16 rounded-full bg-purple-500/20 animate-ping"></span>
            <div className="relative rounded-full bg-purple-600/90 border border-purple-400 p-5 shadow-lg shadow-purple-500/30 z-10">
              <Mic size={24} className="text-white animate-pulse" />
            </div>
          </div>

          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-400">Идет запись голоса...</span>
            <div className="text-3xl font-extrabold text-white mt-1 font-mono">{timeLeft} с</div>
          </div>

          <button
            onClick={stopRecording}
            className="w-full flex items-center justify-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 px-4 rounded-xl transition duration-200 shadow-lg shadow-rose-600/20 active:scale-95 cursor-pointer"
          >
            <Square size={16} />
            <span>Остановить и отправить</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-3 w-full">
          <div className="rounded-full bg-slate-900 border border-slate-800 p-5">
            <Mic size={24} className="text-slate-500" />
          </div>
          
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Нажмите для записи (до 15с)</span>
            <p className="text-slate-500 text-[10px] mt-1">Пропойте мелодию или скажите фразу!</p>
          </div>

          <button
            onClick={startRecording}
            className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-3 px-4 rounded-xl transition duration-200 shadow-lg shadow-purple-500/20 active:scale-95 cursor-pointer"
          >
            <Mic size={16} />
            <span>Начать запись</span>
          </button>
        </div>
      )}
    </div>
  );
}
