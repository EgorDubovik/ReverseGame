import { useState, useEffect, useRef } from 'react';
import { socket } from './socket';
import type { Room } from './types';
import { AudioRecorder } from './components/AudioRecorder';
import { 
  Users, 
  User, 
  Crown, 
  Compass, 
  PlusCircle, 
  LogIn, 
  AlertCircle, 
  LogOut, 
  MessageSquare,
  Play,
  Square,
  Volume2,
  CheckCircle2,
  XCircle,
  HelpCircle
} from 'lucide-react';

function App() {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [screen, setScreen] = useState<'welcome' | 'lobby'>('welcome');
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [bottleRotation, setBottleRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [audioUrlA, setAudioUrlA] = useState<string | null>(null);
  const [audioUrlB, setAudioUrlB] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const myId = socket.id;
  const isCreator = room?.creatorId === myId;
  const canSpin = !!room && room.players.length >= 2 && (
    (room.status === 'lobby' && isCreator) ||
    (room.status === 'record_a' && !room.targetPlayerId && room.activePlayerId === myId)
  );

  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      console.log('Connected to server');
      setError(null);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setScreen('welcome');
      setRoom(null);
      cleanupAudio();
    });

    socket.on('roomJoined', (joinedRoom: Room) => {
      setRoom(joinedRoom);
      setScreen('lobby');
      setError(null);
      addLog(`Вы вошли в комнату ${joinedRoom.id}`);
    });

    socket.on('roomUpdated', (updatedRoom: Room) => {
      if (room) {
        const oldPlayerIds = room.players.map(p => p.id);
        const newPlayerIds = updatedRoom.players.map(p => p.id);
        
        updatedRoom.players.forEach(p => {
          if (!oldPlayerIds.includes(p.id)) {
            addLog(`Игрок ${p.nickname} присоединился`);
          }
        });

        room.players.forEach(p => {
          if (!newPlayerIds.includes(p.id)) {
            addLog(`Игрок ${p.nickname} покинул комнату`);
          }
        });

        // Check if guess result was just processed
        if (room.status === 'guess' && updatedRoom.status === 'record_a') {
          const oldHost = room.players.find(p => p.id === room.activePlayerId);
          const oldGuesser = room.players.find(p => p.id === room.targetPlayerId);
          
          if (oldHost && oldGuesser) {
            const newHost = updatedRoom.players.find(p => p.id === oldHost.id);
            const newGuesser = updatedRoom.players.find(p => p.id === oldGuesser.id);
            
            if (newHost && newGuesser) {
              const guesserGained = newGuesser.points > oldGuesser.points;
              if (guesserGained) {
                addLog(`✅ Игрок ${oldGuesser.nickname} угадал! (+10 очков). Ход передан ему.`);
              } else {
                addLog(`❌ Игрок ${oldGuesser.nickname} не угадал! (-10 очков). Ход передан ему.`);
              }
            }
          }
        }
      }

      setRoom(updatedRoom);
    });

    socket.on('bottleSpun', (data: { activeId: string; targetId: string }) => {
      if (!room) return;
      
      const spinner = room.players.find(p => p.id === data.activeId);
      const target = room.players.find(p => p.id === data.targetId);
      
      if (spinner && target) {
        addLog(`🍾 ${spinner.nickname} крутит бутылочку...`);
        
        const targetIndex = room.players.findIndex(p => p.id === data.targetId);
        if (targetIndex !== -1) {
          setIsSpinning(true);
          const totalPlayers = room.players.length;
          
          const targetAngle = (360 / totalPlayers) * targetIndex;
          const nextRotation = bottleRotation + 1440 + (targetAngle - (bottleRotation % 360));
          setBottleRotation(nextRotation);
          
          setTimeout(() => {
            setIsSpinning(false);
            addLog(`🎯 Бутылочка указала на игрока ${target.nickname}!`);
          }, 3000);
        }
      }
    });

    socket.on('audioBroadcast', (data: { audio: ArrayBuffer; phase: 'record_a' | 'record_b' }) => {
      const blob = new Blob([data.audio], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      
      if (data.phase === 'record_a') {
        setAudioUrlA(url);
        addLog(`🔊 Получен первый реверс от ведущего (А)!`);
        playReversedAudio(url);
      } else if (data.phase === 'record_b') {
        setAudioUrlB(url);
        addLog(`🔊 Получен повторный реверс от соперника (Б)!`);
        playReversedAudio(url);
      }
    });

    socket.on('error', (message: string) => {
      setError(message);
      setTimeout(() => setError(null), 5000);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('roomJoined');
      socket.off('roomUpdated');
      socket.off('bottleSpun');
      socket.off('audioBroadcast');
      socket.off('error');
    };
  }, [room, bottleRotation]);

  // Clean up audio state when a new round starts
  useEffect(() => {
    if (room?.status === 'lobby' || room?.status === 'record_a') {
      cleanupAudio();
    }
  }, [room?.status, room?.activePlayerId]);

  const cleanupAudio = () => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current = null;
    }
    setAudioUrlA(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setAudioUrlB(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setIsPlayingAudio(false);
  };

  const playReversedAudio = (urlToPlay: string) => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
    }

    const audio = new Audio(urlToPlay);
    audioPlaybackRef.current = audio;
    setIsPlayingAudio(true);
    
    audio.play().catch(err => {
      console.warn("Autoplay was blocked by browser. User needs to play manually.", err);
    });
    
    audio.onended = () => {
      setIsPlayingAudio(false);
    };
  };

  const handlePlayAudioA = () => {
    if (audioUrlA) playReversedAudio(audioUrlA);
  };

  const handlePlayAudioB = () => {
    if (audioUrlB) playReversedAudio(audioUrlB);
  };

  const handleStopAudio = () => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      setIsPlayingAudio(false);
    }
  };

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`[${time}] ${message}`, ...prev.slice(0, 49)]);
  };

  const handleCreateRoom = () => {
    if (!nickname.trim()) {
      setError('Пожалуйста, введите имя');
      return;
    }
    socket.emit('createRoom', { nickname });
  };

  const handleJoinRoom = () => {
    if (!nickname.trim()) {
      setError('Пожалуйста, введите имя');
      return;
    }
    if (!roomCode.trim()) {
      setError('Пожалуйста, введите код комнаты');
      return;
    }
    socket.emit('joinRoom', { roomId: roomCode, nickname });
  };

  const handleLeaveRoom = () => {
    socket.disconnect();
    socket.connect();
    setScreen('welcome');
    setRoom(null);
    setLogs([]);
    cleanupAudio();
  };

  const handleSpinBottle = () => {
    if (isSpinning) return;
    socket.emit('spinBottle');
  };

  const handleAudioReady = (wavArrayBuffer: ArrayBuffer) => {
    socket.emit('uploadAudio', { audio: wavArrayBuffer });
    addLog(`📤 Ваше аудио отправлено на сервер для реверса.`);
  };

  const handleGuessResult = (success: boolean) => {
    socket.emit('guessResult', { success });
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-y-auto">
      {/* Header */}
      <header className="w-full py-4 px-6 glass flex items-center justify-between border-b border-slate-800 sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="bg-purple-600 p-2 rounded-xl shadow-lg shadow-purple-500/30 animate-pulse">
            🍾
          </div>
          <span className="text-xl font-extrabold tracking-wider bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            SOUND REVERSE
          </span>
        </div>
        {room && (
          <button 
            onClick={handleLeaveRoom}
            className="flex items-center space-x-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-500/30 text-rose-300 px-4 py-2 rounded-xl transition duration-200 text-sm font-medium cursor-pointer"
          >
            <LogOut size={16} />
            <span>Выйти</span>
          </button>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-grow flex items-center justify-center p-6">
        {error && (
          <div className="fixed top-20 right-6 bg-rose-900/90 border border-rose-500 text-rose-100 px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-2 z-50 max-w-sm transition-all duration-300 animate-bounce">
            <AlertCircle size={20} className="shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        {screen === 'welcome' ? (
          /* Welcome Screen */
          <div className="w-full max-w-md glass p-8 rounded-3xl shadow-2xl border border-slate-800 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-pink-500/10 rounded-full blur-3xl"></div>

            <div className="text-center mb-8">
              <h2 className="text-3xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 bg-clip-text text-transparent mb-2">
                Угадай перевернутую песню!
              </h2>
              <p className="text-slate-400 text-sm">
                Запишите песню, сервер перевернет ее, а соперник попробует угадать.
              </p>
            </div>

            <div className="space-y-6">
              {/* Nickname Input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">Ваш никнейм</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    placeholder="Введите ваше имя..."
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value.slice(0, 15))}
                    maxLength={15}
                    className="w-full bg-slate-900/80 border border-slate-800 hover:border-purple-500/50 focus:border-purple-500 focus:outline-none rounded-xl py-3 pl-11 pr-4 text-slate-100 placeholder-slate-500 transition duration-200"
                  />
                </div>
              </div>

              {/* Actions Divider */}
              <div className="h-px bg-slate-800 my-4"></div>

              {/* Option 1: Create Room */}
              <button
                onClick={handleCreateRoom}
                className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-3.5 px-4 rounded-xl transition duration-200 shadow-lg shadow-purple-500/20 active:scale-95 cursor-pointer"
              >
                <PlusCircle size={20} />
                <span>Создать комнату</span>
              </button>

              {/* Option 2: Join Room */}
              <div className="space-y-3 pt-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">Или войти в существующую</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    placeholder="Код комнаты..."
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 6))}
                    className="flex-grow bg-slate-900/80 border border-slate-800 focus:border-indigo-500 focus:outline-none rounded-xl py-3 px-4 text-center tracking-widest uppercase font-bold text-slate-100 placeholder-slate-600 transition duration-200"
                  />
                  <button
                    onClick={handleJoinRoom}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3 rounded-xl transition duration-200 flex items-center justify-center space-x-2 shadow-lg shadow-indigo-500/20 active:scale-95 cursor-pointer"
                  >
                    <LogIn size={18} />
                    <span>Войти</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Lobby Screen */
          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
            
            {/* Left side: Room details and Logs */}
            <div className="lg:col-span-1 flex flex-col space-y-6">
              {/* Room info */}
              <div className="glass p-6 rounded-3xl border border-slate-800 flex flex-col space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Код комнаты</h3>
                    <div className="text-3xl font-extrabold tracking-widest text-purple-400 font-mono mt-1">
                      {room?.id}
                    </div>
                  </div>
                  <div className="bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-bold text-slate-400 flex items-center space-x-1.5">
                    <Users size={14} />
                    <span>{room?.players.length} игроков</span>
                  </div>
                </div>

                <div className="h-px bg-slate-800"></div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Статус игры</h4>
                  <div className="inline-flex items-center space-x-2 bg-purple-950/40 border border-purple-500/30 text-purple-300 px-3 py-1.5 rounded-xl text-xs font-bold">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping"></span>
                    <span>
                      {room?.status === 'lobby' 
                        ? 'Ожидание запуска игры' 
                        : 'Идет раунд'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action logs */}
              <div className="glass p-6 rounded-3xl border border-slate-800 flex-grow flex flex-col min-h-[200px] max-h-[300px] lg:max-h-none overflow-hidden">
                <div className="flex items-center space-x-2 text-slate-400 mb-3 shrink-0">
                  <MessageSquare size={16} />
                  <span className="text-xs font-bold uppercase tracking-wider">История событий</span>
                </div>
                <div className="flex-grow overflow-y-auto space-y-2.5 pr-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                  {logs.length === 0 ? (
                    <div className="text-slate-600 text-sm text-center py-8">История пуста. Ждем событий...</div>
                  ) : (
                    logs.map((log, idx) => (
                      <div key={idx} className="text-xs font-mono text-slate-300 break-words leading-relaxed border-l-2 border-purple-500/30 pl-2">
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right/Middle side: Circular Board Game Table & Controls */}
            <div className="lg:col-span-2 flex flex-col space-y-6">
              {/* Circular Table card */}
              <div className="glass p-6 rounded-3xl border border-slate-800 flex flex-col items-center justify-center relative min-h-[460px]">
                
                <div className="text-center mb-2 z-10">
                  <h3 className="text-xl font-bold">Круглый стол</h3>
                  <p className="text-slate-400 text-xs mt-1">
                    {room && room.players.length < 2 
                      ? 'Пригласите друзей! Для игры нужно хотя бы 2 игрока.' 
                      : 'Крутите бутылочку для выбора соперника.'}
                  </p>
                </div>

                {/* Circular layout wrapper */}
                <div 
                  ref={tableRef}
                  className="relative w-[300px] h-[300px] md:w-[360px] md:h-[360px] flex items-center justify-center bg-slate-900/30 rounded-full border border-slate-800/40 my-6 shadow-inner"
                >
                  {/* Visual rim */}
                  <div className="absolute inset-4 rounded-full border-4 border-slate-800/50 bg-slate-950/70 shadow-2xl flex items-center justify-center">
                    
                    {/* Table Center (Platter) */}
                    <div className="w-[120px] h-[120px] md:w-[140px] md:h-[140px] rounded-full bg-slate-900 border border-slate-800 flex flex-col items-center justify-center relative shadow-inner z-10">
                      
                      {/* Bottle Icon */}
                      <div 
                        className="absolute w-8 h-24 md:w-10 md:h-28 flex items-center justify-center transition-transform duration-[3000ms] ease-out z-20"
                        style={{ 
                          transform: `rotate(${bottleRotation}deg)`,
                          transition: isSpinning ? 'transform 3s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none'
                        }}
                      >
                        <div className="w-3.5 h-14 md:w-4 md:h-18 bg-gradient-to-b from-purple-500 to-indigo-600 rounded-t-full rounded-b-xl border border-purple-400/40 relative shadow-lg shadow-purple-500/20">
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-2.5 bg-amber-400 rounded-t-sm"></div>
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-4 bg-pink-400/80 rounded-sm"></div>
                        </div>
                      </div>

                      {/* Bottle Spin Button */}
                      <button
                        disabled={isSpinning || !canSpin}
                        onClick={handleSpinBottle}
                        className={`w-[60px] h-[60px] rounded-full flex flex-col items-center justify-center text-[9px] font-extrabold uppercase border z-30 transition duration-300 ${
                          isSpinning 
                            ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                            : !canSpin
                            ? 'bg-slate-800/50 border-slate-800 text-slate-600 cursor-not-allowed'
                            : 'bg-purple-600 border-purple-400/50 hover:bg-purple-500 text-white shadow-lg hover:shadow-purple-500/40 cursor-pointer active:scale-95'
                        }`}
                      >
                        <Compass size={16} className={isSpinning ? 'animate-spin' : ''} />
                        <span className="mt-0.5">Крутить</span>
                      </button>
                    </div>
                  </div>

                  {/* Player avatars */}
                  {room?.players.map((player, index) => {
                    const total = room.players.length;
                    const angle = (360 / total) * index;
                    const radius = window.innerWidth < 768 ? 105 : 135; 

                    const isPlayerCreator = room.creatorId === player.id;
                    const isActive = room.activePlayerId === player.id;
                    const isTarget = room.targetPlayerId === player.id;
                    const isMe = player.id === myId;

                    const circleStyle = {
                      '--angle': `${angle}deg`,
                      '--radius': `${radius}px`,
                    } as React.CSSProperties;

                    return (
                      <div 
                        key={player.id}
                        className="circle-item z-20 flex flex-col items-center justify-center text-center"
                        style={circleStyle}
                      >
                        <div className="relative group">
                          {isActive && (
                            <div className="absolute -inset-1.5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full blur opacity-70 animate-pulse"></div>
                          )}
                          {isTarget && (
                            <div className="absolute -inset-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full blur opacity-70 animate-pulse"></div>
                          )}
                          
                          <div 
                            className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center font-bold text-base md:text-lg text-white relative shadow-xl border-2 border-slate-800 transition duration-300 hover:scale-105"
                            style={{ backgroundColor: player.color }}
                          >
                            {player.nickname.charAt(0).toUpperCase()}

                            {isPlayerCreator && (
                              <div className="absolute -top-1 -right-1 bg-amber-500 p-0.5 rounded-full text-slate-950 border border-slate-900 shadow-md">
                                <Crown size={8} />
                              </div>
                            )}
                          </div>

                          {isActive && (
                            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-[8px] font-extrabold px-1 py-0.5 rounded-full uppercase tracking-wider shadow">
                              Ходит
                            </span>
                          )}
                          {isTarget && (
                            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[8px] font-extrabold px-1 py-0.5 rounded-full uppercase tracking-wider shadow">
                              Соперник
                            </span>
                          )}
                        </div>
                        <span className={`text-[10px] md:text-xs font-bold mt-2 px-1.5 py-0.5 rounded bg-slate-900/80 border border-slate-800 ${isMe ? 'text-purple-400' : 'text-slate-300'}`}>
                          {player.nickname}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="z-10 bg-slate-950/70 border border-slate-800/80 rounded-2xl px-5 py-2.5 text-xs md:text-sm font-semibold max-w-md text-center">
                  {room && room.status === 'lobby' ? (
                    isCreator ? (
                      <span className="text-purple-300">Вы создатель. Запустите раунд, покрутив бутылочку в центре!</span>
                    ) : (
                      <span className="text-slate-300 font-medium">Ожидание, пока создатель ({room.players.find(p => p.id === room.creatorId)?.nickname}) начнет игру.</span>
                    )
                  ) : isSpinning ? (
                    <span className="text-purple-300 animate-pulse">🍾 Бутылочка крутится... Выбираем соперника!</span>
                  ) : (
                    room && (
                      <span className="text-purple-300">
                        {room.status === 'record_a' && (
                          room.activePlayerId === myId ? (
                            <span><strong>Ваш ход!</strong> Запишите песню. Соперник: {room.players.find(p => p.id === room.targetPlayerId)?.nickname}</span>
                          ) : room.targetPlayerId === myId ? (
                            <span><strong>Вы соперник!</strong> Ожидайте, пока {room.players.find(p => p.id === room.activePlayerId)?.nickname} запишет песню.</span>
                          ) : (
                            <span>{room.players.find(p => p.id === room.activePlayerId)?.nickname} записывает песню для {room.players.find(p => p.id === room.targetPlayerId)?.nickname}.</span>
                          )
                        )}
                        {room.status === 'record_b' && (
                          room.activePlayerId === myId ? (
                            <span>Соперник ({room.players.find(p => p.id === room.targetPlayerId)?.nickname}) слушает первый реверс и записывает повтор.</span>
                          ) : room.targetPlayerId === myId ? (
                            <span><strong>Послушайте первый реверс (А)</strong> и запишите его повтор!</span>
                          ) : (
                            <span>{room.players.find(p => p.id === room.targetPlayerId)?.nickname} слушает реверс и записывает повтор.</span>
                          )
                        )}
                        {room.status === 'guess' && (
                          room.activePlayerId === myId ? (
                            <span>Соперник угадывает оригинальную песню по вашему повторному реверсу. Подтвердите результат!</span>
                          ) : room.targetPlayerId === myId ? (
                            <span><strong>Послушайте повторный реверс (Б)</strong> и угадайте песню! Назовите её ведущему.</span>
                          ) : (
                            <span>{room.players.find(p => p.id === room.targetPlayerId)?.nickname} отгадывает оригинальную песню.</span>
                          )
                        )}
                      </span>
                    )
                  )}
                </div>
              </div>

              {/* Gameplay / Recording / Guessing Panel */}
              {room && room.status !== 'lobby' && (
                <div className="glass p-6 rounded-3xl border border-slate-800 flex flex-col items-center justify-center space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                    <HelpCircle size={16} className="text-purple-400" />
                    <span>Игровой пульт</span>
                  </h4>

                  {/* 1. PHASE record_a */}
                  {room.status === 'record_a' && (
                    <div className="w-full flex flex-col items-center justify-center space-y-4">
                      {isSpinning ? (
                        <div className="flex flex-col items-center p-6 bg-slate-900/30 border border-slate-800/80 rounded-2xl w-full max-w-sm text-center">
                          <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin mb-3"></div>
                          <span className="text-sm text-slate-400">
                            Выбираем соперника...
                          </span>
                        </div>
                      ) : room.activePlayerId === myId ? (
                        <AudioRecorder onAudioReady={handleAudioReady} />
                      ) : (
                        <div className="flex flex-col items-center p-6 bg-slate-900/30 border border-slate-800/80 rounded-2xl w-full max-w-sm text-center">
                          <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin mb-3"></div>
                          <span className="text-sm text-slate-400">
                            Ожидайте, пока {room.players.find(p => p.id === room.activePlayerId)?.nickname} запишет песню...
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. PHASE record_b */}
                  {room.status === 'record_b' && (
                    <div className="w-full flex flex-col items-center justify-center space-y-4">
                      {room.targetPlayerId === myId ? (
                        /* Player B is mimicry recorder */
                        <div className="flex flex-col items-center space-y-4 w-full max-w-sm">
                          <div className="flex flex-col items-center space-y-2 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl w-full text-center">
                            <span className="text-sm font-bold text-white block">Слушайте первый реверс (А)</span>
                            <p className="text-slate-400 text-xs">Прослушайте звук и попробуйте напеть его в микрофон!</p>
                            
                            <div className="flex space-x-2 w-full mt-2">
                              <button
                                onClick={handlePlayAudioA}
                                className="flex-grow flex items-center justify-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-3 rounded-xl transition duration-200 text-xs cursor-pointer"
                              >
                                <Play size={14} />
                                <span>Прослушать реверс A</span>
                              </button>
                              {isPlayingAudio && (
                                <button
                                  onClick={handleStopAudio}
                                  className="bg-slate-800 hover:bg-slate-700 text-rose-400 p-2 rounded-xl border border-slate-700"
                                >
                                  <Square size={12} />
                                </button>
                              )}
                            </div>
                          </div>

                          <AudioRecorder onAudioReady={handleAudioReady} />
                        </div>
                      ) : (
                        /* Player A and Spectators are waiting */
                        <div className="flex flex-col items-center p-6 bg-slate-900/30 border border-slate-800/85 rounded-2xl w-full max-w-sm text-center space-y-3">
                          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mb-1"></div>
                          <span className="text-sm text-slate-400">
                            {room.players.find(p => p.id === room.targetPlayerId)?.nickname} слушает первый реверс и записывает повтор...
                          </span>
                          
                          {audioUrlA && (
                            <div className="flex space-x-2 w-full pt-2 border-t border-slate-800">
                              <button
                                onClick={handlePlayAudioA}
                                className="flex-grow flex items-center justify-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 rounded-xl transition duration-200 text-xs border border-slate-750 cursor-pointer"
                              >
                                <Play size={12} />
                                <span>Слушать реверс A</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. PHASE guess */}
                  {room.status === 'guess' && (
                    <div className="w-full flex flex-col items-center justify-center space-y-4">
                      {room.activePlayerId === myId ? (
                        /* Player A is host, has guess buttons */
                        <div className="flex flex-col items-center space-y-4 p-5 bg-slate-900/60 border border-slate-800 rounded-2xl w-full max-w-md">
                          <span className="text-xs text-purple-300 font-bold text-center">
                            Получен повторный реверс (Б) (похож на ваш оригинал!). Спросите отгадку у соперника!
                          </span>

                          <div className="grid grid-cols-2 gap-3 w-full">
                            <button
                              onClick={handlePlayAudioB}
                              className="flex items-center justify-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-3 rounded-xl transition duration-200 text-xs cursor-pointer"
                            >
                              <Play size={12} />
                              <span>Повторный реверс (Б)</span>
                            </button>
                            <button
                              onClick={handlePlayAudioA}
                              className="flex items-center justify-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 px-3 rounded-xl transition duration-200 text-xs border border-slate-750 cursor-pointer"
                            >
                              <Play size={12} />
                              <span>Первый реверс (А)</span>
                            </button>
                          </div>

                          <div className="h-px bg-slate-800 w-full my-1"></div>

                          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Подтвердите результат:</div>
                          <div className="grid grid-cols-2 gap-3 w-full">
                            <button
                              onClick={() => handleGuessResult(true)}
                              className="flex items-center justify-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl transition duration-200 text-xs shadow-lg shadow-emerald-600/20 cursor-pointer"
                            >
                              <CheckCircle2 size={14} />
                              <span>Угадал песню</span>
                            </button>
                            <button
                              onClick={() => handleGuessResult(false)}
                              className="flex items-center justify-center space-x-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 px-4 rounded-xl transition duration-200 text-xs shadow-lg shadow-rose-600/20 cursor-pointer"
                            >
                              <XCircle size={14} />
                              <span>Не угадал</span>
                            </button>
                          </div>
                        </div>
                      ) : room.targetPlayerId === myId ? (
                        /* Player B is guesser */
                        <div className="flex flex-col items-center space-y-4 p-5 bg-slate-900/60 border border-slate-800 rounded-2xl w-full max-w-sm text-center">
                          <Volume2 size={36} className="text-purple-400 animate-bounce" />
                          <div className="space-y-1">
                            <span className="text-sm font-bold text-white block">Попробуйте отгадать оригинал!</span>
                            <p className="text-slate-400 text-xs">
                              Послушайте повторный реверс (Б), который похож на исходную песню, и угадайте её!
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-2 w-full">
                            <button
                              onClick={handlePlayAudioB}
                              className="flex items-center justify-center space-x-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-2.5 px-3 rounded-xl transition duration-200 text-xs shadow-lg shadow-purple-500/20 cursor-pointer"
                            >
                              <Play size={12} />
                              <span>Слушать повтор (Б)</span>
                            </button>
                            <button
                              onClick={handlePlayAudioA}
                              className="flex items-center justify-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-3 rounded-xl transition duration-200 text-xs border border-slate-750 cursor-pointer"
                            >
                              <Play size={12} />
                              <span>Слушать реверс (А)</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Spectators */
                        <div className="flex flex-col items-center space-y-4 p-5 bg-slate-900/40 border border-slate-800/60 rounded-2xl w-full max-w-sm text-center">
                          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Режим наблюдателя</span>
                          <p className="text-slate-400 text-xs">
                            {room.players.find(p => p.id === room.targetPlayerId)?.nickname} пытается отгадать оригинал.
                          </p>

                          <div className="grid grid-cols-2 gap-2 w-full">
                            <button
                              onClick={handlePlayAudioB}
                              className="flex items-center justify-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold py-2 px-3 rounded-xl transition duration-200 text-xs cursor-pointer"
                            >
                              <Play size={12} />
                              <span>Слушать повтор (Б)</span>
                            </button>
                            <button
                              onClick={handlePlayAudioA}
                              className="flex items-center justify-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-900 font-bold py-2 px-3 rounded-xl transition duration-200 text-xs cursor-pointer"
                            >
                              <Play size={12} />
                              <span>Слушать реверс (А)</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right side: Points Table / Leaderboard */}
            <div className="lg:col-span-1 flex flex-col space-y-6">
              <div className="glass p-6 rounded-3xl border border-slate-800 flex flex-col h-full overflow-hidden">
                <div className="flex items-center space-x-2 text-slate-400 mb-4 shrink-0">
                  <span className="text-xl">🏆</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-350">Таблица очков</span>
                </div>

                <div className="flex-grow overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                  <div className="space-y-3">
                    {room?.players
                      .slice()
                      .sort((a, b) => b.points - a.points)
                      .map((player, index) => {
                        const isTop = index === 0 && player.points > 100;
                        const isMe = player.id === myId;
                        return (
                          <div 
                            key={player.id} 
                            className={`flex items-center justify-between p-3 rounded-2xl border transition-all duration-300 ${
                              isMe 
                                ? 'bg-purple-950/30 border-purple-500/30 shadow-md shadow-purple-950/20' 
                                : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-900/60'
                            }`}
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <span className={`text-xs font-bold w-5 text-center ${
                                index === 0 ? 'text-amber-400' : index === 1 ? 'text-slate-300' : index === 2 ? 'text-amber-600' : 'text-slate-500'
                              }`}>
                                #{index + 1}
                              </span>
                              
                              <div 
                                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 relative shadow"
                                style={{ backgroundColor: player.color }}
                              >
                                {player.nickname.charAt(0).toUpperCase()}
                                {isTop && (
                                  <div className="absolute -top-1.5 -right-1 bg-amber-500 p-0.5 rounded-full text-slate-950 border border-slate-900 shadow animate-bounce">
                                    <Crown size={6} />
                                  </div>
                                )}
                              </div>

                              <span className={`text-sm font-semibold truncate ${isMe ? 'text-purple-300' : 'text-slate-200'}`}>
                                {player.nickname} {isMe && '(Вы)'}
                              </span>
                            </div>

                            <div className="flex items-center space-x-1">
                              <span className={`text-sm font-black font-mono px-2.5 py-1 rounded-xl bg-slate-950 border ${
                                player.points > 100 
                                  ? 'text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/10' 
                                  : player.points < 100 
                                  ? 'text-rose-400 border-rose-500/20' 
                                  : 'text-slate-400 border-slate-850'
                              }`}>
                                {player.points}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
