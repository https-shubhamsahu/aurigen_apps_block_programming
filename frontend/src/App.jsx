// Entry point: auth-gate the app, then route home ⇄ editor.
// A #s= share link in the URL opens straight into the editor
// with the shared program as an unsaved project.
import { useEffect, useState } from 'react';
import AuthGate from './auth/AuthGate';
import Home from './components/Home';
import BlocklyWorkspace from './components/BlocklyWorkspace';
import { decodeShare } from './lib/share';

export default function App() {
  // NOTE: the initializer must stay side-effect free — StrictMode calls
  // it twice in dev, so consuming the hash here would lose the share.
  const [route, setRoute] = useState(() => {
    const shared = decodeShare(window.location.hash);
    if (shared) {
      return {
        view: 'editor',
        project: { id: null, title: 'Shared project', board_target: shared.boardId, workspace_xml: shared.xml },
      };
    }
    return { view: 'home' };
  });

  // Consume the share link after mount so refresh lands on Home.
  useEffect(() => {
    if (decodeShare(window.location.hash)) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return (
    <AuthGate>
      {route.view === 'home' ? (
        <Home onOpen={(project) => setRoute({ view: 'editor', project })} />
      ) : (
        <BlocklyWorkspace
          // Remount per project so Blockly + toolbox rebuild for the board.
          key={route.project.id ?? `new-${route.project.board_target}-${route.project.title}`}
          project={route.project}
          onHome={() => setRoute({ view: 'home' })}
        />
      )}
    </AuthGate>
  );
}
