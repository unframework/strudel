import Loader from '@src/repl/components/Loader';
import { Code } from '@src/repl/components/Code';
import BigPlayButton from '@src/repl/components/BigPlayButton';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { TopBar } from './topbar/TopBar';

// type Props = {
//  context: replcontext,
// }

export default function EmbeddedReplEditor(Props) {
  const { context, ...editorProps } = Props;
  const { pending, started, handleTogglePlay, containerRef, editorRef, error, init } = context;
  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <TopBar context={context} isEmbedded={true} />
      <BigPlayButton started={started} handleTogglePlay={handleTogglePlay} />
      <div className="grow flex relative overflow-hidden">
        <Code containerRef={containerRef} editorRef={editorRef} init={init} />
      </div>
      <UserFacingErrorMessage error={error} />
    </div>
  );
}
