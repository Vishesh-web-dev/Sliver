import { Link, Route, Routes } from 'react-router';
import { Stage } from './components/Shell';
import { CreatePage } from './pages/CreatePage';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { RoomPage } from './pages/room/RoomPage';
import { SetEditorPage } from './pages/sets/SetEditorPage';
import { SetsPage } from './pages/sets/SetsPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/create" element={<CreatePage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/room/:code" element={<RoomPage />} />
      <Route path="/sets" element={<SetsPage />} />
      <Route path="/sets/new" element={<SetEditorPage />} />
      <Route path="/sets/:id" element={<SetEditorPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <Stage>
      <div className="my-auto py-16">
        <h1 className="display text-5xl">Nothing here</h1>
        <p className="mt-4 text-cobalt-200">That page doesn’t exist. If someone sent you a game link, check the code.</p>
        <Link to="/" className="btn btn-sun mt-8">
          Go to the home screen
        </Link>
      </div>
    </Stage>
  );
}
