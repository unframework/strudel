import Loader from '@src/repl/components/Loader';
import { Code } from '@src/repl/components/Code';
import BigPlayButton from '@src/repl/components/BigPlayButton';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { useReplState } from '../useReplContext';

// type Props = {
// }

export default function EmbeddedReplEditor(editorProps) {
  const { pending, started, handleTogglePlay, containerRef, editorRef, error, init } = useReplState();
  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <Header embedded={true} />
      <BigPlayButton started={started} handleTogglePlay={handleTogglePlay} />
      <div className="grow flex relative overflow-hidden">
        <Code containerRef={containerRef} editorRef={editorRef} init={init} />
      </div>
      <UserFacingErrorMessage error={error} />
    </div>
  );
}
