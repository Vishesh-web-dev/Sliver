import { Link, Navigate, useParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { Stage } from '../../components/Shell';
import { useRoom, type ConnectionStatus } from '../../lib/useRoom';
import { FinalScreen } from './FinalScreen';
import { HostBar } from './HostBar';
import { Lobby } from './Lobby';
import { QuestionScreen } from './QuestionScreen';
import { ResultsScreen } from './ResultsScreen';
import { StartingScreen } from './StartingScreen';

/**
 * The room renders whatever phase the server says it is in. Every screen is a
 * pure function of the pushed RoomState plus the synchronised server clock.
 */
export function RoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const room = useRoom(code);

  if (room.fatal) {
    if (room.fatal.code === 'NOT_IN_ROOM' || room.fatal.code === 'UNAUTHORIZED') {
      return <Navigate to={`/join/${code}`} replace />;
    }
    return (
      <Stage>
        <div className="my-auto py-16">
          <h1 className="display text-5xl">Game not found</h1>
          <p className="mt-4 text-cobalt-200">{room.fatal.message}</p>
          <Link to="/" className="btn btn-sun mt-8">
            Go to the home screen
          </Link>
        </div>
      </Stage>
    );
  }

  const state = room.state;
  if (!state) {
    return (
      <Stage right={<RoomChip code={code} status={room.status} />}>
        <p className="my-auto py-16 text-center text-cobalt-200" role="status">
          Connecting to game {code}…
        </p>
      </Stage>
    );
  }

  const game = state.game;
  const inPlay = state.phase === 'STARTING' || state.phase === 'QUESTION_ACTIVE' || state.phase === 'RESULTS';

  return (
    <Stage wide={state.phase === 'LOBBY'} right={<RoomChip code={code} status={room.status} />}>
      {room.status === 'reconnecting' && (
        <p role="status" className="mt-2 flex items-center gap-2 rounded-xl bg-cobalt-950/50 px-4 py-2.5 text-sm">
          <Icon name="wifiOff" size={18} />
          Reconnecting… Your answers and score are safe. The clock keeps running.
        </p>
      )}

      {state.phase === 'LOBBY' && <Lobby state={state} code={code} />}
      {state.phase === 'STARTING' && game && <StartingScreen game={game} serverNow={room.serverNow} />}
      {state.phase === 'QUESTION_ACTIVE' && game?.question && (
        <QuestionScreen
          key={game.question.id}
          state={state}
          game={game}
          question={game.question}
          code={code}
          serverNow={room.serverNow}
        />
      )}
      {state.phase === 'RESULTS' && game?.question && game.reveal && (
        <ResultsScreen key={game.question.id} state={state} game={game} serverNow={room.serverNow} />
      )}
      {state.phase === 'GAME_COMPLETE' && game?.final && <FinalScreen state={state} final={game.final} code={code} />}

      {inPlay && state.me.isHost && <HostBar code={code} />}
    </Stage>
  );
}

function RoomChip({ code, status }: { code: string; status: ConnectionStatus }) {
  const dot = status === 'open' ? 'bg-mint' : 'bg-sun pulse-dot';
  const label = status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span className="inline-flex items-center gap-2 rounded-pill bg-white/10 px-3 py-1.5 text-sm font-semibold">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      <span className="sr-only">{label}. </span>
      <span className="tracking-[0.14em]">{code}</span>
    </span>
  );
}
