import Loader from '@src/repl/components/Loader';
import { HorizontalPanel } from '@src/repl/components/panel/Panel';
import { Code } from '@src/repl/components/Code';
import BigPlayButton from '@src/repl/components/BigPlayButton';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { useReplState } from '@src/repl/useReplContext';

// type Props = {
// }

export default function UdelsEditor(editorProps) {
  const { containerRef, editorRef, error, init, pending, started, handleTogglePlay } = useReplState();

  return (
    <div className={'h-full flex w-full flex-col relative'} {...editorProps}>
      <Loader active={pending} />
      <BigPlayButton started={started} handleTogglePlay={handleTogglePlay} />
      <div className="grow flex relative overflow-hidden">
        <Code containerRef={containerRef} editorRef={editorRef} init={init} />
      </div>
      <UserFacingErrorMessage error={error} />
      <HorizontalPanel />
    </div>
  );
}
